import React, { useEffect, useState } from "react";
import api from "@/lib/api";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Plus, Image as ImageIcon, ArrowLeftRight } from "lucide-react";
import { toast } from "sonner";
import { formatApiErrorDetail } from "@/lib/api";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";

export default function Prontuario() {
  const [records, setRecords] = useState([]);
  const [patients, setPatients] = useState([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    patient_id: "", procedure: "Botox", professional_name: "Dra. Bella Castro",
    evolution: "", observations: "", prescriptions: "", protocols: "",
    photos_before: "", photos_after: "", signed: false,
  });

  const load = async () => {
    const [r, p] = await Promise.all([api.get("/medical-records"), api.get("/patients")]);
    setRecords(r.data);
    setPatients(p.data);
  };
  useEffect(() => { load(); }, []);

  const onSubmit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post("/medical-records", {
        ...form,
        photos_before: form.photos_before.split(",").map((s) => s.trim()).filter(Boolean),
        photos_after: form.photos_after.split(",").map((s) => s.trim()).filter(Boolean),
      });
      toast.success("Evolução registrada");
      setOpen(false);
      setForm({ ...form, evolution: "", observations: "", photos_before: "", photos_after: "" });
      await load();
    } catch (err) {
      toast.error(formatApiErrorDetail(err.response?.data?.detail) || err.message);
    } finally { setBusy(false); }
  };

  return (
    <div data-testid="prontuario-page">
      <PageHeader
        title="Prontuário Digital"
        subtitle={`${records.length} evoluções clínicas`}
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button data-testid="new-record-btn" className="rounded-xl bg-primary text-primary-foreground hover:bg-primary/90">
                <Plus className="h-4 w-4 mr-1.5" />Nova evolução
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl rounded-2xl">
              <DialogHeader><DialogTitle className="font-display text-2xl tracking-tight">Nova evolução clínica</DialogTitle></DialogHeader>
              <form onSubmit={onSubmit} className="grid grid-cols-2 gap-4" data-testid="record-form">
                <div className="col-span-2 space-y-1.5">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">Paciente *</Label>
                  <select required data-testid="rec-patient" value={form.patient_id}
                    onChange={(e) => setForm({ ...form, patient_id: e.target.value })}
                    className="w-full h-11 rounded-xl border border-border bg-card px-3 text-sm">
                    <option value="">Selecione...</option>
                    {patients.map((p) => <option key={p.patient_id} value={p.patient_id}>{p.name}</option>)}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">Procedimento *</Label>
                  <Input required value={form.procedure} onChange={(e) => setForm({ ...form, procedure: e.target.value })} className="h-11 rounded-xl" data-testid="rec-procedure" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">Profissional</Label>
                  <Input value={form.professional_name} onChange={(e) => setForm({ ...form, professional_name: e.target.value })} className="h-11 rounded-xl" data-testid="rec-professional" />
                </div>
                <div className="col-span-2 space-y-1.5">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">Evolução clínica *</Label>
                  <Textarea required rows={4} value={form.evolution} onChange={(e) => setForm({ ...form, evolution: e.target.value })} className="rounded-xl" data-testid="rec-evolution" />
                </div>
                <div className="col-span-2 space-y-1.5">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">Protocolo</Label>
                  <Textarea rows={2} value={form.protocols} onChange={(e) => setForm({ ...form, protocols: e.target.value })} className="rounded-xl" data-testid="rec-protocols" />
                </div>
                <div className="col-span-2 space-y-1.5">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">Fotos ANTES (URLs separadas por vírgula)</Label>
                  <Input value={form.photos_before} onChange={(e) => setForm({ ...form, photos_before: e.target.value })} className="h-11 rounded-xl" data-testid="rec-before" />
                </div>
                <div className="col-span-2 space-y-1.5">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">Fotos DEPOIS (URLs separadas por vírgula)</Label>
                  <Input value={form.photos_after} onChange={(e) => setForm({ ...form, photos_after: e.target.value })} className="h-11 rounded-xl" data-testid="rec-after" />
                </div>
                <label className="col-span-2 flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={form.signed} onChange={(e) => setForm({ ...form, signed: e.target.checked })} data-testid="rec-signed" />
                  Documento assinado digitalmente (ICP Brasil)
                </label>
                <DialogFooter className="col-span-2">
                  <Button type="submit" disabled={busy} className="rounded-xl bg-primary text-primary-foreground hover:bg-primary/90" data-testid="rec-submit-btn">
                    {busy ? "Salvando..." : "Salvar evolução"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        }
      />

      <div className="p-6 sm:p-8 space-y-5 animate-fade-up">
        {records.length === 0 && (
          <div className="text-center py-16 text-muted-foreground border border-dashed border-border rounded-2xl" data-testid="empty-records">
            Nenhuma evolução cadastrada ainda.
          </div>
        )}
        {records.map((r) => (
          <article key={r.record_id} data-testid={`record-${r.record_id}`} className="rounded-2xl border border-border bg-card p-6">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{format(parseISO(r.created_at), "dd 'de' MMMM, yyyy", { locale: ptBR })}</div>
                <h3 className="font-display text-xl font-semibold tracking-tight mt-1">{r.procedure}</h3>
                <div className="text-sm text-muted-foreground mt-0.5">{r.patient_name} · {r.professional_name}</div>
              </div>
              {r.signed && <Badge className="bg-success/15 text-success border-success/30">Assinado · ICP</Badge>}
            </div>
            <p className="mt-4 text-sm leading-relaxed">{r.evolution}</p>
            {r.protocols && (
              <div className="mt-3 p-3 rounded-xl bg-muted/40 text-xs">
                <span className="text-muted-foreground uppercase tracking-wider text-[10px]">Protocolo:</span> {r.protocols}
              </div>
            )}
            {(r.photos_before?.length || r.photos_after?.length) ? (
              <div className="mt-5">
                <div className="flex items-center gap-2 text-xs text-muted-foreground mb-3">
                  <ArrowLeftRight className="h-3.5 w-3.5" /> Comparação antes e depois
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">Antes</div>
                    <div className="grid grid-cols-2 gap-2">
                      {(r.photos_before || []).map((src, i) => (
                        <img key={i} src={src} alt="" className="w-full h-32 object-cover rounded-lg border border-border" />
                      ))}
                      {(r.photos_before || []).length === 0 && (
                        <div className="col-span-2 h-32 bg-muted/40 rounded-lg flex items-center justify-center text-muted-foreground">
                          <ImageIcon className="h-5 w-5" />
                        </div>
                      )}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-primary mb-1.5">Depois</div>
                    <div className="grid grid-cols-2 gap-2">
                      {(r.photos_after || []).map((src, i) => (
                        <img key={i} src={src} alt="" className="w-full h-32 object-cover rounded-lg border border-primary/40" />
                      ))}
                      {(r.photos_after || []).length === 0 && (
                        <div className="col-span-2 h-32 bg-primary/5 rounded-lg flex items-center justify-center text-muted-foreground">
                          <ImageIcon className="h-5 w-5" />
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
          </article>
        ))}
      </div>
    </div>
  );
}
