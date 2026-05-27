import React, { useEffect, useMemo, useState } from "react";
import api from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Sparkles, Loader2, Save } from "lucide-react";
import { toast } from "sonner";

/**
 * FichaForm — generic conditional form with autosave.
 * Props:
 *   module: "geral" | "facial" | "corporal" | "capilar"
 *   schema: [{ key, label, type, options?, when? }]
 *   patientId: string
 *   onSaved?: () => void
 *   onAiSummary?: (summary: string) => void
 */
export default function FichaForm({ module, schema, patientId, onSaved, onAiSummary }) {
  const [answers, setAnswers] = useState({});
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);
  const [busyAi, setBusyAi] = useState(false);

  // Load existing draft
  useEffect(() => {
    (async () => {
      if (!patientId) return;
      try {
        const { data } = await api.get("/anamnesis-modules", { params: { patient_id: patientId } });
        const mod = (data || []).find((m) => m.module === module);
        if (mod) setAnswers(mod.answers || {});
      } catch { /* ignore */ }
    })();
  }, [patientId, module]);

  // Autosave (debounced) on answers change
  useEffect(() => {
    if (!patientId || Object.keys(answers).length === 0) return;
    const t = setTimeout(async () => {
      setSaving(true);
      try {
        await api.post("/anamnesis-modules", { patient_id: patientId, module, answers });
        setSavedAt(new Date());
        onSaved?.();
      } catch { /* ignore */ }
      finally { setSaving(false); }
    }, 900);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answers]);

  const setField = (k, v) => setAnswers((a) => ({ ...a, [k]: v }));

  // Compute visible fields by `when` predicate
  const visibleFields = useMemo(
    () => schema.filter((f) => !f.when || f.when(answers)),
    [schema, answers]
  );

  const aiSummarize = async () => {
    setBusyAi(true);
    try {
      const notes = visibleFields.map((f) => `${f.label}: ${answers[f.key] ?? "—"}`).join("\n");
      const { data } = await api.post("/ai/generate", {
        type: "anamnesis_summary",
        patient_id: patientId,
        notes,
      });
      onAiSummary?.(data.text);
      toast.success("Resumo gerado");
    } catch (e) {
      toast.error("Falha IA");
    } finally { setBusyAi(false); }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
          {saving ? "Salvando..." : savedAt ? `Rascunho salvo ${savedAt.toLocaleTimeString("pt-BR")}` : "Pronto"}
        </div>
        <Button type="button" size="sm" variant="outline" onClick={aiSummarize} disabled={busyAi}
          className="rounded-lg h-8 text-xs" data-testid={`ficha-${module}-ai-btn`}>
          {busyAi ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Sparkles className="h-3 w-3 mr-1" />}
          Resumo IA
        </Button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {visibleFields.map((f) => (
          <div key={f.key} className={f.full ? "md:col-span-2 space-y-1.5" : "space-y-1.5"}>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">{f.label}</Label>
            {f.type === "text" && (
              <Input data-testid={`ficha-${module}-${f.key}`} value={answers[f.key] || ""}
                onChange={(e) => setField(f.key, e.target.value)} className="h-11 rounded-xl" />
            )}
            {f.type === "number" && (
              <Input type="number" data-testid={`ficha-${module}-${f.key}`} value={answers[f.key] ?? ""}
                onChange={(e) => setField(f.key, e.target.value)} className="h-11 rounded-xl" />
            )}
            {f.type === "textarea" && (
              <Textarea data-testid={`ficha-${module}-${f.key}`} rows={3} value={answers[f.key] || ""}
                onChange={(e) => setField(f.key, e.target.value)} className="rounded-xl" />
            )}
            {f.type === "select" && (
              <select data-testid={`ficha-${module}-${f.key}`} value={answers[f.key] || ""}
                onChange={(e) => setField(f.key, e.target.value)}
                className="w-full h-11 rounded-xl border border-border bg-card px-3 text-sm">
                <option value="">Selecione...</option>
                {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            )}
            {f.type === "chips" && (
              <div className="flex flex-wrap gap-2">
                {f.options.map((o) => {
                  const arr = answers[f.key] || [];
                  const on = arr.includes(o);
                  return (
                    <button
                      key={o}
                      type="button"
                      data-testid={`ficha-${module}-${f.key}-${o}`}
                      onClick={() => setField(f.key, on ? arr.filter((x) => x !== o) : [...arr, o])}
                      className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                        on ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {o}
                    </button>
                  );
                })}
              </div>
            )}
            {f.help && <p className="text-[11px] text-muted-foreground/80">{f.help}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}
