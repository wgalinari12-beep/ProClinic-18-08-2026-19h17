import React, { useEffect, useMemo, useRef, useState } from "react";
import api from "@/lib/api";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  Clock, AlertCircle, Save, Sparkles, FileSignature, CheckCircle2,
  ClipboardList, FileText, ImageIcon, Pill, Loader2, X,
} from "lucide-react";
import { toast } from "sonner";
import PhotoUploader from "@/components/PhotoUploader";
import SignaturePad from "@/components/SignaturePad";
import FichaForm from "@/components/FichaForm";
import {
  SCHEMA_GERAL, SCHEMA_FACIAL, SCHEMA_CORPORAL, SCHEMA_CAPILAR,
} from "@/components/ficha-schemas";

const MODULE_OPTIONS = [
  { key: "geral", label: "Geral", schema: SCHEMA_GERAL },
  { key: "facial", label: "Facial", schema: SCHEMA_FACIAL },
  { key: "corporal", label: "Corporal", schema: SCHEMA_CORPORAL },
  { key: "capilar", label: "Capilar", schema: SCHEMA_CAPILAR },
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
  const [aiBusy, setAiBusy] = useState(false);
  const tickRef = useRef(null);
  const saveTimerRef = useRef(null);

  // Patient completion form state (used when missing fields)
  const [pForm, setPForm] = useState({});

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
        setSeconds(sess.duration_seconds || 0);
        setStage("inProgress");
      } catch (e) {
        toast.error("Erro ao iniciar atendimento");
        onOpenChange(false);
      }
    })();
  }, [open, appointment, onOpenChange]);

  // Timer
  useEffect(() => {
    if (stage !== "inProgress") return;
    tickRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(tickRef.current);
  }, [stage]);

  // Autosave session (debounced) when session changes
  const autosave = (patch) => {
    setSession((s) => ({ ...s, ...patch }));
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      try {
        const merged = { ...session, ...patch, duration_seconds: seconds };
        const payload = {
          patient_id: merged.patient_id,
          appointment_id: merged.appointment_id,
          procedure: merged.procedure,
          professional_name: merged.professional_name,
          evolution: merged.evolution || "",
          observations: merged.observations || "",
          protocols: merged.protocols || "",
          prescriptions: merged.prescriptions || "",
          products_used: merged.products_used || "",
          photos_before: merged.photos_before || [],
          photos_after: merged.photos_after || [],
          consent_signature: merged.consent_signature || null,
          evolution_signature: merged.evolution_signature || null,
          status: "rascunho",
          duration_seconds: seconds,
        };
        const { data } = await api.put(`/attendance/${session.session_id}`, payload);
        setSession(data);
        setSavedAt(new Date());
      } catch { /* silent */ }
    }, 800);
  };

  const setSessionField = (k, v) => autosave({ [k]: v });

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
    }
  }, [open]);

  // === Patient completion submit ===
  const savePatient = async () => {
    setBusy(true);
    try {
      await api.put(`/patients/${patient.patient_id}`, {
        ...pForm,
        lgpd_consent: !!pForm.lgpd_consent,
      });
      const { data: sess } = await api.post(`/attendance/start`, {
        appointment_id: appointment.appointment_id,
      });
      setSession(sess);
      setStage("inProgress");
      toast.success("Cadastro completo. Atendimento iniciado");
    } catch (e) {
      toast.error("Erro ao salvar paciente");
    } finally { setBusy(false); }
  };

  // === AI helpers ===
  const callAi = async (type, notes) => {
    setAiBusy(true);
    try {
      const { data } = await api.post("/ai/generate", {
        type, patient_id: patient.patient_id, notes, context: appointment?.procedure,
      });
      return data.text;
    } catch (e) {
      toast.error("Falha IA");
      return null;
    } finally { setAiBusy(false); }
  };

  const generateEvolution = async () => {
    const notes = session.observations || session.evolution || "Atendimento padrão";
    const text = await callAi("evolution", notes);
    if (text) {
      const merged = `${session.evolution || ""}\n\n${text}`.trim();
      autosave({ evolution: merged });
      toast.success("Evolução IA gerada");
    }
  };

  const suggestProtocol = async () => {
    const text = await callAi("protocol", session.observations || appointment?.procedure);
    if (text) {
      const merged = `${session.protocols || ""}\n\n${text}`.trim();
      autosave({ protocols: merged });
      toast.success("Protocolo IA sugerido");
    }
  };

  // === Finalize ===
  const finalize = async () => {
    if (!session.evolution_signature) {
      toast.error("Capture a assinatura de evolução antes de finalizar");
      setTab("assinatura");
      return;
    }
    setBusy(true);
    try {
      // ensure latest data saved
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
        photos_before: session.photos_before || [],
        photos_after: session.photos_after || [],
        consent_signature: session.consent_signature || null,
        evolution_signature: session.evolution_signature || null,
        status: "rascunho",
        duration_seconds: seconds,
      });
      await api.post(`/attendance/${session.session_id}/finalize`);
      setStage("done");
      toast.success("Atendimento concluído");
      onCompleted?.();
    } catch (e) {
      toast.error("Erro ao finalizar");
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="attendance-dialog"
        className="max-w-4xl rounded-2xl p-0 max-h-[92vh] overflow-hidden flex flex-col"
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        {/* Header */}
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
            <div className="flex items-center gap-3">
              {stage === "inProgress" && (
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-primary/10 ring-1 ring-primary/30">
                  <Clock className="h-3.5 w-3.5 text-primary" />
                  <span className="font-mono text-sm" data-testid="attendance-timer">{fmtDuration(seconds)}</span>
                </div>
              )}
              {savedAt && stage === "inProgress" && (
                <Badge variant="outline" className="text-[10px] font-normal" data-testid="attendance-saved-indicator">
                  <CheckCircle2 className="h-2.5 w-2.5 mr-1 text-success" />
                  Rascunho salvo {savedAt.toLocaleTimeString("pt-BR").slice(0, 5)}
                </Badge>
              )}
            </div>
          </div>
        </DialogHeader>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
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
              <Tabs value={tab} onValueChange={setTab}>
                <TabsList className="bg-muted/50 rounded-xl">
                  <TabsTrigger value="ficha" data-testid="tab-ficha" className="rounded-lg data-[state=active]:bg-card data-[state=active]:text-primary">
                    <ClipboardList className="h-3.5 w-3.5 mr-1.5" />Ficha
                  </TabsTrigger>
                  <TabsTrigger value="evolucao" data-testid="tab-evolucao" className="rounded-lg data-[state=active]:bg-card data-[state=active]:text-primary">
                    <FileText className="h-3.5 w-3.5 mr-1.5" />Evolução
                  </TabsTrigger>
                  <TabsTrigger value="fotos" data-testid="tab-fotos" className="rounded-lg data-[state=active]:bg-card data-[state=active]:text-primary">
                    <ImageIcon className="h-3.5 w-3.5 mr-1.5" />Fotos
                  </TabsTrigger>
                  <TabsTrigger value="prescricao" data-testid="tab-prescricao" className="rounded-lg data-[state=active]:bg-card data-[state=active]:text-primary">
                    <Pill className="h-3.5 w-3.5 mr-1.5" />Prescrição
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
                  <div className="flex items-center justify-between">
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground">Observações da sessão</Label>
                    <div className="flex items-center gap-2">
                      <Button type="button" size="sm" variant="outline" onClick={generateEvolution} disabled={aiBusy} className="rounded-lg h-8 text-xs" data-testid="ai-generate-evolution-btn">
                        {aiBusy ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Sparkles className="h-3 w-3 mr-1" />} Gerar evolução IA
                      </Button>
                      <Button type="button" size="sm" variant="outline" onClick={suggestProtocol} disabled={aiBusy} className="rounded-lg h-8 text-xs" data-testid="ai-suggest-protocol-btn">
                        <Sparkles className="h-3 w-3 mr-1" /> Sugerir protocolo
                      </Button>
                    </div>
                  </div>
                  <Textarea value={session.observations || ""} onChange={(e) => setSessionField("observations", e.target.value)}
                    placeholder="Observações livres do profissional..." rows={3} className="rounded-xl" data-testid="att-observations" />
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">Evolução clínica</Label>
                  <Textarea value={session.evolution || ""} onChange={(e) => setSessionField("evolution", e.target.value)}
                    placeholder="Descreva a evolução clínica desta sessão..." rows={6} className="rounded-xl" data-testid="att-evolution" />
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">Protocolo aplicado</Label>
                  <Textarea value={session.protocols || ""} onChange={(e) => setSessionField("protocols", e.target.value)}
                    placeholder="Protocolo, técnica, produtos utilizados..." rows={3} className="rounded-xl" data-testid="att-protocols" />
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">Produtos utilizados (lote/qtd)</Label>
                  <Input value={session.products_used || ""} onChange={(e) => setSessionField("products_used", e.target.value)}
                    placeholder="Ex: Botox Allergan 50U — Lote 12345" className="h-11 rounded-xl" data-testid="att-products" />
                </TabsContent>

                {/* Fotos */}
                <TabsContent value="fotos" className="mt-5 space-y-6">
                  <PhotoUploader
                    label="Antes" testid="photos-before-uploader"
                    value={session.photos_before || []}
                    onChange={(urls) => setSessionField("photos_before", urls)}
                  />
                  <PhotoUploader
                    label="Depois" accent="primary" testid="photos-after-uploader"
                    value={session.photos_after || []}
                    onChange={(urls) => setSessionField("photos_after", urls)}
                  />
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
                    placeholder="Orientações pós-procedimento, cuidados, retornos..." rows={10} className="rounded-xl" data-testid="att-prescriptions" />
                </TabsContent>

                {/* Assinatura */}
                <TabsContent value="assinatura" className="mt-5 space-y-6">
                  <div>
                    <div className="text-sm font-medium mb-3">Termo de Consentimento (paciente)</div>
                    <SignaturePad
                      testid="consent-signature"
                      value={session.consent_signature}
                      onChange={(v) => setSessionField("consent_signature", v)}
                    />
                  </div>
                  <div>
                    <div className="text-sm font-medium mb-3">Assinatura de Evolução (profissional)</div>
                    <SignaturePad
                      testid="evolution-signature"
                      value={session.evolution_signature}
                      onChange={(v) => setSessionField("evolution_signature", v)}
                    />
                  </div>
                </TabsContent>
              </Tabs>
            </div>
          )}

          {/* Done */}
          {stage === "done" && (
            <div className="p-12 text-center" data-testid="attendance-done">
              <div className="h-16 w-16 mx-auto rounded-full bg-success/10 ring-1 ring-success/30 flex items-center justify-center">
                <CheckCircle2 className="h-8 w-8 text-success" strokeWidth={1.5} />
              </div>
              <h3 className="font-display text-2xl font-semibold tracking-tight mt-4">Atendimento concluído</h3>
              <p className="text-sm text-muted-foreground mt-1">Tudo foi registrado no prontuário do paciente.</p>
              <Button onClick={() => onOpenChange(false)} className="mt-6 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90">
                Fechar
              </Button>
            </div>
          )}
        </div>

        {/* Footer actions */}
        {stage === "inProgress" && (
          <div className="border-t border-border px-6 py-3 flex items-center justify-between shrink-0 bg-card">
            <Button variant="ghost" onClick={() => onOpenChange(false)} data-testid="attendance-close-draft-btn">
              Salvar rascunho e sair
            </Button>
            <Button onClick={finalize} disabled={busy} className="rounded-xl bg-primary text-primary-foreground hover:bg-primary/90" data-testid="finalize-attendance-btn">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <><CheckCircle2 className="h-4 w-4 mr-1" /> Concluir atendimento</>}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
