import React, { useEffect, useMemo, useState } from "react";
import api from "@/lib/api";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Sparkles, Loader2, Smartphone } from "lucide-react";
import { toast } from "sonner";
import PhotoUploader from "@/components/PhotoUploader";
import MobileUploadQR from "@/components/MobileUploadQR";

const IMC_CLASS = (imc) => {
  if (imc < 18.5) return { label: "Abaixo do peso", color: "text-secondary" };
  if (imc < 25) return { label: "Peso normal", color: "text-success" };
  if (imc < 30) return { label: "Sobrepeso", color: "text-secondary" };
  if (imc < 35) return { label: "Obesidade Grau I", color: "text-destructive" };
  if (imc < 40) return { label: "Obesidade Grau II", color: "text-destructive" };
  return { label: "Obesidade Grau III", color: "text-destructive" };
};

function computeIMC(answers) {
  const altCm = parseFloat(answers.altura);
  const peso = parseFloat(answers.peso);
  if (!altCm || !peso || altCm <= 0) return null;
  const altM = altCm / 100;
  return peso / (altM * altM);
}

/**
 * FichaForm — generic conditional form with autosave, IMC compute, and
 * "Fotos da Avaliação" section (upload + mobile QR capture).
 */
export default function FichaForm({ module, schema, patientId, onSaved, onAiSummary }) {
  const [answers, setAnswers] = useState({});
  const [photos, setPhotos] = useState([]);
  const [moduleId, setModuleId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);
  const [busyAi, setBusyAi] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);

  // Load existing module
  useEffect(() => {
    if (!patientId) return;
    (async () => {
      try {
        const { data } = await api.get("/anamnesis-modules", { params: { patient_id: patientId } });
        const mod = (data || []).find((m) => m.module === module);
        if (mod) {
          setAnswers(mod.answers || {});
          setPhotos(mod.photos || []);
          setModuleId(mod.module_id);
        } else {
          setAnswers({});
          setPhotos([]);
          setModuleId(null);
        }
      } catch { /* ignore */ }
    })();
  }, [patientId, module]);

  // Autosave answers
  useEffect(() => {
    if (!patientId) return;
    if (Object.keys(answers).length === 0 && photos.length === 0) return;
    const t = setTimeout(async () => {
      setSaving(true);
      try {
        const { data } = await api.post("/anamnesis-modules", {
          patient_id: patientId, module, answers, photos,
        });
        setModuleId(data.module_id);
        setSavedAt(new Date());
        onSaved?.();
      } catch { /* ignore */ }
      finally { setSaving(false); }
    }, 900);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answers, photos]);

  const setField = (k, v) => setAnswers((a) => ({ ...a, [k]: v }));

  const imc = useMemo(() => computeIMC(answers), [answers]);
  const visibleFields = useMemo(
    () => schema.filter((f) => !f.when || f.when(answers)),
    [schema, answers]
  );

  const aiSummarize = async () => {
    setBusyAi(true);
    try {
      const notes = visibleFields
        .map((f) => `${f.label}: ${answers[f.key] ?? "—"}`)
        .join("\n");
      const { data } = await api.post("/ai/generate", {
        type: "anamnesis_summary", patient_id: patientId, notes,
      });
      onAiSummary?.(data.text);
      toast.success("Resumo gerado");
    } catch { toast.error("Falha IA"); }
    finally { setBusyAi(false); }
  };

  const onMobileUploaded = async () => {
    // refetch module to pick up new photos
    try {
      const { data } = await api.get("/anamnesis-modules", { params: { patient_id: patientId } });
      const mod = (data || []).find((m) => m.module === module);
      if (mod?.photos) setPhotos(mod.photos);
    } catch { /* ignore */ }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
          {saving ? "Salvando..." : savedAt ? `Rascunho salvo ${savedAt.toLocaleTimeString("pt-BR").slice(0,5)}` : "Pronto"}
        </div>
        <Button type="button" size="sm" variant="outline" onClick={aiSummarize} disabled={busyAi}
          className="rounded-lg h-8 text-xs" data-testid={`ficha-${module}-ai-btn`}>
          {busyAi ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Sparkles className="h-3 w-3 mr-1" />}
          Resumo IA
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {visibleFields.map((f) => {
          const colCls = f.full ? "md:col-span-2 space-y-1.5" : "space-y-1.5";

          if (f.type === "imc") {
            const cls = imc ? IMC_CLASS(imc) : null;
            return (
              <div key={f.key} className={colCls}>
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">{f.label}</Label>
                <div className="h-11 rounded-xl border border-border bg-muted/40 px-3 flex items-center gap-3" data-testid={`ficha-${module}-imc`}>
                  <span className="font-display text-lg font-semibold tracking-tight">
                    {imc ? imc.toFixed(2) : "—"}
                  </span>
                  {cls && (
                    <span className={`text-xs ${cls.color} px-2 py-0.5 rounded-full bg-card border border-border`} data-testid={`ficha-${module}-imc-class`}>
                      {cls.label}
                    </span>
                  )}
                </div>
                {f.help && <p className="text-[11px] text-muted-foreground/80">{f.help}</p>}
              </div>
            );
          }
          return (
            <div key={f.key} className={colCls}>
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
                        key={o} type="button"
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
          );
        })}
      </div>

      {/* Fotos da Avaliação */}
      <div className="mt-8 pt-6 border-t border-border">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Avaliação visual</div>
            <h4 className="font-display text-base font-semibold tracking-tight">Fotos da Avaliação</h4>
          </div>
          <Button type="button" size="sm" variant="outline" onClick={() => setQrOpen(true)}
            disabled={!moduleId}
            className="rounded-lg h-9 text-xs" data-testid={`ficha-${module}-mobile-qr-btn`}>
            <Smartphone className="h-3.5 w-3.5 mr-1.5" />
            Capturar pelo celular
          </Button>
        </div>
        <PhotoUploader
          value={photos}
          onChange={setPhotos}
          testid={`ficha-${module}-photos`}
        />
      </div>

      <MobileUploadQR
        open={qrOpen}
        onOpenChange={setQrOpen}
        contextType="anamnesis"
        contextId={moduleId}
        contextLabel={`Fotos · ${module}`}
        onUploaded={onMobileUploaded}
      />
    </div>
  );
}
