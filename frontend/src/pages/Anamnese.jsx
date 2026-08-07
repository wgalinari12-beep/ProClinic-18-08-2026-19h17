import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "@/lib/api";
import PageHeader from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Info, FileSignature, ArrowRight, Search } from "lucide-react";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";

// ⭐ Lote 4 / Fase C (C1): módulo global de Anamnese agora é SOMENTE LEITURA.
// As anamneses modulares são preenchidas na ficha do paciente (aba Anamnese) e
// consolidadas no histórico. Cada registro leva direto à tela do paciente.
export default function Anamnese() {
  const [items, setItems] = useState([]);
  const [q, setQ] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get("/anamnesis");
        setItems(data);
      } catch { /* ignore */ }
    })();
  }, []);

  const ql = q.trim().toLowerCase();
  const visible = items.filter((a) => {
    if (!ql) return true;
    return [a.patient_name, a.template_name].filter(Boolean).join(" ").toLowerCase().includes(ql);
  });

  return (
    <div data-testid="anamnese-page">
      <PageHeader
        title="Anamnese"
        subtitle={`${items.length} formulários · somente leitura`}
      />

      <div className="p-6 sm:p-8 space-y-4 animate-fade-up">
        <div className="flex items-start gap-3 rounded-2xl border border-border bg-muted/30 p-4 text-sm" data-testid="anamnese-readonly-banner">
          <Info className="h-4 w-4 text-primary mt-0.5 shrink-0" strokeWidth={1.5} />
          <div className="text-muted-foreground">
            Este módulo é <strong className="text-foreground">somente leitura</strong>. As anamneses são preenchidas na
            <strong className="text-foreground"> ficha do paciente</strong> (aba Anamnese) e consolidadas no histórico.
            Clique em um registro para abrir o paciente.
          </div>
        </div>

        <div className="relative max-w-md">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" strokeWidth={1.5} />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por paciente..." className="pl-10 h-11 rounded-xl bg-card" data-testid="anamnese-search" />
        </div>

        {items.length === 0 && (
          <div className="text-center py-16 text-muted-foreground border border-dashed border-border rounded-2xl" data-testid="empty-anamnese">
            Nenhuma anamnese registrada.
          </div>
        )}

        {visible.map((a) => (
          <button
            key={a.anamnesis_id}
            data-testid={`anamnese-${a.anamnesis_id}`}
            onClick={() => a.patient_id && navigate(`/pacientes/${a.patient_id}`)}
            className="w-full text-left rounded-2xl border border-border bg-card p-6 hover:border-primary/40 transition-all hover:-translate-y-0.5"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                  {format(parseISO(a.created_at), "dd 'de' MMM, yyyy", { locale: ptBR })}
                </div>
                <h3 className="font-display text-lg font-semibold tracking-tight mt-1">{a.patient_name}</h3>
                <div className="text-sm text-muted-foreground">{a.template_name}</div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {a.signed && (
                  <Badge className="bg-success/15 text-success border-success/30">
                    <FileSignature className="h-3 w-3 mr-1" /> Assinada
                  </Badge>
                )}
                <ArrowRight className="h-4 w-4 text-muted-foreground" />
              </div>
            </div>
            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
              {Object.entries(a.answers || {}).slice(0, 4).map(([k, v]) => (
                <div key={k} className="flex flex-col">
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{k.replace(/_/g, " ")}</span>
                  <span className="truncate">{String(v) || "—"}</span>
                </div>
              ))}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
