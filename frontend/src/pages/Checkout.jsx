import React, { useEffect, useState } from "react";
import { useParams, useSearchParams, useNavigate } from "react-router-dom";
import api from "@/lib/api";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Loader2, CreditCard, Landmark, QrCode, ChevronLeft, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

const moneyBR = (n) => (Number(n) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export default function Checkout() {
  const { planKey } = useParams();
  const [params] = useSearchParams();
  const cycle = params.get("cycle") || "monthly";
  const navigate = useNavigate();

  const [plan, setPlan] = useState(null);
  const [method, setMethod] = useState("PIX");
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [couponCode, setCouponCode] = useState("");
  const [couponInfo, setCouponInfo] = useState(null);

  const [form, setForm] = useState({
    cpf_cnpj: "", holder_name: "", email: "", phone: "",
    card_number: "", card_holder: "", card_expiry_month: "", card_expiry_year: "", card_ccv: "",
  });

  useEffect(() => {
    (async () => {
      const { data } = await api.get("/plans");
      const p = data.find((x) => x.plan_key === planKey);
      setPlan(p || null);
    })();
  }, [planKey]);

  const price = cycle === "yearly" ? plan?.annual_price : plan?.price;
  const discount = couponInfo ? (couponInfo.kind === "percent"
    ? (price * couponInfo.value) / 100
    : couponInfo.value) : 0;
  const finalPrice = Math.max(0, price - discount);

  const applyCoupon = async () => {
    if (!couponCode) return;
    try {
      const { data } = await api.get(`/coupons/validate/${couponCode.trim().toUpperCase()}`, { params: { plan_key: planKey } });
      setCouponInfo(data);
      toast.success(`Cupom ${data.code} aplicado`);
    } catch (e) {
      setCouponInfo(null);
      toast.error(e.response?.data?.detail || "Cupom inválido");
    }
  };

  const submit = async () => {
    if (!form.cpf_cnpj || !form.holder_name || !form.email) {
      toast.error("Preencha CPF/CNPJ, nome e email");
      return;
    }
    setBusy(true);
    try {
      const payload = {
        plan_key: planKey,
        billing_cycle: cycle,
        billing_type: method,
        coupon_code: couponInfo?.code || null,
        cpf_cnpj: form.cpf_cnpj,
        holder_name: form.holder_name,
        email: form.email,
        phone: form.phone,
      };
      if (method === "CREDIT_CARD") {
        Object.assign(payload, {
          card_number: form.card_number,
          card_holder: form.card_holder,
          card_expiry_month: form.card_expiry_month,
          card_expiry_year: form.card_expiry_year,
          card_ccv: form.card_ccv,
        });
      }
      const { data } = await api.post("/subscriptions/checkout", payload);
      setConfirmed(true);
      toast.success("Assinatura criada. Aguardando confirmação do pagamento.");
    } catch (e) {
      toast.error(e.response?.data?.detail?.message || e.response?.data?.detail || "Erro ao processar");
    } finally { setBusy(false); }
  };

  if (!plan) {
    return <div className="p-12 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  }

  return (
    <div data-testid="checkout-page">
      <PageHeader
        title="Checkout"
        subtitle={`${plan.name} · ${cycle === "yearly" ? "Anual" : "Mensal"}`}
        actions={
          <Button variant="ghost" size="sm" onClick={() => navigate("/planos")} data-testid="back-to-plans">
            <ChevronLeft className="h-4 w-4 mr-1" /> Voltar
          </Button>
        }
      />

      <div className="p-6 sm:p-8 max-w-5xl mx-auto animate-fade-up">
        {confirmed ? (
          <div className="rounded-2xl border border-success/30 bg-success/10 p-10 text-center" data-testid="checkout-confirmed">
            <ShieldCheck className="h-12 w-12 text-success mx-auto mb-3" strokeWidth={1.5} />
            <div className="font-display text-2xl">Pedido enviado</div>
            <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
              Assinatura criada com sucesso. Assim que o pagamento for confirmado pelo Asaas, seu acesso será liberado automaticamente.
            </p>
            <Button onClick={() => navigate("/minha-assinatura")} className="mt-6 rounded-xl bg-primary text-primary-foreground" data-testid="go-to-subscription">
              Ver minha assinatura
            </Button>
          </div>
        ) : (
          <div className="grid md:grid-cols-[1fr_320px] gap-6">
            {/* Form */}
            <div className="space-y-5">
              <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
                <div>
                  <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-3">Forma de pagamento</div>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { v: "PIX",         label: "PIX",     Icon: QrCode },
                      { v: "CREDIT_CARD", label: "Cartão",  Icon: CreditCard },
                      { v: "BOLETO",      label: "Boleto",  Icon: Landmark },
                    ].map((opt) => (
                      <button key={opt.v} type="button" onClick={() => setMethod(opt.v)}
                        data-testid={`pay-${opt.v}`}
                        className={`h-16 rounded-xl border flex flex-col items-center justify-center gap-1 transition-colors ${
                          method === opt.v ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:text-foreground"
                        }`}>
                        <opt.Icon className="h-4 w-4" strokeWidth={1.5} />
                        <span className="text-xs">{opt.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <Field label="Nome (titular)" testid="checkout-name" value={form.holder_name} onChange={(v) => setForm({ ...form, holder_name: v })} />
                  <Field label="CPF ou CNPJ" testid="checkout-cpf" value={form.cpf_cnpj} onChange={(v) => setForm({ ...form, cpf_cnpj: v })} />
                  <Field label="Email" testid="checkout-email" value={form.email} onChange={(v) => setForm({ ...form, email: v })} />
                  <Field label="Telefone" testid="checkout-phone" value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} />
                </div>

                {method === "CREDIT_CARD" && (
                  <div className="space-y-3 pt-2 border-t border-border">
                    <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Dados do cartão</div>
                    <Field label="Nome no cartão" testid="cc-holder" value={form.card_holder} onChange={(v) => setForm({ ...form, card_holder: v })} />
                    <Field label="Número do cartão" testid="cc-number" value={form.card_number} onChange={(v) => setForm({ ...form, card_number: v })} />
                    <div className="grid grid-cols-3 gap-3">
                      <Field label="Mês" testid="cc-month" value={form.card_expiry_month} onChange={(v) => setForm({ ...form, card_expiry_month: v })} />
                      <Field label="Ano" testid="cc-year" value={form.card_expiry_year} onChange={(v) => setForm({ ...form, card_expiry_year: v })} />
                      <Field label="CVV" testid="cc-cvv" value={form.card_ccv} onChange={(v) => setForm({ ...form, card_ccv: v })} />
                    </div>
                  </div>
                )}
              </div>

              <Button onClick={submit} disabled={busy}
                data-testid="checkout-submit"
                className="w-full h-12 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90">
                {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : `Confirmar assinatura · ${moneyBR(finalPrice)}${cycle === "yearly" ? "/ano" : "/mês"}`}
              </Button>

              <div className="text-[11px] text-muted-foreground/70 flex items-center gap-1 justify-center">
                <ShieldCheck className="h-3 w-3" /> Pagamento processado com segurança pela Asaas
              </div>
            </div>

            {/* Summary */}
            <div className="rounded-2xl border border-border bg-card p-5 space-y-3 h-fit sticky top-24">
              <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Resumo</div>
              <div className="font-display text-xl font-semibold tracking-tight">{plan.name}</div>
              <p className="text-xs text-muted-foreground">{plan.description}</p>
              <div className="border-t border-border pt-3 space-y-1 text-sm">
                <div className="flex justify-between text-muted-foreground">
                  <span>{cycle === "yearly" ? "Assinatura anual" : "Assinatura mensal"}</span>
                  <span className="font-mono">{moneyBR(price)}</span>
                </div>
                {cycle === "yearly" && (
                  <div className="flex justify-between text-success text-xs">
                    <span>Economia anual</span>
                    <span className="font-mono">- {moneyBR(plan.price * 12 - plan.annual_price)}</span>
                  </div>
                )}
                {couponInfo && (
                  <div className="flex justify-between text-success text-xs">
                    <span>Cupom {couponInfo.code}{couponInfo.first_payment_only ? " (1º pagto)" : ""}</span>
                    <span className="font-mono">- {moneyBR(discount)}</span>
                  </div>
                )}
              </div>
              <div className="flex justify-between font-display text-lg font-semibold pt-2 border-t border-border">
                <span>Total</span>
                <span className="font-mono" data-testid="checkout-total">{moneyBR(finalPrice)}</span>
              </div>
              {/* Coupon input */}
              <div className="pt-3 border-t border-border space-y-1.5">
                <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Cupom de desconto</Label>
                <div className="flex gap-2">
                  <Input value={couponCode} onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
                    placeholder="Ex.: LAUNCH20" className="h-10 rounded-xl flex-1" data-testid="coupon-input" />
                  <Button type="button" variant="outline" onClick={applyCoupon} className="h-10 rounded-xl" data-testid="coupon-apply">
                    Aplicar
                  </Button>
                </div>
              </div>
              <Badge variant="outline" className="text-[10px] uppercase mt-1">Trial ainda ativo por 7 dias</Badge>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, value, onChange, testid }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</Label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} className="h-11 rounded-xl" data-testid={testid} />
    </div>
  );
}
