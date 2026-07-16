import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "@/lib/api";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sparkles, Loader2, XCircle, ArrowUpRight, Wallet } from "lucide-react";
import { toast } from "sonner";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";

const moneyBR = (n) => (Number(n) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const STATUS_MAP = {
  trial:     { label: "Trial",       cls: "bg-amber-500/15 text-amber-600" },
  active:    { label: "Ativa",       cls: "bg-success/15 text-success" },
  pending:   { label: "Aguardando",  cls: "bg-primary/10 text-primary" },
  past_due:  { label: "Em atraso",   cls: "bg-destructive/15 text-destructive" },
  read_only: { label: "Somente leitura", cls: "bg-amber-500/15 text-amber-600" },
  expired:   { label: "Expirada",    cls: "bg-destructive/15 text-destructive" },
  cancelled: { label: "Cancelada",   cls: "bg-muted text-muted-foreground" },
};

export default function MinhaAssinatura() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [sub, setSub] = useState(null);
  const [payments, setPayments] = useState([]);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [s, p] = await Promise.all([
        api.get("/subscriptions/me"),
        api.get("/subscriptions/payments").catch(() => ({ data: [] })),
      ]);
      setSub(s.data);
      setPayments(p.data);
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const cancel = async () => {
    if (!window.confirm("Tem certeza que deseja cancelar sua assinatura? Você continuará com acesso até o final do período pago.")) return;
    setBusy(true);
    try {
      await api.post("/subscriptions/cancel");
      toast.success("Assinatura cancelada");
      load();
    } catch (e) {
      toast.error(e.response?.data?.detail?.message || "Erro ao cancelar");
    } finally { setBusy(false); }
  };

  if (loading) return <div className="p-12 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;

  const effective = sub?.effective_status || sub?.status || "expired";
  const statusInfo = STATUS_MAP[effective] || STATUS_MAP.expired;

  return (
    <div data-testid="minha-assinatura-page">
      <PageHeader
        title="Minha Assinatura"
        subtitle="Gerencie seu plano e forma de pagamento"
        actions={
          <Button onClick={() => navigate("/planos")} variant="outline" className="rounded-xl" data-testid="change-plan-btn">
            <ArrowUpRight className="h-3.5 w-3.5 mr-1.5" /> Trocar de plano
          </Button>
        }
      />

      <div className="p-6 sm:p-8 max-w-4xl mx-auto animate-fade-up space-y-6">
        {sub ? (
          <>
            <div className="rounded-2xl border border-border bg-card p-6 space-y-4" data-testid="subscription-card">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="h-12 w-12 rounded-xl bg-primary/10 ring-1 ring-primary/30 flex items-center justify-center">
                    <Sparkles className="h-6 w-6 text-primary" strokeWidth={1.5} />
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Plano atual</div>
                    <div className="font-display text-2xl font-semibold tracking-tight">{sub.plan?.name || sub.plan_key}</div>
                  </div>
                </div>
                <Badge className={`${statusInfo.cls} border-0 text-[10px]`} data-testid="sub-status">
                  {statusInfo.label}
                </Badge>
              </div>

              <div className="grid grid-cols-2 gap-4 text-sm border-t border-border pt-4">
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Valor</div>
                  <div className="font-mono">{moneyBR(sub.value || 0)}{sub.billing_cycle === "yearly" ? "/ano" : "/mês"}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Ciclo</div>
                  <div>{sub.billing_cycle === "yearly" ? "Anual" : "Mensal"}</div>
                </div>
                {sub.next_billing_date && (
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Próxima cobrança</div>
                    <div>{format(parseISO(sub.next_billing_date), "dd/MM/yyyy", { locale: ptBR })}</div>
                  </div>
                )}
                {sub.trial_ends_at && sub.status === "trial" && (
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Trial expira em</div>
                    <div>{format(parseISO(sub.trial_ends_at), "dd/MM/yyyy", { locale: ptBR })} · <span className="text-amber-600">{sub.trial_days_left} dias</span></div>
                  </div>
                )}
              </div>

              {/* Features */}
              {sub.features && (
                <div className="border-t border-border pt-4">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Recursos inclusos</div>
                  <div className="flex flex-wrap gap-1.5 text-xs">
                    <Badge variant="outline">Profissionais: {sub.features.max_professionals ?? "ilimitados"}</Badge>
                    <Badge variant="outline">Pacientes: {sub.features.max_patients ?? "ilimitados"}</Badge>
                    {sub.features.ai && <Badge variant="outline">IA clínica</Badge>}
                    {sub.features.documents && <Badge variant="outline">Documentos jurídicos</Badge>}
                    {sub.features.whatsapp && <Badge variant="outline">WhatsApp</Badge>}
                    {sub.features.advanced_reports && <Badge variant="outline">Relatórios avançados</Badge>}
                  </div>
                </div>
              )}

              {sub.gateway_subscription_id && sub.status !== "cancelled" && (
                <div className="pt-4 border-t border-border flex justify-end">
                  <Button onClick={cancel} disabled={busy} variant="ghost" size="sm" className="text-destructive hover:text-destructive" data-testid="cancel-subscription-btn">
                    <XCircle className="h-4 w-4 mr-1" /> Cancelar assinatura
                  </Button>
                </div>
              )}
            </div>

            {/* Payments history */}
            <div className="rounded-2xl border border-border bg-card overflow-hidden" data-testid="payments-history">
              <div className="px-5 py-3 border-b border-border bg-muted/30 text-[10px] uppercase tracking-[0.18em] text-muted-foreground flex items-center gap-2">
                <Wallet className="h-3.5 w-3.5" /> Histórico de pagamentos
              </div>
              {payments.length === 0 ? (
                <div className="p-6 text-center text-sm text-muted-foreground">Nenhum pagamento processado ainda.</div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-muted/20">
                    <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                      <th className="px-4 py-2">Data</th>
                      <th className="px-4 py-2">Método</th>
                      <th className="px-4 py-2">Valor</th>
                      <th className="px-4 py-2">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {payments.map((p) => (
                      <tr key={p.payment_id} data-testid={`payment-row-${p.payment_id}`}>
                        <td className="px-4 py-3 text-xs text-muted-foreground">
                          {p.paid_at ? format(parseISO(p.paid_at), "dd/MM/yyyy", { locale: ptBR }) : "—"}
                        </td>
                        <td className="px-4 py-3">{p.payment_method}</td>
                        <td className="px-4 py-3 font-mono">{moneyBR(p.amount)}</td>
                        <td className="px-4 py-3">
                          <Badge variant="outline" className="text-[10px] uppercase">{p.status}</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </>
        ) : (
          <div className="rounded-2xl border border-dashed border-border p-10 text-center">
            <p className="text-sm text-muted-foreground">Você ainda não possui uma assinatura.</p>
            <Button onClick={() => navigate("/planos")} className="mt-4 rounded-xl bg-primary text-primary-foreground" data-testid="start-subscription">
              Ver planos
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
