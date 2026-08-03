import React, { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";

/**
 * CheckboxGroupVisual — grouped/categorized multi-select checklist with visual chips.
 * Reusable for Doenças, Histórico Clínico/Estético, Hábitos, Contraindicações, etc.
 *
 * Props:
 *  - value: array<string>
 *  - onChange(next)
 *  - groups?: [{ label, description?, options: [{value, label, icon?, description?, risk?}] }]
 *  - options?: flat array (alternative to groups)
 *  - searchable? boolean (default true when items > 10)
 *  - testid? string
 */
export default function CheckboxGroupVisual({
  value = [], onChange,
  groups, options,
  searchable, testid = "checkbox-group-visual",
}) {
  const [query, setQuery] = useState("");
  const normalizedGroups = useMemo(() => {
    if (groups && groups.length) return groups;
    return [{ label: "", options: options || [] }];
  }, [groups, options]);

  const totalItems = normalizedGroups.reduce((n, g) => n + (g.options?.length || 0), 0);
  const showSearch = searchable ?? totalItems > 10;

  const arr = Array.isArray(value) ? value : [];
  const toggle = (v) =>
    onChange(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  const riskColor = {
    baixo: "text-emerald-600",
    medio: "text-amber-600",
    alto: "text-rose-600",
  };

  const filtered = normalizedGroups
    .map((g) => ({
      ...g,
      options: (g.options || []).filter(
        (o) =>
          !query ||
          o.label.toLowerCase().includes(query.toLowerCase()) ||
          (o.description && o.description.toLowerCase().includes(query.toLowerCase()))
      ),
    }))
    .filter((g) => g.options.length > 0);

  return (
    <div className="space-y-3" data-testid={testid}>
      {showSearch && (
        <div className="relative">
          <Search className="h-3.5 w-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar..."
            className="h-9 pl-8 rounded-xl text-xs"
            data-testid={`${testid}-search`}
          />
        </div>
      )}

      {filtered.map((g, gi) => (
        <div key={gi}>
          {g.label && (
            <div className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground/80 mb-1.5">
              {g.label}
            </div>
          )}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-1.5">
            {g.options.map((o) => {
              const on = arr.includes(o.value);
              return (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => toggle(o.value)}
                  data-testid={`${testid}-${o.value}`}
                  className={`flex items-start gap-2 text-left px-2.5 py-2 rounded-lg border transition-all
                    ${on
                      ? "bg-primary/10 border-primary ring-1 ring-primary/40"
                      : "border-border hover:border-primary/40"}
                  `}
                >
                  <span
                    className={`mt-0.5 h-4 w-4 flex-shrink-0 rounded border flex items-center justify-center text-[10px]
                      ${on ? "bg-primary border-primary text-primary-foreground" : "border-border"}
                    `}
                  >
                    {on ? "✓" : ""}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="flex items-center gap-1.5">
                      {o.icon && <span className="text-base leading-none">{o.icon}</span>}
                      <span className="text-xs font-medium">{o.label}</span>
                    </span>
                    {o.description && (
                      <span className="block text-[10px] text-muted-foreground mt-0.5 leading-snug">
                        {o.description}
                      </span>
                    )}
                    {o.risk && (
                      <span className={`block text-[10px] mt-0.5 ${riskColor[o.risk] || ""}`}>
                        · Risco {o.risk}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
      {filtered.length === 0 && (
        <div className="text-xs text-muted-foreground py-4 text-center">Nenhum item encontrado.</div>
      )}

      {arr.length > 0 && (
        <div className="text-[11px] text-muted-foreground">
          <span className="font-medium">{arr.length}</span> selecionado(s)
        </div>
      )}
    </div>
  );
}
