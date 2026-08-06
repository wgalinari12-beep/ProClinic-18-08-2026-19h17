import React, { useEffect, useState } from "react";
import api from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ChevronDown, ChevronRight, ClipboardList, ExternalLink,
  GitCompare, FileDown, Loader2, Sparkles,
} from "lucide-react";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";
import { getStatusMeta } from "@/lib/statusColors";

const MODULE_LABELS = {
  geral: "Anamnese Geral",
  facial: "Ficha Facial",
  injetaveis: "Injetáveis / Harmonização",
  corporal: "Ficha Corporal",
  capilar: "Ficha Capilar",
  epilacao: "Epilação",
};

const fmtDate = (iso) =>
  iso ? format(parseISO(iso), "dd 'de' MMM yyyy 'às' HH:mm", { locale: ptBR }) : "—";

const prettyKey = (k) => k.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
const answersOf = (ficha, mod) =>
  Object.entries(ficha?.[mod]?.answers || {}).filter(([k]) => !k.startsWith("_"));

function countAnswers(ficha) {
  if (!ficha) return 0;
  return Object.values(ficha).reduce(
    (acc, m) => acc + Object.keys(m?.answers || {}).filter((k) => !k.startsWith("_")).length,
    0,
  );
}

const renderVal = (v) => {
  if (v === null || v === undefined || v === "") return "—";
  if (Array.isArray(v)) return v.map((x) => (typeof x === "object" ? JSON.stringify(x) : String(x))).join(", ");
  if (typeof v === "object") return Object.entries(v).map(([k, val]) => `${k}: ${val}`).join(" · ");
  return String(v);
};

export default function PatientAnamneseTab({ patientId, onOpenSession, legacyAnamnesis = [] }) {
  const [entries, setEntries] = useState(null);
  const [expanded, setExpanded] = useState(new Set());
  const [comparing, setComparing] = useState(new Set());
  const [pdfBusy, setPdfBusy] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get(`/patients/${patientId}/timeline`);
        const list = (data.sessions || [])
          .filter((s) => s.ficha_snapshot && countAnswers(s.ficha_snapshot) > 0)
          .map((s) => ({
            session_id: s.session_id,
            session_number: s.session_number,
            status: s.status,
            date: s.finalized_at || s.started_at,
            professional_name: s.professional_name,
            procedure: s.procedure,
            evolution: s.medical_record?.evolution || "",
            ficha: s.ficha_snapshot,
          }));
        setEntries(list);
      } catch {
        setEntries([]);
      }
    })();
  }, [patientId]);

  const toggle = (setFn) => (id) =>
    setFn((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  const toggleExpand = toggle(setExpanded);
  const toggleCompare = toggle(setComparing);

  const downloadPDF = async () => {
    setPdfBusy(true);
    try {
      const { data } = await api.get(`/patients/${patientId}/ficha-pdf`);
      if (data?.url) {
        const base = process.env.REACT_APP_BACKEND_URL || "";
        const full = data.url.startsWith("http") ? data.url : `${base}${data.url}`;
        window.open(full, "_blank");
        toast.success("Ficha PDF gerada");
      }
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Falha ao gerar PDF");
    } finally {
      setPdfBusy(false);
    }
  };

  if (entries === null) {
    return <p className="text-sm text-muted-foreground py-8 text-center">Carregando anamneses...</p>;
  }

  if (entries.length === 0) {
    return (
      <div className="space-y-4">
        <div className="text-center py-12 text-muted-foreground border border-dashed border-border rounded-2xl" data-testid="empty-anamnese">
          <ClipboardList className="h-8 w-8 mx-auto mb-2 opacity-40" />
          Nenhuma anamnese registrada nos atendimentos ainda.
          <div className="text-xs mt-1">As fichas preenchidas durante o atendimento aparecerão aqui automaticamente.</div>
        </div>
        {legacyAnamnesis.length > 0 && <LegacyList items={legacyAnamnesis} />}
      </div>
    );
  }

  const renderFicha = (ficha) => (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {Object.keys(MODULE_LABELS)
        .filter((mod) => answersOf(ficha, mod).length > 0)
        .map((mod) => (
          <div key={mod} className="rounded-xl border border-border bg-muted/20 p-3">
            <div className="text-xs font-semibold text-primary mb-2 uppercase tracking-wider">{MODULE_LABELS[mod]}</div>
            <div className="space-y-1">
              {answersOf(ficha, mod).map(([k, v]) => (
                <div key={k} className="flex gap-2 text-[12px]">
                  <span className="text-muted-foreground shrink-0">{prettyKey(k)}:</span>
                  <span className="font-medium">{renderVal(v)}</span>
                </div>
              ))}
            </div>
            {ficha[mod]?.photos?.length > 0 && (
              <div className="mt-2 text-[11px] text-primary">📸 {ficha[mod].photos.length} foto(s)</div>
            )}
          </div>
        ))}
    </div>
  );

  const renderCompare = (curr, prev) => {
    // compara respostas do módulo geral (anamnese) entre a sessão atual e a anterior
    const currA = Object.fromEntries(answersOf(curr.ficha, "geral"));
    const prevA = Object.fromEntries(answersOf(prev.ficha, "geral"));
    const keys = Array.from(new Set([...Object.keys(currA), ...Object.keys(prevA)]));
    return (
      <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 mt-3" data-testid="anamnese-compare">
        <div className="text-xs font-semibold text-primary mb-2 flex items-center gap-1.5">
          <GitCompare className="h-3.5 w-3.5" /> Comparação — Anamnese Geral
        </div>
        <div className="grid grid-cols-[1fr_auto_1fr] gap-x-3 gap-y-1 text-[12px]">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Atual · {fmtDate(curr.date)}</div>
          <div />
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Anterior · {fmtDate(prev.date)}</div>
          {keys.map((k) => {
            const a = renderVal(currA[k]);
            const b = renderVal(prevA[k]);
            const changed = a !== b;
            return (
              <React.Fragment key={k}>
                <div className={changed ? "font-semibold text-foreground" : "text-muted-foreground"}>
                  <span className="text-[10px] text-muted-foreground block">{prettyKey(k)}</span>{a}
                </div>
                <div className="text-muted-foreground self-center">{changed ? "≠" : "="}</div>
                <div className={changed ? "font-semibold text-foreground" : "text-muted-foreground"}>
                  <span className="text-[10px] text-muted-foreground block">{prettyKey(k)}</span>{b}
                </div>
              </React.Fragment>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4" data-testid="anamnese-consolidated">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="text-xs text-muted-foreground">
          {entries.length} anamnese(s) registrada(s) nos atendimentos
        </div>
        <Button variant="outline" size="sm" onClick={downloadPDF} disabled={pdfBusy} className="rounded-lg" data-testid="anamnese-download-pdf">
          {pdfBusy ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <FileDown className="h-4 w-4 mr-1" />} Baixar ficha (PDF)
        </Button>
      </div>

      {entries.map((e, idx) => {
        const isOpen = expanded.has(e.session_id);
        const isCmp = comparing.has(e.session_id);
        const prev = entries[idx + 1];
        const meta = getStatusMeta(e.status);
        const isLatest = idx === 0;
        return (
          <div
            key={e.session_id}
            className={`rounded-2xl border bg-card ${isLatest ? "border-primary/40 shadow-sm" : "border-border"}`}
            data-testid={`anamnese-entry-${e.session_id}`}
          >
            <div className="p-4">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    {isLatest && (
                      <Badge className="bg-primary/10 text-primary border-0 text-[10px] flex items-center gap-1">
                        <Sparkles className="h-3 w-3" /> Última anamnese
                      </Badge>
                    )}
                    {e.session_number && (
                      <span className="font-mono text-[11px] px-2 py-0.5 rounded bg-muted text-muted-foreground">{e.session_number}</span>
                    )}
                    <Badge className="border-0 text-[10px] font-medium" style={{ backgroundColor: meta.tint, color: meta.text }}>
                      {meta.label}
                    </Badge>
                  </div>
                  <div className="font-medium mt-1.5">{e.procedure || "Atendimento"}</div>
                  <div className="text-[12px] text-muted-foreground mt-0.5">
                    {fmtDate(e.date)} · {e.professional_name || "—"} · {countAnswers(e.ficha)} respostas
                  </div>
                </div>
              </div>

              {/* Resumo clínico */}
              {e.evolution && (
                <div className="mt-3 text-[13px] text-muted-foreground line-clamp-3 whitespace-pre-wrap">
                  <span className="text-[10px] uppercase tracking-wider block text-muted-foreground/70">Resumo clínico</span>
                  {e.evolution}
                </div>
              )}

              {/* Ações */}
              <div className="flex items-center gap-2 mt-3 flex-wrap">
                <Button variant="outline" size="sm" onClick={() => toggleExpand(e.session_id)} className="rounded-lg h-8 text-xs" data-testid={`anamnese-view-${e.session_id}`}>
                  {isOpen ? <ChevronDown className="h-3.5 w-3.5 mr-1" /> : <ChevronRight className="h-3.5 w-3.5 mr-1" />} Ver completa
                </Button>
                {onOpenSession && (
                  <Button variant="ghost" size="sm" onClick={() => onOpenSession(e.session_id)} className="rounded-lg h-8 text-xs" data-testid={`anamnese-open-session-${e.session_id}`}>
                    <ExternalLink className="h-3.5 w-3.5 mr-1" /> Abrir atendimento original
                  </Button>
                )}
                {prev && (
                  <Button variant="ghost" size="sm" onClick={() => toggleCompare(e.session_id)} className="rounded-lg h-8 text-xs" data-testid={`anamnese-compare-${e.session_id}`}>
                    <GitCompare className="h-3.5 w-3.5 mr-1" /> Comparar com anterior
                  </Button>
                )}
              </div>

              {isCmp && prev && renderCompare(e, prev)}
            </div>

            {isOpen && (
              <div className="border-t border-border p-4" data-testid={`anamnese-full-${e.session_id}`}>
                {renderFicha(e.ficha)}
              </div>
            )}
          </div>
        );
      })}

      {legacyAnamnesis.length > 0 && <LegacyList items={legacyAnamnesis} />}
    </div>
  );
}

function LegacyList({ items }) {
  return (
    <div className="pt-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Anamneses avulsas (legado)</div>
      <div className="space-y-2">
        {items.map((a) => (
          <div key={a.anamnesis_id} className="border border-border rounded-xl p-3 text-sm">
            <div className="font-medium">{a.template_name || "Anamnese"}</div>
            <div className="text-xs text-muted-foreground">
              {a.created_at ? format(parseISO(a.created_at), "dd/MM/yyyy", { locale: ptBR }) : ""}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
