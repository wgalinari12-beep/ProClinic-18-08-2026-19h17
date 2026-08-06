import React, { useEffect, useRef, useState } from "react";
import { Calendar } from "lucide-react";

// ⭐ Fase 8/9 — Filtro de período reutilizável (Dashboard + Financeiro)
const pad = (n) => String(n).padStart(2, "0");
const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d; };
const monthsAgo = (n) => { const d = new Date(); d.setMonth(d.getMonth() - n); return d; };
const yearsAgo = (n) => { const d = new Date(); d.setFullYear(d.getFullYear() - n); return d; };

export const PRESETS = {
  today: { label: "Hoje", range: () => [new Date(), new Date()] },
  yesterday: { label: "Ontem", range: () => [daysAgo(1), daysAgo(1)] },
  "7d": { label: "Últimos 7 dias", range: () => [daysAgo(6), new Date()] },
  "15d": { label: "Últimos 15 dias", range: () => [daysAgo(14), new Date()] },
  "30d": { label: "Últimos 30 dias", range: () => [daysAgo(29), new Date()] },
  "90d": { label: "Últimos 90 dias", range: () => [daysAgo(89), new Date()] },
  "180d": { label: "Últimos 180 dias", range: () => [daysAgo(179), new Date()] },
  "6m": { label: "Últimos 6 meses", range: () => [monthsAgo(6), new Date()] },
  "1y": { label: "Último ano", range: () => [yearsAgo(1), new Date()] },
  "2y": { label: "Últimos 2 anos", range: () => [yearsAgo(2), new Date()] },
  "5y": { label: "Últimos 5 anos", range: () => [yearsAgo(5), new Date()] },
  "10y": { label: "Últimos 10 anos", range: () => [yearsAgo(10), new Date()] },
};

export default function PeriodFilter({
  presets = ["today", "7d", "30d", "90d", "6m", "1y"],
  defaultKey = "30d",
  onChange,
  className = "",
}) {
  const [selected, setSelected] = useState(defaultKey);
  const [showCustom, setShowCustom] = useState(false);
  const [customStart, setCustomStart] = useState(fmt(daysAgo(29)));
  const [customEnd, setCustomEnd] = useState(fmt(new Date()));
  const firedRef = useRef(false);

  const emitPreset = (key) => {
    const p = PRESETS[key];
    if (!p) return;
    const [s, e] = p.range();
    onChange?.({ start: fmt(s), end: fmt(e), label: p.label });
  };

  // dispara o período default uma vez ao montar
  useEffect(() => {
    if (firedRef.current) return;
    firedRef.current = true;
    emitPreset(defaultKey);
  }, []);

  const handleSelect = (e) => {
    const key = e.target.value;
    setSelected(key);
    if (key === "custom") {
      setShowCustom(true);
    } else {
      setShowCustom(false);
      emitPreset(key);
    }
  };

  const applyCustom = () => {
    if (!customStart || !customEnd) return;
    const s = customStart <= customEnd ? customStart : customEnd;
    const en = customStart <= customEnd ? customEnd : customStart;
    onChange?.({ start: s, end: en, label: "Personalizado" });
  };

  return (
    <div className={`flex items-center gap-2 flex-wrap ${className}`} data-testid="period-filter">
      <div className="relative flex items-center">
        <Calendar className="h-4 w-4 text-muted-foreground absolute left-3 pointer-events-none" />
        <select
          value={selected}
          onChange={handleSelect}
          data-testid="period-select"
          className="h-10 rounded-xl border border-border bg-card pl-9 pr-8 text-sm appearance-none cursor-pointer hover:border-primary/40 transition-colors"
        >
          {presets.map((k) => (
            <option key={k} value={k}>{PRESETS[k]?.label || k}</option>
          ))}
          <option value="custom">Personalizado…</option>
        </select>
      </div>

      {showCustom && (
        <div className="flex items-center gap-2 flex-wrap" data-testid="period-custom">
          <input
            type="date"
            value={customStart}
            onChange={(e) => setCustomStart(e.target.value)}
            data-testid="period-custom-start"
            className="h-10 rounded-xl border border-border bg-card px-3 text-sm"
          />
          <span className="text-muted-foreground text-sm">até</span>
          <input
            type="date"
            value={customEnd}
            onChange={(e) => setCustomEnd(e.target.value)}
            data-testid="period-custom-end"
            className="h-10 rounded-xl border border-border bg-card px-3 text-sm"
          />
          <button
            type="button"
            onClick={applyCustom}
            data-testid="period-custom-apply"
            className="h-10 px-4 rounded-xl bg-primary text-primary-foreground text-sm hover:bg-primary/90 transition-colors"
          >
            Aplicar
          </button>
        </div>
      )}
    </div>
  );
}
