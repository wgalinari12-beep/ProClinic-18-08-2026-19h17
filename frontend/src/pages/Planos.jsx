import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "@/lib/api";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Check, Sparkles, Loader2, ArrowRight } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
const moneyBR = (n) => (Number(n) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const FEATURE_LIST = {
  starter: [
    "1 profissional",
    "Até 200 pacientes",
    "Agenda + prontuário",
    "Financeiro básico",
  ],
  professional: [
    "Até 5 profissionais",
    "Pacientes ilimitados",
    "Documentos jurídicos",
    "IA clínica (Claude)",
    "Orçamentos + assinaturas digitais",
    "Suporte prioritário",
  ],
  premium: [
    "Profissionais ilimitados",
    "Tudo do Professional",
    "WhatsApp lembretes (Evolution API)",
    "Relatórios avançados",
    "Logs de auditoria completos",
    "Onboarding dedicado",
  ],
};

const PLAN_ORDER = ["starter", "professional", "premium"];
const HIGHLIGHT_PLAN = "professional";

export default function Planos() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [plans, setPlans] = useState([]);
  const [cycle, setCycle] = useState("monthly");
  const [mySub, setMySub] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [p, s] = await Promise.all([
          api.get("/plans"),
          api.get("/subscriptions/me").catch(() => ({ data: null })),
        ]);
        setPlans(p.data);
        setMySub(s.data);
      } finally { setLoading(false); }
    })();
  }, []);

  const goCheckout = (planKey) => {
    navigate(`/checkout/${planKey}?cycle=${cycle}`);
  };

  const isCurrent = (planKey) => mySub?.plan_key === planKey && ["active", "trial", "past_due"].includes(mySub?.status);

  if (loading) {
    return <div className="p-12 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  }

  const sortedPlans = [...plans].sort((a, b) => PLAN_ORDER.indexOf(a.plan_key) - PLAN_ORDER.indexOf(b.plan_key));

  return (
    <div data-testid="planos-page">
      <PageHeader
        title="Planos e Assinatura"
        subtitle="Escolha o plano ideal para sua clínica"
      />

      <div className="p-6 sm:p-8 max-w-6xl mx-auto animate-fade-up space-y-8">
        {mySub && (
          <div className="rounded-2xl border border-border bg-card px-5 py-4 flex items-center justify-between" data-testid="current-plan-banner">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-primary/10 ring-1 ring-primary/30 flex items-center justify-center">
                <Sparkles className="h-5 w-5 text-primary" strokeWidth={1.5} />
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Plano atual</div>
                <div className="font-display text-lg font-semibold tracking-tight">
                  {mySub.plan?.name || mySub.plan_key} · <span className="text-xs text-muted-foreground">{mySub.effective_status}</span>
                </div>
              </div>
            </div>
            {mySub.status === "trial" && (
              <Badge className="bg-amber-500/15 text-amber-600 border-0" data-testid="trial-badge">
                Trial · {mySub.trial_days_left ?? "?"} dias restantes
              </Badge>
            )}
          </div>
        )}

        {/* Cycle toggle */}
        <div className="flex justify-center">
          <div className="inline-flex items-center rounded-xl border border-border bg-card p-0.5" data-testid="cycle-toggle">
            <button onClick={() => setCycle("monthly")} data-testid="cycle-monthly"
              className={`text-xs px-4 py-2 rounded-lg transition-colors ${cycle === "monthly" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>
              Mensal
            </button>
            <button onClick={() => setCycle("yearly")} data-testid="cycle-yearly"
              className={`text-xs px-4 py-2 rounded-lg transition-colors ${cycle === "yearly" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>
              Anual <span className="ml-1 text-[10px] opacity-70">20% off</span>
            </button>
          </div>
        </div>

        <div className="grid md:grid-cols-3 gap-5">
          {sortedPlans.map((p) => {
            const price = cycle === "yearly" ? p.annual_price : p.price;
            const monthlyEquivalent = cycle === "yearly" ? p.annual_price / 12 : p.price;
            const highlighted = p.plan_key === HIGHLIGHT_PLAN;
            const current = isCurrent(p.plan_key);
            return (
              <div key={p.plan_key}
                data-testid={`plan-card-${p.plan_key}`}
                className={`relative rounded-2xl border p-6 flex flex-col ${
                  highlighted ? "border-primary/60 shadow-lg shadow-primary/10 ring-1 ring-primary/20 bg-card" : "border-border bg-card"
                }`}>
                {highlighted && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 text-[10px] uppercase tracking-[0.18em] px-3 py-1 rounded-full bg-primary text-primary-foreground">
                    Mais escolhido
                  </div>
                )}
                <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{p.plan_key}</div>
                <div className="font-display text-2xl font-semibold tracking-tight mt-1">{p.name}</div>
                <p className="text-xs text-muted-foreground mt-1">{p.description}</p>

                <div className="mt-5">
                  <div className="flex items-baseline gap-1">
                    <span className="font-display text-4xl font-bold">{moneyBR(monthlyEquivalent)}</span>
                    <span className="text-xs text-muted-foreground">/mês</span>
                  </div>
                  {cycle === "yearly" && (
                    <div className="text-[11px] text-muted-foreground mt-1">
                      Cobrado {moneyBR(price)}/ano · economia de {moneyBR(p.price * 12 - p.annual_price)}
                    </div>
                  )}
                </div>

                <ul className="mt-6 space-y-2 text-sm flex-1">
                  {(FEATURE_LIST[p.plan_key] || []).map((f) => (
                    <li key={f} className="flex items-start gap-2">
                      <Check className="h-4 w-4 text-success shrink-0 mt-0.5" strokeWidth={2} />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>

                <Button onClick={() => goCheckout(p.plan_key)}
                  disabled={current || user?.role !== "admin"}
                  title={user?.role !== "admin" ? "Apenas o administrador pode assinar" : ""}
                  data-testid={`subscribe-${p.plan_key}`}
                  className={`mt-6 w-full h-11 rounded-xl ${
                    highlighted ? "bg-primary text-primary-foreground hover:bg-primary/90" :
                    "bg-card border border-border text-foreground hover:bg-muted/40"
                  }`}>
                  {current ? "Plano atual" : user?.role !== "admin" ? "Pedir ao admin" : <>Assinar <ArrowRight className="h-4 w-4 ml-1" /></>}
                </Button>
              </div>
            );
          })}
        </div>

        <div className="text-center text-[11px] text-muted-foreground/70">
          Pagamentos processados com segurança pela Asaas · PIX, Boleto ou Cartão de crédito
        </div>
      </div>
    </div>
  );
}
