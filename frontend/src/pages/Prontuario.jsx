import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "@/lib/api";
import PageHeader from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Info, Image as ImageIcon, ArrowRight, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";

// ⭐ Lote 4 / Fase C (C1): módulo global de Prontuário agora é SOMENTE LEITURA.
// A criação de evoluções acontece no fluxo de atendimento e é consolidada no
// Histórico Clínico de cada paciente. Cada registro leva direto à tela do paciente.
export default function Prontuario() {
  const [records, setRecords] = useState([]);
  const [q, setQ] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get("/medical-records");
        setRecords(data);
      } catch { /* ignore */ }
    })();
  }, []);

  const ql = q.trim().toLowerCase();
  const visible = records.filter((r) => {
    if (!ql) return true;
    return [r.patient_name, r.procedure, r.professional_name, r.evolution]
      .filter(Boolean).join(" ").toLowerCase().includes(ql);
  });

  return (
    <div data-testid="prontuario-page">
      <PageHeader
        title="Prontuário Digital"
        subtitle={`${records.length} evoluções clínicas · somente leitura`}
      />

      <div className="p-6 sm:p-8 space-y-5 animate-fade-up">
        <div className="flex items-start gap-3 rounded-2xl border border-border bg-muted/30 p-4 text-sm" data-testid="prontuario-readonly-banner">
          <Info className="h-4 w-4 text-primary mt-0.5 shrink-0" strokeWidth={1.5} />
          <div className="text-muted-foreground">
            Este módulo é <strong className="text-foreground">somente leitura</strong>. As evoluções clínicas são
            registradas durante o atendimento e consolidadas no <strong className="text-foreground">Histórico</strong> de cada paciente.
            Clique em um registro para abrir o histórico completo do paciente.
          </div>
        </div>

        <div className="relative max-w-md">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" strokeWidth={1.5} />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por paciente, procedimento..." className="pl-10 h-11 rounded-xl bg-card" data-testid="prontuario-search" />
        </div>

        {records.length === 0 && (
          <div className="text-center py-16 text-muted-foreground border border-dashed border-border rounded-2xl" data-testid="empty-records">
            Nenhuma evolução registrada ainda.
          </div>
        )}

        {visible.map((r) => (
          <button
            key={r.record_id}
            data-testid={`record-${r.record_id}`}
            onClick={() => r.patient_id && navigate(`/pacientes/${r.patient_id}`)}
            className="w-full text-left rounded-2xl border border-border bg-card p-6 hover:border-primary/40 transition-all hover:-translate-y-0.5"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{format(parseISO(r.created_at), "dd 'de' MMMM, yyyy", { locale: ptBR })}</div>
                <h3 className="font-display text-xl font-semibold tracking-tight mt-1">{r.procedure}</h3>
                <div className="text-sm text-muted-foreground mt-0.5">{r.patient_name} · {r.professional_name}</div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {r.signed && <Badge className="bg-success/15 text-success border-success/30">Assinado · ICP</Badge>}
                <ArrowRight className="h-4 w-4 text-muted-foreground" />
              </div>
            </div>
            <p className="mt-4 text-sm leading-relaxed line-clamp-3">{r.evolution}</p>
            {(r.photos_before?.length || r.photos_after?.length) ? (
              <div className="mt-3 flex items-center gap-1 text-xs text-primary">
                <ImageIcon className="h-3.5 w-3.5" />
                {(r.photos_before?.length || 0) + (r.photos_after?.length || 0)} fotos
              </div>
            ) : null}
          </button>
        ))}
      </div>
    </div>
  );
}
