import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import api, { describeApiError } from "@/lib/api";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  Clock, AlertCircle, Sparkles, FileSignature, CheckCircle2,
  ClipboardList, FileText, Pill, Loader2, Wallet, Lock, Unlock,
} from "lucide-react";
import { toast } from "sonner";
import PhotoUploader from "@/components/PhotoUploader";
import SignaturePad from "@/components/SignaturePad";
import FichaForm from "@/components/FichaForm";
import BudgetEditor from "@/components/BudgetEditor";
import CompletePaymentDialog from "@/components/CompletePaymentDialog";
import DocumentGenerator from "@/components/DocumentGenerator";
import {
  SCHEMA_GERAL, SCHEMA_FACIAL, SCHEMA_CORPORAL, SCHEMA_CAPILAR,
  SCHEMA_INJETAVEIS, SCHEMA_EPILACAO,
} from "@/components/ficha-schemas";

const MODULE_OPTIONS = [
  { key: "geral", label: "Anamnese", schema: SCHEMA_GERAL },
  { key: "facial", label: "Facial", schema: SCHEMA_FACIAL },
  { key: "injetaveis", label: "Injetáveis", schema: SCHEMA_INJETAVEIS },
  { key: "corporal", label: "Corporal", schema: SCHEMA_CORPORAL },
  { key: "capilar", label: "Capilar", schema: SCHEMA_CAPILAR },
  { key: "epilacao", label: "Epilação", schema: SCHEMA_EPILACAO },
];

function fmtDuration(s) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

/**
 * AttendanceDialog — complete clinical attendance flow.
 * Stages:
 *   1. completion (only if patient incomplete)
 *   2. anamnese (4 modules with autosave)
 *   3. evolucao (notes + AI helpers + photos)
 *   4. assinatura (consent + evolution signatures)
 *   5. concluido
 */
export default function AttendanceDialog({ appointment, open, onOpenChange, onCompleted }) {
  const [stage, setStage] = useState("loading");
  const [patient, setPatient] = useState(null);
  const [session, setSession] = useState(null);
  const [tab, setTab] = useState("ficha");
  const [fichaModule, setFichaModule] = useState("geral");
  const [seconds, setSeconds] = useState(0);
  const [busy, setBusy] = useState(false);
  const [savedAt, setSavedAt] = useState(null);
  const [saveError, setSaveError] = useState(null); // Auditoria: expõe última falha de autosave
  const [aiBusy, setAiBusy] = useState(false);
  const tickRef = useRef(null);
  const saveTimerRef = useRef(null);

  // Patient completion form state (used when missing fields)
  const [pForm, setPForm] = useState({});

  // Budget linked to this attendance (last saved)
  const [linkedBudget, setLinkedBudget] = useState(null);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [docGenOpen, setDocGenOpen] = useState(false);
  // ⭐ Fase 6: travamento de atendimento finalizado + reabertura com auditoria
  const [locked, setLocked] = useState(false);
  const [reopenOpen, setReopenOpen] = useState(false);
  const [reopenReason, setReopenReason] = useState("");
  const [reopenBusy, setReopenBusy] = useState(false);
  // ⭐ Fase 3: dados enriquecidos para header inteligente
  const [financeSummary, setFinanceSummary] = useState(null);
  const [lastAttendance, setLastAttendance] = useState(null);

  // Load on open
  useEffect(() => {
    if (!open || !appointment) return;
    (async () => {
      setStage("loading");
      try {
        // 1. check completeness
        const { data: comp } = await api.get(`/patients/${appointment.patient_id}/completeness`);
        setPatient(comp.patient);
        setPForm(comp.patient);
        if (!comp.complete) {
          setStage("completion");
          return;
        }
        // 2. start session
        const { data: sess } = await api.post(`/attendance/start`, {
          appointment_id: appointment.appointment_id,
        });
        setSession(sess);
        setLocked(!!sess.read_only);
        setSeconds(sess.duration_seconds || 0);
        // 3. load existing budget (if any) for this appointment
        try {
          const { data: budgets } = await api.get("/budgets", {
            params: { patient_id: appointment.patient_id },
          });
          const linked = (budgets || []).find((b) => b.appointment_id === appointment.appointment_id);
          if (linked) setLinkedBudget(linked);
          else setLinkedBudget(null);
        } catch { /* ignore */ }
        // ⭐ Fase 3: dados extras para o header inteligente
        try {
          const { data: fin } = await api.get(`/finance/patient/${appointment.patient_id}/summary`);
          setFinanceSummary(fin);
        } catch { setFinanceSummary(null); }
        try {
          const { data: tl } = await api.get(`/patients/${appointment.patient_id}/timeline`);
          const previous = (tl.sessions || []).find(
            (s) => s.finalized_at && s.session_id !== sess.session_id
          );
          setLastAttendance(previous?.finalized_at || null);
        } catch { setLastAttendance(null); }
        setStage("inProgress");
      } catch (e) {
        toast.error("Erro ao iniciar atendimento");
        onOpenChange(false);
      }
    })();
  }, [open, appointment, onOpenChange]);

  // Timer
  useEffect(() => {
    if (stage !== "inProgress" || locked) return;
    tickRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(tickRef.current);
  }, [stage, locked]);

  // Autosave session (debounced) when session changes
  const abortRef = useRef(null);
  const opIdRef = useRef(0);

  // Autosave with race-condition protection (Correção 7):
  // - AbortController cancels in-flight request before firing a new one
  // - client_op_id guards against stale response overwriting fresher state
  const autosave = (patch) => {
    if (locked) return; // ⭐ Fase 6: atendimento finalizado é imutável
    setSession((s) => ({ ...s, ...patch }));
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      const opId = ++opIdRef.current;
      try { abortRef.current?.abort(); } catch { /* ignore */ }
      const ctl = new AbortController();
      abortRef.current = ctl;
      try {
        const { data } = await api.put(
          `/attendance/${session.session_id}`,
          { patient_id: session.patient_id, ...patch, duration_seconds: seconds, status: "rascunho" },
          { signal: ctl.signal }
        );
        // Only accept the response if this is still the latest op
        if (opId === opIdRef.current) {
          setSession((s) => ({ ...s, ...data }));
          setSavedAt(new Date());
          setSaveError(null);
        }
      } catch (err) {
        if (err.name !== "CanceledError" && err.name !== "AbortError") {
          // Persistent surface: expose failure in header instead of silent swallow
          if (opId === opIdRef.current) {
            const msg = describeApiError(err, "Falha ao salvar rascunho");
            setSaveError(msg);
            console.warn("[autosave] failed:", err?.response?.status, err?.response?.data || err?.message);
          }
        }
      }
    }, 800);
  };

  const setSessionField = (k, v) => autosave({ [k]: v });

  // ⭐ Fase 6: reabertura de atendimento finalizado (justificativa obrigatória)
  const confirmReopen = async () => {
    const reason = (reopenReason || "").trim();
    if (reason.length < 3) {
      toast.error("Informe a justificativa da reabertura.");
      return;
    }
    setReopenBusy(true);
    try {
      const { data } = await api.post(`/attendance/${session.session_id}/reopen`, { reason });
      setSession(data);
      setLocked(false);
      setReopenOpen(false);
      setReopenReason("");
      toast.success("Atendimento reaberto. A justificativa foi registrada no prontuário.");
    } catch (e) {
      toast.error(describeApiError(e, "Falha ao reabrir atendimento"));
    } finally {
      setReopenBusy(false);
    }
  };

  // Signature capture with forensic metadata (Correção 4+5)
  const captureSignature = async (type, base64) => {
    // Update local state immediately for responsive UI
    setSession((s) => ({ ...s, [`${type}_signature`]: base64 }));
    if (!base64 || !session?.session_id) return;
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
      await api.post(`/attendance/${session.session_id}/sign`, {
        type, signature: base64, timezone: tz,
      });
      setSavedAt(new Date());
    } catch {
      // Fallback: mantém no autosave normal
      autosave({ [`${type}_signature`]: base64 });
    }
  };

  // Reset on close
  useEffect(() => {
    if (!open) {
      clearInterval(tickRef.current);
      clearTimeout(saveTimerRef.current);
      setSession(null);
      setSeconds(0);
      setStage("loading");
      setTab("ficha");
      setSavedAt(null);
      setSaveError(null);
    }
  }, [open]);

  // === Patient completion submit ===
  const savePatient = async () => {
    setBusy(true);
    try {
      await api.put(`/patients/${patient.patient_id}`, {
        ...pForm,
        lgpd_consent: !!pForm.lgpd_consent,
        is_pre_registered: false,
      });
      const { data: sess } = await api.post(`/attendance/start`, {
        appointment_id: appointment.appointment_id,
      });
      setSession(sess);
      setStage("inProgress");
      toast.success("Cadastro completo. Atendimento iniciado");
    } catch (e) {
      toast.error(describeApiError(e, "Erro ao salvar paciente"));
    } finally { setBusy(false); }
  };

  // === AI helpers ===
  // ⭐ Fase 4: IA contextual com mode (append/replace/improve/rewrite) + session_id
  const [aiMode, setAiMode] = useState("append"); // append | replace | improve | rewrite
  const [contraAlert, setContraAlert] = useState(null);

  const callAi = async (type, notes, opts = {}) => {
    setAiBusy(true);
    try {
      const { data } = await api.post("/ai/generate", {
        type,
        patient_id: patient.patient_id,
        session_id: session?.session_id,
        notes,
        context: appointment?.procedure,
        mode: opts.mode || aiMode,
        current_text: opts.current_text,
      });
      return data.text;
    } catch (e) {
      console.warn("[ai/generate] failed:", e?.response?.status, e?.response?.data || e?.message);
      toast.error(describeApiError(e, `IA (${type}) indisponível`));
      return null;
    } finally { setAiBusy(false); }
  };

  const applyAiResult = (field, current, generated, mode) => {
    if (mode === "replace" || mode === "rewrite" || mode === "improve") {
      return generated;
    }
    return `${current || ""}\n\n${generated}`.trim();
  };

  const generateEvolution = async () => {
    const notes = session.observations || session.evolution || "Atendimento padrão";
    const type = (aiMode === "improve" || aiMode === "rewrite") ? aiMode : "evolution";
    const text = await callAi(type, notes, { current_text: session.evolution });
    if (text) {
      autosave({ evolution: applyAiResult("evolution", session.evolution, text, aiMode) });
      toast.success(aiMode === "replace" || aiMode === "rewrite" || aiMode === "improve" ? "Evolução IA substituída" : "Evolução IA anexada");
    }
  };

  const suggestProtocol = async () => {
    const text = await callAi("protocol", session.observations || appointment?.procedure);
    if (text) {
      autosave({ protocols: applyAiResult("protocols", session.protocols, text, aiMode) });
      toast.success("Protocolo IA sugerido");
    }
  };

  const checkContraindications = async () => {
    const text = await callAi("contraindications", session?.observations || "");
    if (text) {
      setContraAlert(text);
      toast.success("Análise de contraindicações gerada");
    }
  };

  const generateSessionSummary = async () => {
    const notes = [
      session?.observations, session?.evolution, session?.protocols, session?.prescriptions,
    ].filter(Boolean).join("\n\n");
    const text = await callAi("session_summary", notes || "Sessão em andamento");
    if (text) {
      autosave({ observations: applyAiResult("observations", session.observations, `[Resumo IA da sessão]\n${text}`, aiMode) });
      toast.success("Resumo IA da sessão adicionado");
    }
  };

  // === Finalize ===
  const finalize = async () => {
    if (!session.evolution_signature) {
      toast.error("Capture a assinatura de evolução antes de finalizar");
      setTab("assinatura");
      return;
    }
    // Save current draft, then open the payment dialog
    setBusy(true);
    // Payload sanitizado — auditoria: garante que arrays sejam strings (URLs), sem objetos aninhados
    const sanitizeStringArray = (v) =>
      Array.isArray(v) ? v.filter((x) => typeof x === "string" && x.length > 0)
                       : [];
    try {
      await api.put(`/attendance/${session.session_id}`, {
        patient_id: session.patient_id,
        appointment_id: session.appointment_id,
        procedure: session.procedure,
        professional_name: session.professional_name,
        evolution: session.evolution || "",
        observations: session.observations || "",
        protocols: session.protocols || "",
        prescriptions: session.prescriptions || "",
        products_used: session.products_used || "",
        photos_before: sanitizeStringArray(session.photos_before),
        photos_after: sanitizeStringArray(session.photos_after),
        consent_signature: session.consent_signature || null,
        evolution_signature: session.evolution_signature || null,
        status: "rascunho",
        duration_seconds: seconds,
      });
      setSaveError(null);
      setPaymentOpen(true);
    } catch (e) {
      console.warn("[finalize/pre-save] failed:", e?.response?.status, e?.response?.data || e?.message);
      const msg = describeApiError(e, "Erro ao salvar rascunho");
      setSaveError(msg);
      toast.error(msg, { duration: 8000 });
    } finally { setBusy(false); }
  };

  const confirmFinalize = async (paymentPayload) => {
    if (busy) return; // ⭐ Problema 1: trava contra reentrada
    setBusy(true);
    try {
      const { data } = await api.post(`/attendance/${session.session_id}/finalize`, paymentPayload);
      // ⭐ Fase 3: mostra link do primeiro recibo gerado no toast
      const firstEntry = (data?.financial_entries || [])[0];
      if (firstEntry) {
        try {
          const { data: rec } = await api.get(`/finance/entries/${firstEntry}/receipt`);
          if (rec?.receipt_url) {
            toast.success(`Recibo ${rec.receipt_number} gerado`, {
              description: "Clique para visualizar o PDF",
              action: {
                label: "Abrir",
                onClick: () => window.open(`${process.env.REACT_APP_BACKEND_URL}${rec.receipt_url}`, "_blank", "noopener"),
              },
              duration: 8000,
            });
          } else {
            toast.success("Atendimento concluído e financeiro lançado");
          }
        } catch {
          toast.success("Atendimento concluído e financeiro lançado");
        }
      } else {
        toast.success("Atendimento concluído");
      }
      setPaymentOpen(false);
      onCompleted?.();
      onOpenChange(false);
    } catch (e) {
      console.warn("[finalize/confirm] failed:", e?.response?.status, e?.response?.data || e?.message);
      toast.error(describeApiError(e, "Erro ao finalizar atendimento"), { duration: 8000 });
    } finally {
      setBusy(false);
    }
  };

  // ⭐ Fase 5 Onda A: memoização das derivações caras
  const [scrollY, setScrollY] = useState(0);
  const [focusMode, setFocusMode] = useState(false);
  const bodyRef = useRef(null);
  const compactHeader = scrollY > 100 || focusMode;

  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const onScroll = () => setScrollY(el.scrollTop);
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [stage]);

  const patientAge = useMemo(() => {
    const bd = patient?.birth_date;
    if (!bd) return null;
    try {
      const d = new Date(bd);
      const now = new Date();
      let a = now.getFullYear() - d.getFullYear();
      const m = now.getMonth() - d.getMonth();
      if (m < 0 || (m === 0 && now.getDate() < d.getDate())) a--;
      return a > 0 && a < 130 ? a : null;
    } catch { return null; }
  }, [patient?.birth_date]);

  const progressSteps = useMemo(() => {
    if (!session) return [];
    const budgetOk = !!linkedBudget && (linkedBudget.total || 0) > 0;
    return [
      { key: "ficha", label: "Ficha", done: !!(session.observations || session.evolution) },
      { key: "fotos", label: "Fotos", done: (session.photos_before?.length || 0) + (session.photos_after?.length || 0) > 0 },
      { key: "evolucao", label: "Evolução", done: !!(session.evolution && session.evolution.length > 20) },
      { key: "assinatura", label: "Assinatura", done: !!session.evolution_signature },
      { key: "orcamento", label: "Orçamento", done: budgetOk },
      { key: "finalizacao", label: "Finalização", done: session.status === "concluido" },
    ];
  }, [session, linkedBudget]);

  const progressPct = useMemo(
    () => (progressSteps.length > 0 ? Math.round((progressSteps.filter((s) => s.done).length / progressSteps.length) * 100) : 0),
    [progressSteps]
  );

  const alerts = useMemo(() => {
    const arr = [];
    if (patient?.allergies) arr.push({ level: "danger", label: "Alergia registrada", detail: patient.allergies });
    if (patient?.medications) arr.push({ level: "info", label: "Medicações em uso", detail: patient.medications });
    if (session && !session.evolution_signature) arr.push({ level: "warn", label: "Assinatura de evolução pendente" });
    if (session && (session.photos_before?.length || 0) + (session.photos_after?.length || 0) === 0)
      arr.push({ level: "info", label: "Nenhuma foto capturada" });
    if (financeSummary?.total_vencido > 0) arr.push({ level: "warn", label: `Paciente com R$ ${(financeSummary.total_vencido).toLocaleString("pt-BR", {minimumFractionDigits:2})} em atraso` });
    return arr;
  }, [patient?.allergies, patient?.medications, session, financeSummary?.total_vencido]);

  const financialPreviewTotal = useMemo(
    () => linkedBudget?.total || appointment?.price || 0,
    [linkedBudget?.total, appointment?.price]
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="attendance-dialog"
        className="max-w-6xl w-[97vw] rounded-2xl p-0 max-h-[95vh] overflow-hidden flex flex-col"
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        {/* Header — visível apenas em loading/completion; em inProgress o Smart Header assume */}
        {stage !== "inProgress" && (
          <DialogHeader className="border-b border-border px-6 py-4 shrink-0">
            <div className="flex items-center justify-between">
              <div>
                <DialogTitle className="font-display text-xl tracking-tight">
                  {appointment?.patient_name || "Atendimento"}
                </DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground mt-1">
                  {appointment?.procedure} · {appointment?.professional_name || "—"}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
        )}
        {/* Acessibilidade: garantir DialogTitle sempre presente para screen readers em inProgress */}
        {stage === "inProgress" && (
          <>
            <DialogTitle className="sr-only">{appointment?.patient_name || "Atendimento"}</DialogTitle>
            <DialogDescription className="sr-only">
              {appointment?.procedure} · {appointment?.professional_name || ""}
            </DialogDescription>
          </>
        )}

        {/* ⭐ Redesign 2026: Smart Header compacto/expandido + Foco */}
        {stage === "inProgress" && patient && (
          <div
            className={`border-b border-border bg-card shrink-0 transition-all duration-200 ${compactHeader ? "px-4 py-1.5" : "px-6 py-3"}`}
            data-testid="attendance-smart-header"
            data-compact={compactHeader}
          >
            {/* Linha principal - sempre visível (~48px em compact) */}
            <div className="flex items-center gap-3 min-h-[36px]">
              <span className="font-medium text-sm truncate flex-shrink-0" data-testid="hdr-patient-name">{patient.name}</span>
              {patientAge != null && <span className="text-[11px] text-muted-foreground">{patientAge} anos</span>}
              {patient.phone && !compactHeader && <span className="hidden md:inline text-[11px] text-muted-foreground">· {patient.phone}</span>}
              {!compactHeader && appointment?.procedure && (
                <span className="hidden md:inline text-[11px] text-muted-foreground truncate">· {appointment.procedure}</span>
              )}
              {!compactHeader && lastAttendance && (
                <span className="hidden lg:inline text-[10px] text-muted-foreground">· Último: {new Date(lastAttendance).toLocaleDateString("pt-BR")}</span>
              )}

              <span className="text-[10px] font-mono text-muted-foreground bg-muted rounded px-1.5 py-0.5 ml-auto" data-testid="attendance-timer">
                {String(Math.floor(seconds / 3600)).padStart(2, "0")}:{String(Math.floor((seconds % 3600) / 60)).padStart(2, "0")}:{String(seconds % 60).padStart(2, "0")}
              </span>

              {/* Compact alert chips (sempre visíveis, clicáveis) */}
              {alerts.length > 0 && (
                <div className="flex items-center gap-1" data-testid="attendance-alert-chips">
                  {alerts.slice(0, 4).map((a, i) => (
                    <button key={i} type="button" title={`${a.label}${a.detail ? " — " + a.detail : ""}`}
                      className={`inline-flex items-center h-6 w-6 justify-center rounded-full ring-1 ${
                        a.level === "danger" ? "bg-destructive/10 text-destructive ring-destructive/30" :
                        a.level === "warn" ? "bg-yellow-500/10 text-yellow-700 ring-yellow-500/30" :
                        "bg-primary/10 text-primary ring-primary/30"
                      }`}
                      data-testid={`alert-chip-${a.level}-${i}`}>
                      <AlertCircle className="h-3 w-3" strokeWidth={1.5} />
                    </button>
                  ))}
                </div>
              )}

              <Button
                type="button"
                size="sm"
                variant={focusMode ? "default" : "outline"}
                onClick={() => setFocusMode((v) => !v)}
                className="h-7 px-2 text-[10px] rounded-lg"
                data-testid="btn-focus-mode"
                title="Modo Foco: oculta alertas e progresso para máxima área clínica"
              >
                {focusMode ? "Sair do Foco" : "Foco"}
              </Button>

              <Button
                variant="outline"
                size="sm"
                onClick={() => setDocGenOpen(true)}
                className="h-7 rounded-lg text-[10px]"
                data-testid="btn-open-document-generator"
              >
                <FileSignature className="h-3 w-3 mr-1" />
                Doc
              </Button>
            </div>

            {/* Extras visíveis apenas em modo expandido e não-foco */}
            {!compactHeader && (
              <>
                {/* Progress bar (24px alt total) */}
                <div className="mt-2 flex items-center gap-3" data-testid="attendance-progress">
                  <div className="flex items-center gap-1 flex-wrap flex-1">
                    {progressSteps.map((s) => (
                      <span key={s.key}
                        className={`inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded ${s.done ? "text-success" : "text-muted-foreground"}`}
                        data-testid={`progress-step-${s.key}-${s.done ? "done" : "pending"}`}>
                        {s.done ? <CheckCircle2 className="h-2.5 w-2.5" /> : <span className="inline-block h-1.5 w-1.5 rounded-full bg-muted-foreground/30" />}
                        {s.label}
                      </span>
                    ))}
                  </div>
                  <div className="h-1 rounded-full bg-muted overflow-hidden w-32">
                    <div className="h-full bg-gradient-to-r from-primary to-success transition-all" style={{ width: `${progressPct}%` }} />
                  </div>
                  <span className="text-[10px] font-mono text-muted-foreground">{progressPct}%</span>
                </div>
              </>
            )}
          </div>
        )}

        {/* Body */}
        <div ref={bodyRef} className="flex-1 overflow-y-auto">
          {stage === "loading" && (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          )}

          {/* Completion */}
          {stage === "completion" && (
            <div className="p-6 space-y-5" data-testid="completion-step">
              <div className="flex items-start gap-3 p-4 rounded-xl bg-secondary/10 border border-secondary/30">
                <AlertCircle className="h-5 w-5 text-secondary shrink-0 mt-0.5" />
                <div>
                  <div className="font-medium text-sm">Pré-cadastro detectado</div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Complete os dados obrigatórios antes de iniciar o atendimento clínico.
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2 space-y-1.5">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">Nome completo *</Label>
                  <Input value={pForm.name || ""} onChange={(e) => setPForm({ ...pForm, name: e.target.value })}
                    className="h-11 rounded-xl" data-testid="comp-name" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">CPF *</Label>
                  <Input value={pForm.cpf || ""} onChange={(e) => setPForm({ ...pForm, cpf: e.target.value })}
                    className="h-11 rounded-xl" data-testid="comp-cpf" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">Nascimento *</Label>
                  <Input type="date" value={pForm.birth_date || ""} onChange={(e) => setPForm({ ...pForm, birth_date: e.target.value })}
                    className="h-11 rounded-xl" data-testid="comp-birth" />
                </div>
                <div className="col-span-2 space-y-1.5">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">Telefone *</Label>
                  <Input value={pForm.phone || ""} onChange={(e) => setPForm({ ...pForm, phone: e.target.value })}
                    className="h-11 rounded-xl" data-testid="comp-phone" />
                </div>
                <label className="col-span-2 flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={!!pForm.lgpd_consent}
                    onChange={(e) => setPForm({ ...pForm, lgpd_consent: e.target.checked })}
                    data-testid="comp-lgpd" />
                  Consentimento LGPD obtido
                </label>
              </div>
              <Button onClick={savePatient} disabled={busy} className="w-full rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 h-11"
                data-testid="completion-save-btn">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Salvar e iniciar atendimento"}
              </Button>
            </div>
          )}

          {/* In progress */}
          {stage === "inProgress" && session && (
            <div className="p-6">
              {locked && (
                <div className="mb-4 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 flex items-center justify-between gap-3 flex-wrap" data-testid="attendance-locked-banner">
                  <div className="flex items-center gap-2 text-sm">
                    <Lock className="h-4 w-4 text-primary" />
                    <span className="font-medium">Atendimento finalizado</span>
                    <span className="text-muted-foreground text-xs">
                      Somente leitura{session.finalized_at ? ` · ${new Date(session.finalized_at).toLocaleString("pt-BR")}` : ""}
                    </span>
                  </div>
                  <Button type="button" size="sm" variant="outline" onClick={() => setReopenOpen(true)} className="rounded-lg h-8 text-xs" data-testid="reopen-attendance-btn">
                    <Unlock className="h-3.5 w-3.5 mr-1" /> Reabrir atendimento
                  </Button>
                </div>
              )}
              <fieldset disabled={locked} className={`min-w-0 border-0 p-0 m-0 ${locked ? "opacity-80" : ""}`}>
              <Tabs value={tab} onValueChange={setTab}>
                <TabsList className="bg-muted/50 rounded-xl max-w-full overflow-x-auto justify-start">
                  <TabsTrigger value="ficha" data-testid="tab-ficha" className="rounded-lg data-[state=active]:bg-card data-[state=active]:text-primary">
                    <ClipboardList className="h-3.5 w-3.5 mr-1.5" />Ficha
                  </TabsTrigger>
                  <TabsTrigger value="evolucao" data-testid="tab-evolucao" className="rounded-lg data-[state=active]:bg-card data-[state=active]:text-primary">
                    <FileText className="h-3.5 w-3.5 mr-1.5" />Evolução
                  </TabsTrigger>
                  <TabsTrigger value="prescricao" data-testid="tab-prescricao" className="rounded-lg data-[state=active]:bg-card data-[state=active]:text-primary">
                    <Pill className="h-3.5 w-3.5 mr-1.5" />Prescrição
                  </TabsTrigger>
                  <TabsTrigger value="orcamento" data-testid="tab-orcamento" className="rounded-lg data-[state=active]:bg-card data-[state=active]:text-primary">
                    <Wallet className="h-3.5 w-3.5 mr-1.5" />Orçamento
                  </TabsTrigger>
                  <TabsTrigger value="assinatura" data-testid="tab-assinatura" className="rounded-lg data-[state=active]:bg-card data-[state=active]:text-primary">
                    <FileSignature className="h-3.5 w-3.5 mr-1.5" />Assinatura
                  </TabsTrigger>
                </TabsList>

                {/* Ficha */}
                <TabsContent value="ficha" className="mt-5">
                  <div className="flex flex-wrap gap-2 mb-4">
                    {MODULE_OPTIONS.map((m) => (
                      <button key={m.key} type="button"
                        onClick={() => setFichaModule(m.key)}
                        data-testid={`ficha-tab-${m.key}`}
                        className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                          fichaModule === m.key ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:text-foreground"
                        }`}>
                        {m.label}
                      </button>
                    ))}
                  </div>
                  <FichaForm
                    module={fichaModule}
                    schema={MODULE_OPTIONS.find((m) => m.key === fichaModule).schema}
                    patientId={patient.patient_id}
                    onAiSummary={(text) => autosave({ observations: `${session.observations || ""}\n\n[Resumo IA — ${fichaModule}]\n${text}`.trim() })}
                  />
                </TabsContent>

                {/* Evolução */}
                <TabsContent value="evolucao" className="mt-5 space-y-4">
                  {/* ⭐ Fase 4: Toolbar IA contextual */}
                  <div className="rounded-xl border border-primary/20 bg-primary/5 p-3" data-testid="ai-toolbar">
                    <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
                      <div className="flex items-center gap-1.5 text-xs text-primary">
                        <Sparkles className="h-3.5 w-3.5" />
                        <span className="font-semibold">IA Clínica contextual</span>
                        <span className="text-[10px] text-muted-foreground ml-2">considera paciente + histórico + ficha</span>
                      </div>
                      <div className="flex items-center gap-1 text-[10px]" data-testid="ai-mode-selector">
                        <span className="text-muted-foreground uppercase tracking-wider mr-1">Modo:</span>
                        {[
                          { k: "append", label: "Anexar" },
                          { k: "replace", label: "Substituir" },
                          { k: "improve", label: "Melhorar" },
                          { k: "rewrite", label: "Reescrever" },
                        ].map((m) => (
                          <button key={m.k} type="button" onClick={() => setAiMode(m.k)}
                            data-testid={`ai-mode-${m.k}`}
                            className={`px-2 py-0.5 rounded-full transition ${aiMode === m.k ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}>
                            {m.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <Button type="button" size="sm" variant="outline" onClick={generateEvolution} disabled={aiBusy} className="rounded-lg h-8 text-xs" data-testid="ai-generate-evolution-btn">
                        {aiBusy ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Sparkles className="h-3 w-3 mr-1" />} Evolução IA
                      </Button>
                      <Button type="button" size="sm" variant="outline" onClick={suggestProtocol} disabled={aiBusy} className="rounded-lg h-8 text-xs" data-testid="ai-suggest-protocol-btn">
                        <Sparkles className="h-3 w-3 mr-1" /> Protocolo
                      </Button>
                      <Button type="button" size="sm" variant="outline" onClick={checkContraindications} disabled={aiBusy} className="rounded-lg h-8 text-xs" data-testid="ai-contraindications-btn">
                        <AlertCircle className="h-3 w-3 mr-1" /> Contraindicações
                      </Button>
                      <Button type="button" size="sm" variant="outline" onClick={generateSessionSummary} disabled={aiBusy} className="rounded-lg h-8 text-xs" data-testid="ai-session-summary-btn">
                        <ClipboardList className="h-3 w-3 mr-1" /> Resumo da sessão
                      </Button>
                    </div>
                    {contraAlert && (
                      <div className="mt-3 rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-3 text-[12px] text-yellow-800" data-testid="ai-contra-alert">
                        <div className="flex items-start justify-between gap-2 mb-1">
                          <span className="font-semibold flex items-center gap-1"><AlertCircle className="h-3.5 w-3.5" /> Análise de contraindicações IA</span>
                          <button type="button" onClick={() => setContraAlert(null)} className="text-[10px] hover:underline">Fechar</button>
                        </div>
                        <pre className="whitespace-pre-wrap font-sans text-[12px]">{contraAlert}</pre>
                      </div>
                    )}
                  </div>

                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">Observações da sessão</Label>
                  <Textarea value={session.observations || ""} onChange={(e) => setSessionField("observations", e.target.value)}
                    placeholder="Observações livres do profissional..." rows={3} className="rounded-xl" data-testid="att-observations" />
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">Evolução clínica</Label>
                  <Textarea value={session.evolution || ""} onChange={(e) => setSessionField("evolution", e.target.value)}
                    placeholder="Descreva a evolução clínica desta sessão..." rows={14} className="rounded-xl min-h-[300px]" data-testid="att-evolution" />
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">Protocolo aplicado</Label>
                  <Textarea value={session.protocols || ""} onChange={(e) => setSessionField("protocols", e.target.value)}
                    placeholder="Protocolo, técnica, produtos utilizados..." rows={3} className="rounded-xl" data-testid="att-protocols" />
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">Produtos utilizados (lote/qtd)</Label>
                  <Input value={session.products_used || ""} onChange={(e) => setSessionField("products_used", e.target.value)}
                    placeholder="Ex: Botox Allergan 50U — Lote 12345" className="h-11 rounded-xl" data-testid="att-products" />

                  <div className="pt-4 border-t border-border space-y-4">
                    <PhotoUploader
                      label="Antes (procedimento)" testid="photos-before-uploader"
                      value={session.photos_before || []}
                      onChange={(urls) => setSessionField("photos_before", urls)}
                    />
                    <PhotoUploader
                      label="Depois (procedimento)" accent="primary" testid="photos-after-uploader"
                      value={session.photos_after || []}
                      onChange={(urls) => setSessionField("photos_after", urls)}
                    />
                  </div>
                </TabsContent>

                {/* Prescrição */}
                <TabsContent value="prescricao" className="mt-5 space-y-4">
                  <div className="p-3 rounded-xl bg-muted/40 text-xs text-muted-foreground">
                    <AlertCircle className="h-3.5 w-3.5 inline mr-1" />
                    Use este campo para orientações pós-procedimento e cuidados.
                    Apenas profissionais habilitados devem prescrever medicamentos.
                  </div>
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">Orientações / Receituário</Label>
                  <Textarea value={session.prescriptions || ""} onChange={(e) => setSessionField("prescriptions", e.target.value)}
                    placeholder="Orientações pós-procedimento, cuidados, retornos..." rows={16} className="rounded-xl min-h-[380px]" data-testid="att-prescriptions" />
                </TabsContent>

                {/* Orçamento */}
                <TabsContent value="orcamento" className="mt-5">
                  <BudgetEditor
                    patientId={session.patient_id}
                    appointmentId={session.appointment_id}
                    budgetId={linkedBudget?.budget_id}
                    onSaved={(b) => setLinkedBudget(b)}
                  />
                </TabsContent>

                {/* Assinatura */}
                <TabsContent value="assinatura" className="mt-5 space-y-6">
                  <div>
                    <div className="text-sm font-medium mb-3">Termo de Consentimento (paciente)</div>
                    <SignaturePad
                      testid="consent-signature"
                      value={session.consent_signature}
                      onChange={(v) => captureSignature("consent", v)}
                    />
                  </div>
                  <div>
                    <div className="text-sm font-medium mb-3">Assinatura de Evolução (profissional)</div>
                    <SignaturePad
                      testid="evolution-signature"
                      value={session.evolution_signature}
                      onChange={(v) => captureSignature("evolution", v)}
                    />
                  </div>
                </TabsContent>
              </Tabs>
              </fieldset>
            </div>
          )}

          {/* Done state removed (Correção 6): confirmFinalize closes the dialog directly. */}
        </div>

        {/* Footer actions */}
        {stage === "inProgress" && (
          <div className="border-t border-border px-6 py-3 flex items-center justify-between shrink-0 bg-card gap-3 flex-wrap" data-testid="attendance-footer">
            <Button variant="ghost" onClick={() => onOpenChange(false)} data-testid="attendance-close-draft-btn">
              {locked ? "Fechar" : "Salvar rascunho e sair"}
            </Button>
            {locked ? (
              <div className="flex items-center gap-3 ml-auto">
                <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <Lock className="h-3.5 w-3.5" /> Atendimento imutável
                </span>
                <Button type="button" variant="outline" onClick={() => setReopenOpen(true)} className="rounded-xl" data-testid="reopen-attendance-footer-btn">
                  <Unlock className="h-4 w-4 mr-1" /> Reabrir atendimento
                </Button>
              </div>
            ) : (
            /* ⭐ Fase 3: Financial preview inline */
            <div className="flex items-center gap-3 flex-wrap ml-auto">
              {financialPreviewTotal > 0 && (
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-muted/50 text-[11px]" data-testid="financial-preview">
                  <Wallet className="h-3.5 w-3.5 text-primary" strokeWidth={1.5} />
                  <div className="flex flex-col leading-tight">
                    <span className="text-muted-foreground text-[9px] uppercase tracking-wider">Total a lançar</span>
                    <span className="font-mono font-semibold text-sm">
                      R$ {financialPreviewTotal.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                  {linkedBudget?.installments > 1 && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary">
                      {linkedBudget.installments}x
                    </span>
                  )}
                </div>
              )}
              <Button onClick={finalize} disabled={busy} className="rounded-xl bg-primary text-primary-foreground hover:bg-primary/90" data-testid="finalize-attendance-btn">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <><CheckCircle2 className="h-4 w-4 mr-1" /> Concluir atendimento</>}
              </Button>
            </div>
            )}
          </div>
        )}

        {/* ⭐ Fase 6: Dialog de reabertura (justificativa obrigatória) */}
        <Dialog open={reopenOpen} onOpenChange={(v) => { if (!reopenBusy) setReopenOpen(v); }}>
          <DialogContent className="sm:max-w-md" data-testid="reopen-dialog">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2"><Unlock className="h-4 w-4 text-primary" /> Reabrir atendimento</DialogTitle>
              <DialogDescription>
                A justificativa é obrigatória e ficará registrada de forma permanente no prontuário do paciente (com data, hora, usuário e IP).
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Justificativa da reabertura</Label>
              <Textarea
                value={reopenReason}
                onChange={(e) => setReopenReason(e.target.value)}
                placeholder="Descreva o motivo da reabertura deste atendimento..."
                rows={4}
                className="rounded-xl"
                data-testid="reopen-reason-input"
              />
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <Button variant="ghost" onClick={() => setReopenOpen(false)} disabled={reopenBusy} data-testid="reopen-cancel-btn">Cancelar</Button>
              <Button onClick={confirmReopen} disabled={reopenBusy || reopenReason.trim().length < 3} className="rounded-xl bg-primary text-primary-foreground hover:bg-primary/90" data-testid="reopen-confirm-btn">
                {reopenBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Reabrir com justificativa"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        <CompletePaymentDialog
          open={paymentOpen}
          onOpenChange={setPaymentOpen}
          defaultTotal={appointment?.price || 0}
          budgetTotal={linkedBudget?.total}
          budgetId={linkedBudget?.budget_id}
          onConfirm={confirmFinalize}
        />

        <DocumentGenerator
          open={docGenOpen}
          onOpenChange={setDocGenOpen}
          patientId={session?.patient_id || appointment?.patient_id}
          appointmentId={appointment?.appointment_id}
          procedure={session?.procedure || appointment?.procedure}
          procedureValue={appointment?.price}
        />
      </DialogContent>
    </Dialog>
  );
}
