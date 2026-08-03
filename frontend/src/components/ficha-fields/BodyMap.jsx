import React, { useState, useMemo } from "react";
import {
  REGIONS_FRONTAL_FULL,
  REGIONS_POSTERIOR_FULL,
  SILHOUETTE_PATH,
} from "./body-regions";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * BodyMap — reusable clickable anatomical map for gordura localizada, celulite,
 * flacidez, estrias, epilação, áreas de dor, aplicação de enzimas, etc.
 *
 * Props:
 *  - value: array<string> (region ids)
 *  - onChange(next)
 *  - views?: array of "frontal" | "posterior" (default both)
 *  - regionsFrontal? / regionsPosterior?: override region catalog
 *  - highlightColor?: css color (default primary)
 *  - allowChipToggle? boolean (chips list under svg, default true)
 *  - testid? string
 */
export default function BodyMap({
  value, onChange,
  views = ["frontal", "posterior"],
  regionsFrontal = REGIONS_FRONTAL_FULL,
  regionsPosterior = REGIONS_POSTERIOR_FULL,
  highlightColor,
  allowChipToggle = true,
  testid = "body-map",
}) {
  const [activeView, setActiveView] = useState(views[0]);
  const arr = Array.isArray(value) ? value : [];

  const regions = activeView === "frontal" ? regionsFrontal : regionsPosterior;
  const allRegions = useMemo(
    () => [...regionsFrontal, ...regionsPosterior],
    [regionsFrontal, regionsPosterior]
  );

  const toggle = (id) =>
    onChange(arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id]);

  const fillHighlight = highlightColor || "hsl(var(--primary))";

  return (
    <TooltipProvider delayDuration={150}>
      <div className="rounded-xl border border-border bg-card p-3" data-testid={testid}>
        {/* View toggle */}
        {views.length > 1 && (
          <div className="flex gap-1 mb-3 justify-center">
            {views.map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setActiveView(v)}
                className={`text-[11px] px-3 py-1.5 rounded-full border transition-all ${
                  activeView === v
                    ? "bg-primary text-primary-foreground border-primary"
                    : "border-border text-muted-foreground hover:text-foreground"
                }`}
                data-testid={`${testid}-view-${v}`}
              >
                {v === "frontal" ? "Frontal" : "Posterior"}
              </button>
            ))}
          </div>
        )}

        <div className="flex items-start justify-center">
          <svg viewBox="0 0 100 100" className="w-56 h-auto" data-testid={`${testid}-svg-${activeView}`}>
            {/* Silhouette */}
            <path
              d={SILHOUETTE_PATH}
              fill="hsl(var(--muted))"
              stroke="hsl(var(--border))"
              strokeWidth="0.4"
            />
            {/* Regions */}
            {regions.map((r) => {
              const on = arr.includes(r.id);
              return (
                <Tooltip key={r.id}>
                  <TooltipTrigger asChild>
                    <ellipse
                      cx={r.cx}
                      cy={r.cy}
                      rx={r.rx}
                      ry={r.ry}
                      onClick={() => toggle(r.id)}
                      data-testid={`${testid}-region-${r.id}`}
                      fill={on ? fillHighlight : "transparent"}
                      fillOpacity={on ? 0.55 : 0}
                      stroke={on ? fillHighlight : "hsl(var(--muted-foreground))"}
                      strokeOpacity={on ? 0.9 : 0.35}
                      strokeWidth={on ? 0.5 : 0.3}
                      style={{ cursor: "pointer", transition: "all 0.15s" }}
                      className="hover:opacity-80"
                    />
                  </TooltipTrigger>
                  <TooltipContent className="text-xs">{r.label}</TooltipContent>
                </Tooltip>
              );
            })}
          </svg>
        </div>

        {/* Chips list */}
        {allowChipToggle && (
          <div className="mt-3 pt-3 border-t border-border">
            <div className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground mb-2">
              Regiões — {activeView}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {regions.map((r) => {
                const on = arr.includes(r.id);
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => toggle(r.id)}
                    data-testid={`${testid}-chip-${r.id}`}
                    className={`text-[11px] px-2.5 py-1 rounded-full border transition-all ${
                      on
                        ? "bg-primary text-primary-foreground border-primary"
                        : "border-border text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {r.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {arr.length > 0 && (
          <div className="mt-2 text-[11px] text-muted-foreground">
            <span className="font-medium">{arr.length}</span> região(ões) selecionada(s)
            {" · "}
            <button
              type="button"
              onClick={() => onChange([])}
              className="underline hover:text-foreground"
              data-testid={`${testid}-clear`}
            >
              limpar
            </button>
          </div>
        )}

        {/* Screen-reader summary of ALL selected regions across both views */}
        <span className="sr-only" aria-live="polite">
          Regiões selecionadas: {arr.map((id) => allRegions.find((r) => r.id === id)?.label || id).join(", ") || "nenhuma"}
        </span>
      </div>
    </TooltipProvider>
  );
}
