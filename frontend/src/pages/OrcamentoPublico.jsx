import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import axios from "axios";
import { Button } from "@/components/ui/button";
import { Sparkles, Loader2, CheckCircle2, XCircle, Clock } from "lucide-react";
import { toast } from "sonner";
import SignaturePad from "@/components/SignaturePad";

const moneyBR = (n) => (Number(n) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const STATUS_LABEL = {
  rascunho: "Rascunho",
  enviado: "Aguardando aprovação",
  aprovado: "Aprovado",
  recusado: "Recusado",
  expirado: "Expirado",
};

export default function OrcamentoPublico() {
  const { token } = useParams();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [signature, setSignature] = useState(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null); // 'aprovar' | 'recusar'

  const api = axios.create({ baseURL: process.env.REACT_APP_BACKEND_URL });

  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get(`/api/public/budgets/${token}`);
        setData(data);
      } catch (e) {
        setError(e.response?.data?.detail || "Orçamento indisponível");
      } finally { setLoading(false); }
    })();
    // eslint-disable-next-line
  }, [token]);

  const respond = async (action) => {
    if (action === "aprovar" && !signature) {
      toast.error("Assine para aprovar o orçamento");
      return;
    }
    setBusy(true);
    try {
      await api.post(`/api/public/budgets/${token}/sign`, {
        action,
        signature: action === "aprovar" ? signature : null,
      });
      setDone(action);
      toast.success(action === "aprovar" ? "Orçamento aprovado" : "Orçamento recusado");
    } catch (e) {
      toast.error(e.response?.data?.detail || "Erro ao registrar resposta");
    } finally { setBusy(false); }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background p-8 text-center">
        <XCircle className="h-12 w-12 text-destructive mb-3" strokeWidth={1.5} />
        <h1 className="font-display text-2xl tracking-tight">Não foi possível carregar</h1>
        <p className="text-sm text-muted-foreground mt-1">{error || "Verifique se o link está completo e tente novamente."}</p>
      </div>
    );
  }

  const { budget, clinic } = data;
  const finalDone = done || (budget.status === "aprovado" ? "aprovar" : budget.status === "recusado" ? "recusar" : null);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b border-border bg-card/40">
        <div className="max-w-3xl mx-auto px-6 py-5 flex items-center gap-3">
          {clinic?.logo_url ? (
            <img src={clinic.logo_url} alt="" className="h-10 w-10 rounded-xl object-cover" />
          ) : (
            <div className="h-10 w-10 rounded-xl bg-primary/15 ring-1 ring-primary/30 flex items-center justify-center">
              <Sparkles className="h-5 w-5 text-primary" strokeWidth={1.5} />
            </div>
          )}
          <div>
            <div className="font-display text-lg font-semibold tracking-tight">{clinic?.name || "ProClinic"}</div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Orçamento de procedimentos</div>
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-6 py-8 space-y-6" data-testid="orcamento-publico">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Para</div>
            <h1 className="font-display text-2xl font-semibold tracking-tight">{budget.patient_name}</h1>
          </div>
          <span className="text-[11px] uppercase tracking-wider px-3 py-1 rounded-full border border-border bg-card text-muted-foreground" data-testid="budget-status-public">
            {STATUS_LABEL[budget.status] || budget.status}
          </span>
        </div>

        {/* Items */}
        <div className="rounded-2xl border border-border bg-card overflow-hidden">
          <div className="grid grid-cols-[1fr_60px_120px_120px] gap-2 px-4 py-2 bg-muted/30 text-[10px] uppercase tracking-wider text-muted-foreground">
            <div>Item</div>
            <div className="text-right">Qtd</div>
            <div className="text-right">Unit.</div>
            <div className="text-right">Total</div>
          </div>
          <div className="divide-y divide-border">
            {budget.items.map((it, idx) => {
              const gross = (it.quantity || 0) * (it.unit_price || 0);
              const disc = Math.min(gross, (gross * (it.discount_percent || 0)) / 100 + (it.discount_value || 0));
              const lineTotal = Math.max(0, gross - disc);
              return (
                <div key={idx} className="grid grid-cols-[1fr_60px_120px_120px] gap-2 px-4 py-3 items-center text-sm">
                  <div className="font-medium">{it.name}</div>
                  <div className="text-right">{it.quantity}</div>
                  <div className="text-right font-mono text-muted-foreground">{moneyBR(it.unit_price)}</div>
                  <div className="text-right font-mono">{moneyBR(lineTotal)}</div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Totals */}
        <div className="rounded-2xl border border-border bg-muted/20 p-5 space-y-1 text-sm">
          <div className="flex justify-between text-muted-foreground">
            <span>Subtotal</span><span className="font-mono">{moneyBR(budget.subtotal)}</span>
          </div>
          <div className="flex justify-between text-muted-foreground">
            <span>Descontos</span><span className="font-mono">- {moneyBR(budget.discount)}</span>
          </div>
          <div className="flex justify-between font-display text-2xl font-semibold pt-2 border-t border-border mt-2">
            <span>Total</span><span className="font-mono">{moneyBR(budget.total)}</span>
          </div>
          <div className="text-[11px] text-muted-foreground mt-2">
            {budget.payment_method && `Pagamento: ${budget.payment_method}`}
            {budget.installments > 1 && ` · ${budget.installments}x`}
            {budget.valid_until && ` · Válido até ${new Date(budget.valid_until).toLocaleDateString("pt-BR")}`}
          </div>
        </div>

        {budget.notes && (
          <div className="rounded-2xl border border-border bg-card p-5 text-sm leading-relaxed">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Observações</div>
            {budget.notes}
          </div>
        )}

        {/* Action area */}
        {finalDone === "aprovar" ? (
          <div className="rounded-2xl border border-success/30 bg-success/10 p-6 text-center" data-testid="budget-approved">
            <CheckCircle2 className="h-10 w-10 text-success mx-auto mb-2" strokeWidth={1.5} />
            <div className="font-display text-lg">Orçamento aprovado</div>
            <p className="text-xs text-muted-foreground mt-1">A clínica entrará em contato para confirmar os próximos passos.</p>
          </div>
        ) : finalDone === "recusar" ? (
          <div className="rounded-2xl border border-destructive/30 bg-destructive/10 p-6 text-center" data-testid="budget-rejected">
            <XCircle className="h-10 w-10 text-destructive mx-auto mb-2" strokeWidth={1.5} />
            <div className="font-display text-lg">Orçamento recusado</div>
            <p className="text-xs text-muted-foreground mt-1">Sua resposta foi registrada.</p>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Assine para aprovar</div>
              <SignaturePad testid="public-signature" value={signature} onChange={setSignature} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Button variant="outline" onClick={() => respond("recusar")} disabled={busy}
                className="rounded-xl h-12" data-testid="budget-reject-btn">
                <XCircle className="h-4 w-4 mr-1.5" /> Recusar
              </Button>
              <Button onClick={() => respond("aprovar")} disabled={busy}
                className="rounded-xl h-12 bg-primary text-primary-foreground hover:bg-primary/90" data-testid="budget-approve-btn">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <><CheckCircle2 className="h-4 w-4 mr-1.5" /> Aprovar</>}
              </Button>
            </div>
          </div>
        )}

        <div className="text-center text-[11px] text-muted-foreground/70 mt-8">
          <Clock className="h-3 w-3 inline mr-1" />
          Link público gerado por <span className="font-medium">{clinic?.name || "ProClinic"}</span>.
        </div>
      </div>
    </div>
  );
}
