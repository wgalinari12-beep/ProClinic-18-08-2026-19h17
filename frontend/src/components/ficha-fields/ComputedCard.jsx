import React from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Info } from "lucide-react";

/**
 * ComputedCard — read-only visual card for derived antropometric metrics.
 * Fully reusable for IMC, RCQ, Petroski, %Gordura, Massa magra, etc.
 *
 * Props:
 *  - label: string (uppercase heading)
 *  - value: string|number (main figure) — or `null` for placeholder
 *  - unit?: string (kg/%, cm, m²)
 *  - subtitle?: string
 *  - classification?: string
 *  - risk?: "baixo"|"medio"|"alto"
 *  - tooltip?: string (info icon + tooltip)
 *  - accent?: css color (border/left bar) — auto by risk when omitted
 *  - testid?: string
 */
const RISK_ACCENT = {
  baixo: "border-l-emerald-500",
  medio: "border-l-amber-500",
  alto:  "border-l-rose-500",
};
const RISK_BADGE = {
  baixo: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
  medio: "bg-amber-500/10 text-amber-600 border-amber-500/30",
  alto:  "bg-rose-500/10 text-rose-600 border-rose-500/30",
};

export default function ComputedCard({
  label, value, unit, subtitle, classification, risk, tooltip,
  accent, testid = "computed-card",
}) {
  const empty = value === null || value === undefined || value === "" || Number.isNaN(value);
  const accentCls = accent || RISK_ACCENT[risk] || "border-l-primary/60";
  return (
    <TooltipProvider delayDuration={150}>
      <div
        className={`rounded-xl border ${accentCls} border-l-4 bg-card p-3 flex flex-col gap-1`}
        data-testid={testid}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground">{label}</span>
          {tooltip && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="text-muted-foreground cursor-help">
                  <Info className="h-3 w-3" />
                </span>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs text-xs">{tooltip}</TooltipContent>
            </Tooltip>
          )}
        </div>
        <div className="flex items-baseline gap-1">
          <span className="font-display text-2xl font-semibold tracking-tight">
            {empty ? "—" : value}
          </span>
          {!empty && unit && (
            <span className="text-xs text-muted-foreground">{unit}</span>
          )}
        </div>
        {(subtitle || classification || risk) && (
          <div className="flex items-center gap-1.5 flex-wrap">
            {classification && (
              <span className="text-[10px] rounded-full px-1.5 py-0.5 border border-border bg-muted/40">
                {classification}
              </span>
            )}
            {risk && (
              <span className={`text-[10px] rounded-full px-1.5 py-0.5 border ${RISK_BADGE[risk] || ""}`}>
                Risco {risk}
              </span>
            )}
            {subtitle && (
              <span className="text-[10px] text-muted-foreground">{subtitle}</span>
            )}
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}
