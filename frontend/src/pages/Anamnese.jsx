import React, { useEffect, useState } from "react";
import api from "@/lib/api";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Plus, FileSignature } from "lucide-react";
import { toast } from "sonner";
import { formatApiErrorDetail } from "@/lib/api";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";

const TEMPLATE_QUESTIONS = [
  { key: "queixa_principal", label: "Queixa principal", type: "text" },
  { key: "alergias", label: "Possui alergias?", type: "text" },
  { key: "medicamentos", label: "Uso de medicamentos contínuos?", type: "text" },
  { key: "gestante", label: "Está gestante ou amamentando?", type: "select", options: ["Não", "Sim - gestante", "Sim - amamentando"] },
  { key: "doencas_pre", label: "Doenças preexistentes", type: "text" },
  { key: "procedimentos_anteriores", label: "Procedimentos estéticos anteriores", type: "textarea" },
  { key: "habitos_solar", label: "Exposição solar frequente?", type: "select", options: ["Não", "Ocasional", "Frequente"] },
  { key: "tabagismo", label: "Tabagismo?", type: "select", options: ["Não", "Sim"] },
];

export default function Anamnese() {
  const [items, setItems] = useState([]);
  const [patients, setPatients] = useState([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    patient_id: "", template_name: "Estética Geral", answers: {}, signed: false,
  });

  const load = async () => {
    const [a, p] = await Promise.all([api.get("/anamnesis"), api.get("/patients")]);
    setItems(a.data);
    setPatients(p.data);
  };
  useEffect(() => { load(); }, []);

  const setAnswer = (k, v) => setForm((f) => ({ ...f, answers: { ...f.answers, [k]: v } }));

  const onSubmit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post("/anamnesis", form);
      toast.success("Anamnese cadastrada");
      setOpen(false);
      setForm({ patient_id: "", template_name: "Estética Geral", answers: {}, signed: false });
      await load();
    } catch (err) {
      toast.error(formatApiErrorDetail(err.response?.data?.detail) || err.message);
    } finally { setBusy(false); }
  };

  return (
    <div data-testid="anamnese-page">
      <PageHeader
        title="Anamnese"
        subtitle={`${items.length} formulários preenchidos`}
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button data-testid="new-anamnese-btn" className="rounded-xl bg-primary text-primary-foreground hover:bg-primary/90">
                <Plus className="h-4 w-4 mr-1.5" />Nova anamnese
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl rounded-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader><DialogTitle className="font-display text-2xl tracking-tight">Nova anamnese — Estética Geral</DialogTitle></DialogHeader>
              <form onSubmit={onSubmit} className="space-y-4" data-testid="anamnese-form">
                <div className="space-y-1.5">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">Paciente *</Label>
                  <select required data-testid="ana-patient" value={form.patient_id}
                    onChange={(e) => setForm({ ...form, patient_id: e.target.value })}
                    className="w-full h-11 rounded-xl border border-border bg-card px-3 text-sm">
                    <option value="">Selecione...</option>
                    {patients.map((p) => <option key={p.patient_id} value={p.patient_id}>{p.name}</option>)}
                  </select>
                </div>
                {TEMPLATE_QUESTIONS.map((q) => (
                  <div key={q.key} className="space-y-1.5">
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground">{q.label}</Label>
                    {q.type === "text" && (
                      <Input data-testid={`ana-${q.key}`} value={form.answers[q.key] || ""} onChange={(e) => setAnswer(q.key, e.target.value)} className="h-11 rounded-xl" />
                    )}
                    {q.type === "textarea" && (
                      <Textarea data-testid={`ana-${q.key}`} value={form.answers[q.key] || ""} onChange={(e) => setAnswer(q.key, e.target.value)} className="rounded-xl" />
                    )}
                    {q.type === "select" && (
                      <select data-testid={`ana-${q.key}`} value={form.answers[q.key] || ""} onChange={(e) => setAnswer(q.key, e.target.value)}
                        className="w-full h-11 rounded-xl border border-border bg-card px-3 text-sm">
                        <option value="">Selecione...</option>
                        {q.options.map((o) => <option key={o} value={o}>{o}</option>)}
                      </select>
                    )}
                  </div>
                ))}
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" data-testid="ana-signed" checked={form.signed} onChange={(e) => setForm({ ...form, signed: e.target.checked })} />
                  Assinatura digital obtida (ICP Brasil)
                </label>
                <DialogFooter>
                  <Button type="submit" disabled={busy} className="rounded-xl bg-primary text-primary-foreground hover:bg-primary/90" data-testid="ana-submit-btn">
                    {busy ? "Salvando..." : "Salvar anamnese"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        }
      />

      <div className="p-6 sm:p-8 space-y-4 animate-fade-up">
        {items.length === 0 && (
          <div className="text-center py-16 text-muted-foreground border border-dashed border-border rounded-2xl" data-testid="empty-anamnese">
            Nenhuma anamnese cadastrada.
          </div>
        )}
        {items.map((a) => (
          <div key={a.anamnesis_id} data-testid={`anamnese-${a.anamnesis_id}`} className="rounded-2xl border border-border bg-card p-6">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                  {format(parseISO(a.created_at), "dd 'de' MMM, yyyy", { locale: ptBR })}
                </div>
                <h3 className="font-display text-lg font-semibold tracking-tight mt-1">{a.patient_name}</h3>
                <div className="text-sm text-muted-foreground">{a.template_name}</div>
              </div>
              {a.signed && (
                <Badge className="bg-success/15 text-success border-success/30">
                  <FileSignature className="h-3 w-3 mr-1" /> Assinada
                </Badge>
              )}
            </div>
            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
              {Object.entries(a.answers || {}).map(([k, v]) => (
                <div key={k} className="flex flex-col">
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{k.replace(/_/g, " ")}</span>
                  <span>{String(v) || "—"}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
