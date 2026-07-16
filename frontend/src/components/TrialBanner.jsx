import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "@/lib/api";
import { Clock, AlertTriangle, CreditCard } from "lucide-react";

/**
 * TrialBanner — shows a soft banner at top when the clinic is in trial, past_due, read_only.
 * Hides when active.
 */
export default function TrialBanner() {
  const [sub, setSub] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get("/subscriptions/me");
        setSub(data);
      } catch { /* ignore */ }
    })();
  }, []);

  if (!sub) return null;
  const effective = sub.effective_status || sub.status;

  if (effective === "trial") {
    const daysLeft = sub.trial_days_left ?? 0;
    return (
      <Banner
        testid="trial-banner"
        icon={Clock}
        tone="info"
        text={`Trial gratuito · ${daysLeft} ${daysLeft === 1 ? "dia restante" : "dias restantes"}`}
        cta="Assinar agora"
        onClick={() => navigate("/planos")}
      />
    );
  }
  if (effective === "past_due") {
    return (
      <Banner
        testid="past-due-banner"
        icon={AlertTriangle}
        tone="warn"
        text="Pagamento pendente — regularize para manter seu acesso"
        cta="Ver assinatura"
        onClick={() => navigate("/minha-assinatura")}
      />
    );
  }
  if (effective === "read_only") {
    return (
      <Banner
        testid="readonly-banner"
        icon={AlertTriangle}
        tone="warn"
        text="Trial encerrado — modo somente leitura. Assine para reativar edição."
        cta="Assinar"
        onClick={() => navigate("/planos")}
      />
    );
  }
  if (effective === "expired") {
    return (
      <Banner
        testid="expired-banner"
        icon={CreditCard}
        tone="danger"
        text="Assinatura expirada — reative para retomar o acesso."
        cta="Reativar"
        onClick={() => navigate("/planos")}
      />
    );
  }
  return null;
}

function Banner({ icon: Icon, text, cta, onClick, tone, testid }) {
  const tones = {
    info:   "bg-primary/10 border-primary/30 text-primary",
    warn:   "bg-amber-500/10 border-amber-500/30 text-amber-600",
    danger: "bg-destructive/10 border-destructive/30 text-destructive",
  };
  return (
    <div className={`px-4 py-2.5 border-b ${tones[tone]} flex items-center justify-between gap-3`} data-testid={testid}>
      <div className="flex items-center gap-2 text-xs sm:text-sm">
        <Icon className="h-4 w-4 shrink-0" strokeWidth={1.5} />
        <span>{text}</span>
      </div>
      <button onClick={onClick} className="text-xs font-medium underline underline-offset-2 hover:opacity-80 shrink-0">
        {cta}
      </button>
    </div>
  );
}
