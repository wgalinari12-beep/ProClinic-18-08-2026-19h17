import React from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * CardSelect — premium visual selector using colored cards.
 * Reusable for Fitzpatrick, Acne grade, Celulite, Flacidez, Rosácea, Obesity grade, etc.
 *
 * Props:
 *  - value: string (single) or array (multi)
 *  - onChange(newValue)
 *  - multi: boolean (default false)
 *  - options: array of {
 *      value, label, subtitle?, tooltip?, description?,
 *      image?: url,
 *      icon?: React.node,
 *      bgColor?: css color (card background swatch),
 *      textColor?: css color (label color, e.g. for dark swatches),
 *      score?: string|number, classification?: string, risk?: "baixo"|"medio"|"alto"
 *    }
 *  - columns?: number (default auto)
 *  - testid?: string
 */
export default function CardSelect({
  value, onChange, options = [], multi = false,
  columns, testid = "card-select",
}) {
  const isSelected = (v) =>
    multi ? Array.isArray(value) && value.includes(v) : value === v;

  const toggle = (v) => {
    if (multi) {
      const arr = Array.isArray(value) ? value : [];
      onChange(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
    } else {
      onChange(value === v ? "" : v);
    }
  };

  const colCls =
    columns === 2 ? "grid-cols-2"
    : columns === 3 ? "grid-cols-2 md:grid-cols-3"
    : columns === 4 ? "grid-cols-2 md:grid-cols-4"
    : columns === 6 ? "grid-cols-3 md:grid-cols-6"
    : "grid-cols-2 md:grid-cols-3 lg:grid-cols-4";

  const riskColor = {
    baixo: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
    medio: "bg-amber-500/10 text-amber-600 border-amber-500/30",
    alto: "bg-rose-500/10 text-rose-600 border-rose-500/30",
  };

  return (
    <TooltipProvider delayDuration={200}>
      <div className={`grid ${colCls} gap-2.5`} data-testid={testid}>
        {options.map((opt) => {
          const on = isSelected(opt.value);
          const card = (
            <button
              key={opt.value}
              type="button"
              onClick={() => toggle(opt.value)}
              data-testid={`${testid}-${opt.value}`}
              className={`group relative overflow-hidden rounded-xl border transition-all duration-200 text-left
                ${on
                  ? "border-primary ring-2 ring-primary/40 shadow-md shadow-primary/10"
                  : "border-border hover:border-primary/50 hover:shadow-sm"}
              `}
            >
              {/* swatch / image */}
              <div
                className="h-14 w-full flex items-center justify-center relative"
                style={opt.bgColor ? { backgroundColor: opt.bgColor } : undefined}
              >
                {opt.image ? (
                  <img
                    src={opt.image}
                    alt={opt.label}
                    className="h-full w-full object-cover"
                  />
                ) : opt.icon ? (
                  <span
                    className="text-2xl"
                    style={opt.textColor ? { color: opt.textColor } : undefined}
                  >
                    {opt.icon}
                  </span>
                ) : null}
                {opt.score !== undefined && (
                  <span className="absolute top-1 right-1 text-[10px] font-mono bg-black/40 text-white rounded-full px-1.5 py-0.5">
                    {opt.score}
                  </span>
                )}
              </div>

              {/* content */}
              <div className="p-2.5 bg-card">
                <div className="flex items-center justify-between gap-1">
                  <span className="font-medium text-sm tracking-tight">{opt.label}</span>
                  {on && (
                    <span className="text-primary text-xs" aria-hidden>✓</span>
                  )}
                </div>
                {opt.subtitle && (
                  <div className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">
                    {opt.subtitle}
                  </div>
                )}
                <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                  {opt.classification && (
                    <span className="text-[10px] rounded-full px-1.5 py-0.5 border border-border bg-muted/40">
                      {opt.classification}
                    </span>
                  )}
                  {opt.risk && (
                    <span className={`text-[10px] rounded-full px-1.5 py-0.5 border ${riskColor[opt.risk] || ""}`}>
                      Risco {opt.risk}
                    </span>
                  )}
                </div>
              </div>
            </button>
          );

          if (opt.tooltip) {
            return (
              <Tooltip key={opt.value}>
                <TooltipTrigger asChild>{card}</TooltipTrigger>
                <TooltipContent className="max-w-xs text-xs">
                  {opt.tooltip}
                </TooltipContent>
              </Tooltip>
            );
          }
          return card;
        })}
      </div>
    </TooltipProvider>
  );
}
