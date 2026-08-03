import React from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Plus, Trash2 } from "lucide-react";

/**
 * MedicationTable — dynamic tabular editor for medications, suplementos, hormônios,
 * cosmecêuticos, nutracêuticos.
 *
 * Props:
 *  - value: array<{name, dose, frequency, notes}>
 *  - onChange(next)
 *  - columns? overrides — default [{key:'name',label:'Nome',w:'flex-1 min-w-[160px]'},...]
 *  - allowAdd? boolean (default true)
 *  - allowRemove? boolean (default true)
 *  - addLabel? string
 *  - testid? string
 */
const DEFAULT_COLUMNS = [
  { key: "name", label: "Nome", placeholder: "Ex. Losartana", w: "flex-1 min-w-[160px]" },
  { key: "dose", label: "Dose", placeholder: "50mg", w: "w-24" },
  { key: "frequency", label: "Frequência", placeholder: "1x/dia", w: "w-32" },
  { key: "notes", label: "Observação", placeholder: "", w: "flex-1 min-w-[140px]" },
];

export default function MedicationTable({
  value, onChange,
  columns = DEFAULT_COLUMNS,
  allowAdd = true,
  allowRemove = true,
  addLabel = "Adicionar item",
  testid = "medication-table",
}) {
  const rows = Array.isArray(value) ? value : [];

  const updateRow = (idx, key, v) => {
    const next = rows.map((r, i) => (i === idx ? { ...r, [key]: v } : r));
    onChange(next);
  };
  const addRow = () => {
    const blank = columns.reduce((acc, c) => ({ ...acc, [c.key]: "" }), {});
    onChange([...rows, blank]);
  };
  const removeRow = (idx) => onChange(rows.filter((_, i) => i !== idx));

  return (
    <div className="rounded-xl border border-border overflow-hidden" data-testid={testid}>
      {/* Header */}
      <div className="hidden sm:flex bg-muted/40 border-b border-border px-3 py-2 gap-2 text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
        {columns.map((c) => (
          <div key={c.key} className={c.w}>{c.label}</div>
        ))}
        {allowRemove && <div className="w-8" />}
      </div>

      {/* Rows */}
      <div className="divide-y divide-border">
        {rows.length === 0 && (
          <div className="text-xs text-muted-foreground text-center py-6">
            Nenhum item registrado.
          </div>
        )}
        {rows.map((row, idx) => (
          <div key={idx} className="flex flex-col sm:flex-row gap-2 px-3 py-2 items-stretch sm:items-center" data-testid={`${testid}-row-${idx}`}>
            {columns.map((c) => (
              <div key={c.key} className={c.w}>
                <div className="sm:hidden text-[10px] uppercase tracking-wider text-muted-foreground mb-1">{c.label}</div>
                <Input
                  value={row[c.key] || ""}
                  placeholder={c.placeholder || ""}
                  onChange={(e) => updateRow(idx, c.key, e.target.value)}
                  className="h-9 rounded-lg text-sm"
                  data-testid={`${testid}-row-${idx}-${c.key}`}
                />
              </div>
            ))}
            {allowRemove && (
              <button
                type="button"
                onClick={() => removeRow(idx)}
                className="h-9 w-9 rounded-lg border border-border hover:border-destructive hover:text-destructive flex items-center justify-center self-end sm:self-auto"
                data-testid={`${testid}-row-${idx}-remove`}
                aria-label="Remover linha"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        ))}
      </div>

      {allowAdd && (
        <div className="border-t border-border p-2 bg-card">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addRow}
            className="rounded-lg h-8 text-xs"
            data-testid={`${testid}-add`}
          >
            <Plus className="h-3.5 w-3.5 mr-1" />
            {addLabel}
          </Button>
        </div>
      )}
    </div>
  );
}
