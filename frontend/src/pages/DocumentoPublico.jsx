import React, { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import axios from "axios";
import SignaturePadPremium from "@/components/SignaturePadPremium";
import { resolveFileUrl } from "@/lib/api";
import { toLegibleHex, getContrastHex, isValidHex, normalizeHex } from "@/lib/color";
import {
  Loader2, CheckCircle2, XCircle, ShieldCheck, FileText, Maximize2, X,
  CalendarDays, Clock, User, Stethoscope, Hash, ArrowRight, Sparkles, FileSignature,
} from "lucide-react";
import { toast } from "sonner";

/* ---------- helpers (100% client-side, sem impacto no backend) ---------- */
function deviceLabel() {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  if (/iPad/i.test(ua) || (/Macintosh/i.test(ua) && typeof document !== "undefined" && "ontouchend" in document)) return "iPad / Tablet";
  if (/iPhone/i.test(ua)) return "iPhone";
  if (/Android/i.test(ua)) return /Mobile/i.test(ua) ? "Celular Android" : "Tablet Android";
  if (/Mobi/i.test(ua)) return "Celular";
  return "Computador";
}
function fmtDate(iso) {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" }); }
  catch { return "—"; }
}
function fmtTime(iso) {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }); }
  catch { return "—"; }
}
function shortProtocol(id) {
  if (!id) return "—";
  return String(id).replace(/^doc[_-]?/i, "").toUpperCase().slice(0, 12);
}

/* ---------- Stepper ---------- */
function Stepper({ current, brand, done }) {
  const steps = [
    { key: "loaded", label: "Documento" },
    { key: "read", label: "Leitura" },
    { key: "sign", label: "Assinatura" },
    { key: "final", label: "Finalização" },
  ];
  const idx = done ? 3 : current;
  return (
    <div className="flex items-center w-full" data-testid="dp-stepper">
      {steps.map((s, i) => {
        const state = i < idx ? "done" : i === idx ? "active" : "todo";
        return (
          <React.Fragment key={s.key}>
            <div className="flex flex-col items-center gap-1.5 shrink-0">
              <div
                className="h-8 w-8 rounded-full flex items-center justify-center text-xs font-semibold transition-all"
                style={
                  state === "done"
                    ? { backgroundColor: brand, color: getContrastHex(brand) }
                    : state === "active"
                    ? { backgroundColor: "#fff", color: brand, boxShadow: `0 0 0 2px ${brand}` }
                    : { backgroundColor: "#f1f1f1", color: "#9ca3af" }
                }
              >
                {state === "done" ? <CheckCircle2 className="h-4 w-4" /> : i + 1}
              </div>
              <span className="text-[10px] sm:text-[11px] font-medium tracking-tight" style={{ color: state === "todo" ? "#9ca3af" : "#4b5563" }}>
                {s.label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div className="flex-1 h-[2px] mx-1 sm:mx-2 rounded-full -mt-4" style={{ backgroundColor: i < idx ? brand : "#e5e7eb" }} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

export default function DocumentoPublico() {
  const { token } = useParams();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [signature, setSignature] = useState(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [signedAt, setSignedAt] = useState(null);

  const api = useMemo(() => axios.create({ baseURL: process.env.REACT_APP_BACKEND_URL }), []);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get(`/api/public/documents/${token}`);
        setData(data);
        if (data.has_patient_signature) {
          setDone(true);
          setSignedAt(data.document?.signed_patient_at || null);
        }
      } catch (e) {
        setError(e.response?.data?.detail || "Documento indisponível");
      } finally { setLoading(false); }
    })();
  }, [token, api]);

  const submit = async () => {
    if (!signature) { toast.error("Confirme sua assinatura para concluir"); return; }
    setBusy(true);
    try {
      await api.post(`/api/public/documents/${token}/sign-patient`, {
        signature,
        device: /Mobi|Android|iPhone/i.test(navigator.userAgent) ? "mobile-qr" : "desktop",
      });
      // Re-busca para obter signed_patient_at (contrato inalterado)
      let sa = new Date().toISOString();
      try {
        const { data: fresh } = await api.get(`/api/public/documents/${token}`);
        setData(fresh);
        sa = fresh.document?.signed_patient_at || sa;
      } catch { /* fallback client-side */ }
      setSignedAt(sa);
      setDone(true);
      toast.success("Assinatura registrada com sucesso");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      toast.error(e.response?.data?.detail || "Erro ao registrar assinatura");
    } finally { setBusy(false); }
  };

  /* ---------- Loading / Error ---------- */
  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#faf7f5]">
        <Loader2 className="h-7 w-7 animate-spin" style={{ color: "#B76E79" }} />
        <p className="text-sm text-gray-500 mt-3">Carregando documento...</p>
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#faf7f5] p-8 text-center">
        <XCircle className="h-12 w-12 text-red-400 mb-3" strokeWidth={1.5} />
        <h1 className="text-2xl font-semibold tracking-tight text-gray-800">Não foi possível carregar</h1>
        <p className="text-sm text-gray-500 mt-1">{error || "Link inválido ou expirado."}</p>
      </div>
    );
  }

  const doc = data.document || {};
  const clinic = data.clinic || {};
  const rawPrimary = normalizeHex(clinic.primary_color || "#B76E79");
  const brand = isValidHex(rawPrimary) ? rawPrimary : "#B76E79";
  const brandText = toLegibleHex(brand);
  const onBrand = getContrastHex(brand);
  const logo = clinic.logo_url ? resolveFileUrl(clinic.logo_url) : null;
  const clinicName = clinic.name || "ProClinic";
  const protocolo = shortProtocol(doc.document_id);

  return (
    <div className="min-h-screen bg-[#faf7f5] text-gray-800" style={{ WebkitTapHighlightColor: "transparent" }}>
      {/* ===== Cabeçalho premium ===== */}
      <header className="bg-white border-b border-gray-100">
        <div className="max-w-2xl mx-auto px-5 pt-5 pb-4">
          <div className="flex items-center gap-3">
            {logo ? (
              <img src={logo} alt={clinicName} className="h-11 w-11 rounded-xl object-cover ring-1 ring-gray-100" />
            ) : (
              <div className="h-11 w-11 rounded-xl flex items-center justify-center" style={{ backgroundColor: `${brand}1a`, color: brandText }}>
                <Sparkles className="h-5 w-5" strokeWidth={1.6} />
              </div>
            )}
            <div className="leading-tight">
              <div className="text-base font-semibold tracking-tight text-gray-900">{clinicName}</div>
              <div className="text-[10px] uppercase tracking-[0.18em] text-gray-400">Assinatura Digital</div>
            </div>
          </div>
          <h1 className="mt-4 text-xl sm:text-2xl font-semibold tracking-tight text-gray-900">
            Assinatura Digital do Documento
          </h1>
          <p className="text-sm text-gray-500 mt-1">Leia atentamente e assine abaixo para concluir este processo.</p>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-5 py-6 space-y-5" data-testid="documento-publico">
        {/* ===== Stepper ===== */}
        <div className="bg-white rounded-2xl border border-gray-100 px-5 py-4 shadow-[0_1px_2px_rgba(0,0,0,0.03)]">
          <Stepper current={2} brand={brand} done={done} />
        </div>

        {/* ===== Card identificação ===== */}
        <section className="bg-white rounded-2xl border border-gray-100 p-5 shadow-[0_1px_2px_rgba(0,0,0,0.03)]" data-testid="dp-identificacao">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[10px] uppercase tracking-[0.18em] text-gray-400">Documento para</div>
              <div className="text-lg font-semibold text-gray-900">{doc.patient_name || "Paciente"}</div>
            </div>
            {done ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-green-50 text-green-700 text-xs font-medium px-3 py-1.5">
                <CheckCircle2 className="h-3.5 w-3.5" /> Assinado
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 text-amber-700 text-xs font-medium px-3 py-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" /> Aguardando assinatura
              </span>
            )}
          </div>

          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
            <InfoRow icon={FileText} brand={brandText} label="Documento" value={doc.template_name || "Documento"} />
            <InfoRow icon={Hash} brand={brandText} label="Número do documento" value={protocolo} />
            <InfoRow icon={CalendarDays} brand={brandText} label="Data" value={fmtDate(doc.created_at)} />
            <InfoRow icon={Clock} brand={brandText} label="Horário" value={fmtTime(doc.created_at)} />
            <InfoRow icon={Stethoscope} brand={brandText} label="Profissional responsável" value={doc.professional_name || "—"} />
            {doc.procedure && <InfoRow icon={User} brand={brandText} label="Procedimento" value={doc.procedure} />}
          </div>
        </section>

        {/* ===== Leitura do documento ===== */}
        <section className="bg-white rounded-2xl border border-gray-100 p-5 shadow-[0_1px_2px_rgba(0,0,0,0.03)]">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: `${brand}14`, color: brandText }}>
                <FileText className="h-4 w-4" strokeWidth={1.7} />
              </div>
              <span className="text-sm font-medium text-gray-700">Conteúdo do documento</span>
            </div>
            <button
              onClick={() => setExpanded(true)}
              data-testid="dp-expand"
              className="inline-flex items-center gap-1.5 text-xs font-medium rounded-lg px-3 py-2 border border-gray-200 text-gray-600 active:scale-[0.98] transition"
            >
              <Maximize2 className="h-3.5 w-3.5" /> Expandir
            </button>
          </div>
          <p className="text-xs text-gray-500 mb-3">Leia atentamente o conteúdo abaixo antes de assinar.</p>
          <div
            className="rounded-xl border border-gray-100 bg-gray-50/50 p-4 max-h-64 overflow-y-auto overflow-x-hidden prose prose-sm max-w-none break-words [&_*]:max-w-full [&_img]:h-auto"
            dangerouslySetInnerHTML={{ __html: doc.content_html || "<p>Documento sem conteúdo textual.</p>" }}
          />
        </section>

        {done ? (
          /* ===== Tela de sucesso ===== */
          <section
            className="bg-white rounded-2xl border-2 p-6 text-center shadow-sm"
            style={{ borderColor: "#bbf7d0" }}
            data-testid="doc-signed-ok"
          >
            <div className="h-16 w-16 rounded-full bg-green-50 flex items-center justify-center mx-auto mb-3">
              <CheckCircle2 className="h-9 w-9 text-green-600" strokeWidth={1.6} />
            </div>
            <h2 className="text-xl font-semibold text-gray-900">Assinatura registrada com sucesso</h2>
            <p className="text-sm text-gray-500 mt-1">Você pode fechar esta página com segurança.</p>

            <div className="mt-5 text-left rounded-xl bg-gray-50 border border-gray-100 divide-y divide-gray-100">
              <SuccessRow label="Documento assinado" value={doc.template_name || "Documento"} />
              <SuccessRow label="Paciente" value={doc.patient_name || "—"} />
              <SuccessRow label="Data" value={fmtDate(signedAt)} />
              <SuccessRow label="Hora" value={fmtTime(signedAt)} />
              <SuccessRow label="Dispositivo utilizado" value={deviceLabel()} />
              <SuccessRow label="Número do protocolo" value={protocolo} mono />
            </div>

            <p className="text-[11px] text-gray-400 mt-4 leading-relaxed">
              Esta assinatura foi vinculada eletronicamente ao documento para fins de auditoria e rastreabilidade.
            </p>
          </section>
        ) : (
          /* ===== Área de assinatura ===== */
          <section className="bg-white rounded-2xl border border-gray-100 p-5 shadow-[0_1px_2px_rgba(0,0,0,0.03)]" data-testid="dp-assinatura">
            <div className="flex items-center gap-2 mb-1">
              <FileSignature className="h-5 w-5" style={{ color: brandText }} strokeWidth={1.7} />
              <h2 className="text-base font-semibold text-gray-900">Assinatura do Paciente</h2>
            </div>
            <p className="text-xs text-gray-500 mb-4">Utilize o dedo ou uma caneta touch para reproduzir sua assinatura.</p>

            <SignaturePadPremium brand={brand} onChange={setSignature} testid="doc-public-signature" />

            <button
              onClick={submit}
              disabled={busy || !signature}
              data-testid="doc-public-submit"
              className="mt-5 w-full h-14 rounded-2xl text-base font-semibold flex items-center justify-center gap-2 transition active:scale-[0.99] disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ backgroundColor: brand, color: onBrand }}
            >
              {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <>Concluir Assinatura <ArrowRight className="h-5 w-5" /></>}
            </button>
            {!signature && (
              <p className="text-[11px] text-gray-400 text-center mt-2">
                Confirme sua assinatura no campo acima para habilitar a conclusão.
              </p>
            )}
          </section>
        )}

        {/* ===== Rodapé ===== */}
        <div className="text-center text-[11px] text-gray-400 pt-2 pb-6 flex items-center justify-center gap-1.5">
          <ShieldCheck className="h-3.5 w-3.5" /> Conexão segura · {clinicName}
        </div>
      </main>

      {/* ===== Modal Expandir documento ===== */}
      {expanded && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-end sm:items-center justify-center" data-testid="dp-expand-modal">
          <div className="bg-white w-full sm:max-w-2xl sm:rounded-2xl rounded-t-2xl max-h-[92vh] flex flex-col overflow-hidden shadow-2xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 sticky top-0 bg-white">
              <div className="flex items-center gap-2">
                <FileText className="h-5 w-5" style={{ color: brandText }} strokeWidth={1.7} />
                <span className="text-sm font-semibold text-gray-800">{doc.template_name || "Documento"}</span>
              </div>
              <button onClick={() => setExpanded(false)} className="h-10 w-10 rounded-full flex items-center justify-center hover:bg-gray-100 active:scale-95 transition" data-testid="dp-expand-close">
                <X className="h-5 w-5 text-gray-500" />
              </button>
            </div>
            <div
              className="overflow-y-auto overflow-x-hidden px-6 py-5 prose prose-sm max-w-none break-words [&_*]:max-w-full [&_img]:h-auto"
              dangerouslySetInnerHTML={{ __html: doc.content_html || "<p>Documento sem conteúdo textual.</p>" }}
            />
          </div>
        </div>
      )}

      {/* ===== Overlay de processamento ===== */}
      {busy && (
        <div className="fixed inset-0 z-[60] bg-white/80 backdrop-blur-sm flex flex-col items-center justify-center" data-testid="dp-processing">
          <div className="h-14 w-14 rounded-full flex items-center justify-center" style={{ backgroundColor: `${brand}1a` }}>
            <Loader2 className="h-7 w-7 animate-spin" style={{ color: brand }} />
          </div>
          <p className="text-sm font-medium text-gray-700 mt-4">Registrando assinatura...</p>
          <p className="text-xs text-gray-400 mt-1">Aguarde um instante, não feche esta página.</p>
        </div>
      )}
    </div>
  );
}

/* ---------- subcomponentes de linha ---------- */
function InfoRow({ icon: Icon, label, value, brand }) {
  return (
    <div className="flex items-start gap-2.5">
      <Icon className="h-4 w-4 mt-0.5 shrink-0" style={{ color: brand }} strokeWidth={1.7} />
      <div className="min-w-0">
        <div className="text-[10px] uppercase tracking-wider text-gray-400">{label}</div>
        <div className="text-sm text-gray-800 font-medium break-words">{value}</div>
      </div>
    </div>
  );
}

function SuccessRow({ label, value, mono }) {
  return (
    <div className="flex items-center justify-between px-4 py-3 gap-3">
      <span className="text-xs text-gray-500 shrink-0">{label}</span>
      <span className={`text-sm font-medium text-gray-800 text-right break-words ${mono ? "font-mono tracking-wide" : ""}`}>{value}</span>
    </div>
  );
}
