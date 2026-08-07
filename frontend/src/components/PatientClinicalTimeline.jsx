import React, { useCallback, useEffect, useState } from "react";
import api from "@/lib/api";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ChevronDown, ChevronRight, Clock, CheckCircle2, FileText,
  ClipboardList, Wallet, Receipt, PenLine, Camera, ShieldCheck,
  FileDown, Loader2, Search,
} from "lucide-react";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { getStatusMeta } from "@/lib/statusColors";

const brl = (n) => (Number(n) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtDate = (iso) => (iso ? format(parseISO(iso), "dd/MM/yyyy HH:mm", { locale: ptBR }) : "—");
const fmtDur = (s) => {
  const min = Math.floor((s || 0) / 60);
  const sec = (s || 0) % 60;
  return `${min}min ${sec}s`;
};

export default function PatientClinicalTimeline({ patientId, focusSessionId }) {
  const [data, setData] = useState(null);
  const [expanded, setExpanded] = useState(new Set());
  const [pdfBusy, setPdfBusy] = useState(false);
  // ⭐ Lote 4 / Fase C: prontuário PDF + filtros + carregamento em partes
  const [prontBusy, setProntBusy] = useState(false);
  const PAGE = 10;
  const [q, setQ] = useState("");
  const [proFilter, setProFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [dFrom, setDFrom] = useState("");
  const [dTo, setDTo] = useState("");
  const [visibleCount, setVisibleCount] = useState(PAGE);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get(`/patients/${patientId}/timeline`);
      setData(data);
    } catch (e) {
      setData({ forbidden: true });
    }
  }, [patientId]);

  useEffect(() => { load(); }, [load]);

  // ⭐ Fase 7: quando aberto a partir de outra aba, expande e rola até a sessão
  useEffect(() => {
    if (!focusSessionId || !data) return;
    setExpanded((prev) => new Set(prev).add(focusSessionId));
    const t = setTimeout(() => {
      const el = document.querySelector(`[data-testid="session-${focusSessionId}"]`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 200);
    return () => clearTimeout(t);
  }, [focusSessionId, data]);

  const downloadFichaPDF = async () => {
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
      const msg = e?.response?.data?.detail || "Falha ao gerar PDF";
      toast.error(msg);
    } finally {
      setPdfBusy(false);
    }
  };

  const downloadProntuarioPDF = async () => {
    setProntBusy(true);
    try {
      const { data } = await api.get(`/patients/${patientId}/prontuario-pdf`);
      if (data?.url) {
        const base = process.env.REACT_APP_BACKEND_URL || "";
        const full = data.url.startsWith("http") ? data.url : `${base}${data.url}`;
        window.open(full, "_blank");
        toast.success("Prontuário completo gerado");
      }
    } catch (e) {
      const msg = e?.response?.data?.detail || "Falha ao gerar prontuário PDF";
      toast.error(msg);
    } finally {
      setProntBusy(false);
    }
  };

  const toggle = (sid) => {
    setExpanded((prev) => {
      const s = new Set(prev);
      s.has(sid) ? s.delete(sid) : s.add(sid);
      return s;
    });
  };

  if (!data) return <p className="text-sm text-muted-foreground py-8 text-center">Carregando timeline...</p>;
  if (data.forbidden) return <p className="text-sm text-muted-foreground py-8 text-center">Você não tem permissão.</p>;

  const { sessions = [], legacy_records = [], counts = {} } = data;

  // ⭐ Lote 4 / Fase C (C2): filtros + carregamento em partes (client-side)
  const professionals = Array.from(new Set(sessions.map((s) => s.professional_name).filter(Boolean)));
  const hasType = (s, t) => {
    if (t === "all") return true;
    if (t === "evolucao") return !!s.medical_record;
    if (t === "ficha") return s.ficha_snapshot && Object.keys(s.ficha_snapshot).length > 0;
    if (t === "assinatura") return !!(s.signatures?.consent || s.signatures?.evolution);
    if (t === "financeiro") return (s.financial_entries?.length > 0) || !!s.budget;
    return true;
  };
  const ql = q.trim().toLowerCase();
  const filtered = sessions.filter((s) => {
    if (proFilter !== "all" && s.professional_name !== proFilter) return false;
    if (!hasType(s, typeFilter)) return false;
    const d = (s.started_at || "").slice(0, 10);
    if (dFrom && d && d < dFrom) return false;
    if (dTo && d && d > dTo) return false;
    if (ql) {
      const hay = [s.procedure, s.professional_name, s.medical_record?.evolution,
        s.medical_record?.observations, s.session_number].filter(Boolean).join(" ").toLowerCase();
      if (!hay.includes(ql)) return false;
    }
    return true;
  });
  const visible = filtered.slice(0, visibleCount);
  const resetPage = () => setVisibleCount(PAGE);

  return (
    <div className="space-y-6" data-testid="clinical-timeline">
      {/* Actions */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="font-display text-lg font-semibold tracking-tight">Histórico Clínico</h3>
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={downloadProntuarioPDF}
            disabled={prontBusy}
            className="rounded-lg h-9 text-xs"
            data-testid="download-prontuario-pdf"
          >
            {prontBusy ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <FileText className="h-3.5 w-3.5 mr-1.5" />}
            Prontuário Completo (PDF)
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={downloadFichaPDF}
            disabled={pdfBusy}
            className="rounded-lg h-9 text-xs"
            data-testid="download-ficha-pdf"
          >
            {pdfBusy ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <FileDown className="h-3.5 w-3.5 mr-1.5" />}
            Baixar Ficha Premium (PDF)
          </Button>
        </div>
      </div>

      {/* Header stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Sessões" value={counts.sessions} icon={ClipboardList} tone="primary" />
        <StatCard label="Concluídas" value={counts.concluidas} icon={CheckCircle2} tone="success" />
        <StatCard label="Em andamento" value={counts.em_andamento} icon={Clock} tone="warning" />
        <StatCard label="Registros legado" value={counts.legacy} icon={FileText} tone="muted" />
      </div>

      {/* ⭐ Fase C: filtros do histórico */}
      {sessions.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap" data-testid="timeline-filters">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input value={q} onChange={(e) => { setQ(e.target.value); resetPage(); }} placeholder="Buscar no histórico..." className="pl-9 h-9 rounded-lg text-sm" data-testid="timeline-search" />
          </div>
          <select value={proFilter} onChange={(e) => { setProFilter(e.target.value); resetPage(); }} className="h-9 rounded-lg border border-border bg-card px-2 text-xs" data-testid="timeline-pro-filter">
            <option value="all">Todos profissionais</option>
            {professionals.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <select value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value); resetPage(); }} className="h-9 rounded-lg border border-border bg-card px-2 text-xs" data-testid="timeline-type-filter">
            <option value="all">Todos os eventos</option>
            <option value="evolucao">Com evolução</option>
            <option value="ficha">Com ficha</option>
            <option value="assinatura">Com assinatura</option>
            <option value="financeiro">Com financeiro</option>
          </select>
          <input type="date" value={dFrom} onChange={(e) => { setDFrom(e.target.value); resetPage(); }} className="h-9 rounded-lg border border-border bg-card px-2 text-xs" data-testid="timeline-date-from" title="De" />
          <input type="date" value={dTo} onChange={(e) => { setDTo(e.target.value); resetPage(); }} className="h-9 rounded-lg border border-border bg-card px-2 text-xs" data-testid="timeline-date-to" title="Até" />
          <div className="text-[11px] text-muted-foreground">{filtered.length}/{sessions.length}</div>
        </div>
      )}

      {/* Sessions timeline */}
      {sessions.length === 0 && legacy_records.length === 0 ? (
        <p className="text-sm text-muted-foreground py-12 text-center">Nenhum atendimento registrado para este paciente ainda.</p>
      ) : (
        <ol className="relative border-l-2 border-border pl-6 space-y-4" data-testid="timeline-list">
          {sessions.length > 0 && filtered.length === 0 && (
            <li className="text-sm text-muted-foreground py-6" data-testid="timeline-no-results">Nenhum resultado para os filtros aplicados.</li>
          )}
          {visible.map((s) => {
            const isOpen = expanded.has(s.session_id);
            const meta = getStatusMeta(s.status); // ⭐ Fase 2/7: cor única de status
            const reopens = s.medical_record?.reopen_history || [];
            return (
              <li key={s.session_id} className="relative" data-testid={`session-${s.session_id}`}>
                <span className="absolute -left-[33px] top-2 h-3 w-3 rounded-full ring-4 ring-background" style={{ backgroundColor: meta.color }} />
                <div className="rounded-2xl border border-border bg-card">
                  {/* Session header (clickable) */}
                  <button
                    className="w-full flex items-center justify-between p-4 text-left hover:bg-muted/20 transition"
                    onClick={() => toggle(s.session_id)}
                    data-testid={`session-toggle-${s.session_id}`}>
                    <div className="flex items-center gap-3">
                      {isOpen ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          {s.session_number && <span className="font-mono text-[11px] px-2 py-0.5 rounded bg-primary/10 text-primary">{s.session_number}</span>}
                          <span className="font-medium text-sm">{s.procedure || "Atendimento"}</span>
                          <Badge className="border-0 text-[10px] font-medium" style={{ backgroundColor: meta.tint, color: meta.text }}>
                            {meta.label}
                          </Badge>
                          {reopens.length > 0 && (
                            <Badge variant="outline" className="text-[10px] border-amber-400/50 text-amber-600">
                              Reaberto {reopens.length}×
                            </Badge>
                          )}
                        </div>
                        <div className="text-[11px] text-muted-foreground mt-0.5">
                          {s.professional_name} · {fmtDate(s.started_at)} · {fmtDur(s.duration_seconds)}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap justify-end">
                      {s.medical_record && <ChipIcon Icon={FileText} label="Prontuário" />}
                      {s.ficha_snapshot && Object.keys(s.ficha_snapshot).length > 0 && <ChipIcon Icon={ClipboardList} label={`Ficha (${Object.keys(s.ficha_snapshot).length})`} />}
                      {(s.medical_record?.photos_before?.length + s.medical_record?.photos_after?.length) > 0 && <ChipIcon Icon={Camera} label="Fotos" />}
                      {s.signatures?.consent && <ChipIcon Icon={PenLine} label="TCLE" />}
                      {s.signatures?.evolution && <ChipIcon Icon={ShieldCheck} label="Evolução assinada" />}
                      {s.budget && <ChipIcon Icon={Wallet} label="Orçamento" />}
                      {s.receipts.length > 0 && <ChipIcon Icon={Receipt} label={`${s.receipts.length} recibo(s)`} />}
                    </div>
                  </button>

                  {/* Expanded content */}
                  {isOpen && (
                    <div className="border-t border-border p-5 space-y-5" data-testid={`session-detail-${s.session_id}`}>
                      {/* Evolução & prontuário */}
                      {s.medical_record && (
                        <Section title="Evolução clínica">
                          {s.medical_record.evolution && (
                            <Field label="Evolução"><pre className="whitespace-pre-wrap text-[13px] font-sans">{s.medical_record.evolution}</pre></Field>
                          )}
                          {s.medical_record.observations && (
                            <Field label="Observações"><pre className="whitespace-pre-wrap text-[13px] font-sans">{s.medical_record.observations}</pre></Field>
                          )}
                          {s.medical_record.protocols && (
                            <Field label="Protocolo"><pre className="whitespace-pre-wrap text-[13px] font-sans">{s.medical_record.protocols}</pre></Field>
                          )}
                          {s.medical_record.prescriptions && (
                            <Field label="Prescrição"><pre className="whitespace-pre-wrap text-[13px] font-sans">{s.medical_record.prescriptions}</pre></Field>
                          )}
                        </Section>
                      )}

                      {/* ⭐ Fase 6/7: histórico de reaberturas (auditoria permanente) */}
                      {reopens.length > 0 && (
                        <Section title="Reaberturas do atendimento (auditoria)">
                          <div className="space-y-2">
                            {reopens.map((rh, idx) => (
                              <div key={idx} className="rounded-lg border border-amber-400/40 bg-amber-500/5 p-3 text-[12px]" data-testid={`reopen-audit-${idx}`}>
                                <div className="flex items-center justify-between gap-2 flex-wrap">
                                  <span className="font-medium text-amber-700">
                                    {rh.reopened_by_name || "Usuário"} {rh.reopened_by_role ? `(${rh.reopened_by_role})` : ""}
                                  </span>
                                  <span className="text-muted-foreground">{fmtDate(rh.reopened_at)}</span>
                                </div>
                                <div className="mt-1"><span className="text-muted-foreground">Justificativa: </span>{rh.reason}</div>
                                {rh.ip && <div className="text-[10px] text-muted-foreground mt-0.5">IP: {rh.ip}</div>}
                              </div>
                            ))}
                          </div>
                        </Section>
                      )}

                      {/* Ficha snapshot */}
                      {s.ficha_snapshot && Object.keys(s.ficha_snapshot).length > 0 && (
                        <Section title="Ficha (snapshot da sessão)">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            {Object.entries(s.ficha_snapshot).map(([mod, content]) => (
                              <div key={mod} className="rounded-xl border border-border p-3 bg-muted/10">
                                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Módulo {mod}</div>
                                {content.answers && Object.keys(content.answers).length > 0 ? (
                                  <dl className="grid grid-cols-1 gap-1 text-[12px]">
                                    {Object.entries(content.answers).slice(0, 8).map(([k, v]) => (
                                      <div key={k} className="flex justify-between gap-2 border-b border-dashed border-border pb-1">
                                        <dt className="text-muted-foreground truncate">{k}</dt>
                                        <dd className="font-medium text-right truncate max-w-[60%]">{String(v ?? "—")}</dd>
                                      </div>
                                    ))}
                                    {Object.keys(content.answers).length > 8 && (
                                      <div className="text-[10px] text-muted-foreground mt-1">+ {Object.keys(content.answers).length - 8} outros campos</div>
                                    )}
                                  </dl>
                                ) : (
                                  <p className="text-[12px] text-muted-foreground italic">Sem respostas registradas.</p>
                                )}
                                {content.photos?.length > 0 && (
                                  <div className="mt-2 text-[11px] text-primary">📸 {content.photos.length} foto(s)</div>
                                )}
                              </div>
                            ))}
                          </div>
                        </Section>
                      )}

                      {/* Fotos antes/depois */}
                      {(s.medical_record?.photos_before?.length > 0 || s.medical_record?.photos_after?.length > 0) && (
                        <Section title="Fotos antes / depois">
                          <div className="grid grid-cols-2 gap-3">
                            <PhotoGroup label="Antes" urls={s.medical_record?.photos_before || []} />
                            <PhotoGroup label="Depois" urls={s.medical_record?.photos_after || []} />
                          </div>
                        </Section>
                      )}

                      {/* Assinaturas com metadata forense */}
                      {(s.signatures?.consent || s.signatures?.evolution) && (
                        <Section title="Assinaturas registradas">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[12px]">
                            {s.signatures.consent && s.signatures.consent_meta && (
                              <SignatureCard label="TCLE (Paciente)" meta={s.signatures.consent_meta} />
                            )}
                            {s.signatures.evolution && s.signatures.evolution_meta && (
                              <SignatureCard label="Evolução (Profissional)" meta={s.signatures.evolution_meta} />
                            )}
                          </div>
                        </Section>
                      )}

                      {/* Orçamento + Financeiro + Recibos */}
                      {(s.budget || s.financial_entries?.length > 0) && (
                        <Section title="Financeiro da sessão">
                          {s.budget && (
                            <div className="rounded-xl border border-border p-3 bg-muted/10 mb-3 text-[12px]">
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">Orçamento</span>
                                <span className="font-mono font-semibold">{brl(s.budget.total)}</span>
                              </div>
                              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mt-1">Status: {s.budget.status}</div>
                            </div>
                          )}
                          {s.financial_entries?.length > 0 && (
                            <table className="w-full text-[12px]">
                              <thead className="text-[10px] uppercase tracking-wider text-muted-foreground text-left">
                                <tr><th className="pb-1">Parcela</th><th className="pb-1">Vencimento</th><th className="pb-1 text-right">Valor</th><th className="pb-1">Status</th><th className="pb-1">Recibo</th></tr>
                              </thead>
                              <tbody className="divide-y divide-border">
                                {s.financial_entries.map((e) => (
                                  <tr key={e.entry_id}>
                                    <td className="py-1.5">{e.installment_total > 1 ? `${e.installment_number}/${e.installment_total}` : "Único"}</td>
                                    <td className="py-1.5 text-muted-foreground">{e.due_date || "—"}</td>
                                    <td className="py-1.5 text-right font-mono">{brl(e.amount)}</td>
                                    <td className="py-1.5">
                                      {e.paid
                                        ? <Badge className="bg-success/15 text-success border-success/30 text-[9px]">Pago</Badge>
                                        : <Badge variant="outline" className="text-[9px]">Pendente</Badge>}
                                    </td>
                                    <td className="py-1.5">
                                      {e.receipt_url ? (
                                        <a href={`${process.env.REACT_APP_BACKEND_URL}${e.receipt_url}`} target="_blank" rel="noreferrer" className="text-primary hover:underline font-mono text-[10px]">
                                          {e.receipt_number}
                                        </a>
                                      ) : "—"}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </Section>
                      )}

                      {/* Documentos assinados vinculados */}
                      {s.signed_documents?.length > 0 && (
                        <Section title="Documentos assinados">
                          <ul className="space-y-1 text-[12px]">
                            {s.signed_documents.map((d) => (
                              <li key={d.document_id} className="flex justify-between items-center border-b border-dashed border-border py-1">
                                <span>{d.template_name}</span>
                                <div className="flex items-center gap-2">
                                  <Badge variant="outline" className="text-[9px]">{d.status}</Badge>
                                  {d.pdf_url && (
                                    <a href={`${process.env.REACT_APP_BACKEND_URL}${d.pdf_url}`} target="_blank" rel="noreferrer" className="text-primary hover:underline text-[10px]">Abrir PDF</a>
                                  )}
                                </div>
                              </li>
                            ))}
                          </ul>
                        </Section>
                      )}
                    </div>
                  )}
                </div>
              </li>
            );
          })}

          {filtered.length > visibleCount && (
            <li className="pl-1 pt-1" data-testid="timeline-load-more-wrap">
              <Button variant="outline" size="sm" className="rounded-lg text-xs" onClick={() => setVisibleCount((c) => c + PAGE)} data-testid="timeline-load-more">
                Carregar mais ({filtered.length - visibleCount} restantes)
              </Button>
            </li>
          )}

          {/* Legacy records */}
          {legacy_records.length > 0 && (
            <li className="pt-4">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Registros legado (sem vínculo de sessão)</div>
              <ul className="space-y-2">
                {legacy_records.map((r) => (
                  <li key={r.record_id} className="rounded-xl border border-dashed border-border p-3 text-[12px]">
                    <div className="flex justify-between mb-1">
                      <span className="font-medium">{r.procedure || "Prontuário manual"}</span>
                      <span className="text-muted-foreground">{fmtDate(r.created_at)}</span>
                    </div>
                    {r.evolution && <p className="text-[12px] whitespace-pre-wrap line-clamp-3">{r.evolution}</p>}
                  </li>
                ))}
              </ul>
            </li>
          )}
        </ol>
      )}
    </div>
  );
}

const StatCard = ({ label, value, icon: Icon, tone }) => {
  const tones = {
    primary: "text-primary bg-primary/10 ring-primary/30",
    success: "text-success bg-success/10 ring-success/30",
    warning: "text-yellow-600 bg-yellow-500/10 ring-yellow-500/30",
    muted: "text-muted-foreground bg-muted ring-border",
  };
  return (
    <div className="rounded-2xl border border-border bg-card p-4" data-testid={`stat-${label.toLowerCase().replace(/\s+/g,'-')}`}>
      <div className={`h-8 w-8 rounded-lg ring-1 flex items-center justify-center ${tones[tone]}`}>
        <Icon className="h-4 w-4" strokeWidth={1.5} />
      </div>
      <div className="mt-3 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{label}</div>
      <div className="font-display text-2xl font-semibold tracking-tight mt-0.5">{value ?? 0}</div>
    </div>
  );
};

const ChipIcon = ({ Icon, label }) => (
  <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
    <Icon className="h-3 w-3" strokeWidth={1.5} />
    {label}
  </span>
);

const Section = ({ title, children }) => (
  <div>
    <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2 font-semibold">{title}</div>
    {children}
  </div>
);

const Field = ({ label, children }) => (
  <div className="mb-2">
    <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">{label}</div>
    {children}
  </div>
);

const PhotoGroup = ({ label, urls }) => (
  <div>
    <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">{label} ({urls.length})</div>
    <div className="grid grid-cols-3 gap-1.5">
      {urls.slice(0, 6).map((u, i) => (
        <a key={i} href={`${process.env.REACT_APP_BACKEND_URL}${u}`} target="_blank" rel="noreferrer" className="block aspect-square rounded overflow-hidden bg-muted">
          <img src={`${process.env.REACT_APP_BACKEND_URL}${u}`} alt="" className="w-full h-full object-cover hover:scale-105 transition" loading="lazy" />
        </a>
      ))}
    </div>
  </div>
);

const SignatureCard = ({ label, meta }) => (
  <div className="rounded-xl border border-border p-3 bg-muted/10">
    <div className="flex items-center gap-1 mb-1.5">
      <ShieldCheck className="h-3 w-3 text-success" strokeWidth={1.5} />
      <span className="font-semibold">{label}</span>
    </div>
    <dl className="space-y-0.5 text-[11px]">
      <div><dt className="inline text-muted-foreground">Assinado em: </dt><dd className="inline">{fmtDate(meta.signed_at)}</dd></div>
      <div><dt className="inline text-muted-foreground">Por: </dt><dd className="inline">{meta.signed_by_name}</dd></div>
      <div><dt className="inline text-muted-foreground">Timezone: </dt><dd className="inline font-mono">{meta.timezone}</dd></div>
      {meta.ip && <div><dt className="inline text-muted-foreground">IP: </dt><dd className="inline font-mono">{meta.ip}</dd></div>}
      <div className="pt-1 border-t border-dashed border-border mt-1">
        <dt className="text-muted-foreground text-[9px] uppercase tracking-wider">Hash SHA-256</dt>
        <dd className="font-mono text-[9px] break-all">{meta.sha256}</dd>
      </div>
    </dl>
  </div>
);
