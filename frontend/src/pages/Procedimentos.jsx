import React, { useEffect, useState } from "react";
import api from "@/lib/api";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Plus, Pencil, Trash2, Clock, Tag } from "lucide-react";
import { toast } from "sonner";
import { formatApiErrorDetail } from "@/lib/api";

const EMPTY = { name: "", description: "", price: 0, duration_minutes: 60, category: "Facial", active: true };

export default function Procedimentos() {
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const { data } = await api.get("/procedures");
    setItems(data);
  };
  useEffect(() => { load(); }, []);

  const onSave = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const payload = { ...form, price: Number(form.price), duration_minutes: Number(form.duration_minutes) };
      if (editing) await api.put(`/procedures/${editing.procedure_id}`, payload);
      else await api.post("/procedures", payload);
      toast.success(editing ? "Atualizado" : "Procedimento criado");
      setOpen(false); setEditing(null); setForm(EMPTY);
      await load();
    } catch (err) {
      toast.error(formatApiErrorDetail(err.response?.data?.detail) || err.message);
    } finally { setBusy(false); }
  };

  const onEdit = (p) => {
    setEditing(p);
    setForm({ ...EMPTY, ...p });
    setOpen(true);
  };

  const onDelete = async (p) => {
    if (!window.confirm(`Excluir "${p.name}"?`)) return;
    await api.delete(`/procedures/${p.procedure_id}`);
    toast.success("Excluído");
    load();
  };

  const brl = (n) => (n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  return (
    <div data-testid="procedures-page">
      <PageHeader
        title="Procedimentos"
        subtitle={`${items.length} cadastrados`}
        actions={
          <Button data-testid="new-proc-btn"
            onClick={() => { setEditing(null); setForm(EMPTY); setOpen(true); }}
            className="rounded-xl bg-primary text-primary-foreground hover:bg-primary/90">
            <Plus className="h-4 w-4 mr-1.5" /> Novo procedimento
          </Button>
        }
      />

      <div className="p-6 sm:p-8 animate-fade-up">
        {items.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground border border-dashed border-border rounded-2xl" data-testid="empty-procs">
            Nenhum procedimento cadastrado. Cadastre os tratamentos da sua clínica para preenchimento automático na agenda.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {items.map((p) => (
              <div key={p.procedure_id} data-testid={`proc-${p.procedure_id}`} className="rounded-2xl border border-border bg-card p-5 hover:border-primary/40 transition-colors group">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <h3 className="font-display text-lg font-semibold tracking-tight truncate">{p.name}</h3>
                    <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                      {p.category && <span className="flex items-center gap-1"><Tag className="h-3 w-3" /> {p.category}</span>}
                      <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> {p.duration_minutes} min</span>
                    </div>
                  </div>
                  {!p.active && <Badge variant="outline" className="text-[10px]">Inativo</Badge>}
                </div>
                {p.description && <p className="text-xs text-muted-foreground mt-3 line-clamp-2">{p.description}</p>}
                <div className="mt-4 flex items-end justify-between">
                  <div className="font-display text-xl font-semibold text-primary">{brl(p.price)}</div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button size="icon" variant="ghost" className="h-8 w-8 rounded-lg" onClick={() => onEdit(p)} data-testid={`edit-proc-${p.procedure_id}`}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-8 w-8 rounded-lg text-destructive" onClick={() => onDelete(p)} data-testid={`del-proc-${p.procedure_id}`}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="rounded-2xl">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl tracking-tight">
              {editing ? "Editar procedimento" : "Novo procedimento"}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">Catálogo da clínica para agendamento.</DialogDescription>
          </DialogHeader>
          <form onSubmit={onSave} className="grid grid-cols-2 gap-4" data-testid="proc-form">
            <div className="col-span-2 space-y-1.5">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Nome *</Label>
              <Input required data-testid="proc-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="h-11 rounded-xl" />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Descrição</Label>
              <Textarea data-testid="proc-desc" rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="rounded-xl" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Valor (R$) *</Label>
              <Input required type="number" step="0.01" data-testid="proc-price" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} className="h-11 rounded-xl" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Duração (min) *</Label>
              <Input required type="number" data-testid="proc-duration" value={form.duration_minutes} onChange={(e) => setForm({ ...form, duration_minutes: e.target.value })} className="h-11 rounded-xl" />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Categoria</Label>
              <select data-testid="proc-category" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}
                className="w-full h-11 rounded-xl border border-border bg-card px-3 text-sm">
                <option>Facial</option><option>Corporal</option><option>Capilar</option><option>Injetáveis</option>
                <option>Laser</option><option>Pacote</option><option>Outros</option>
              </select>
            </div>
            <label className="col-span-2 flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} data-testid="proc-active" />
              Ativo (disponível para agendamento)
            </label>
            <DialogFooter className="col-span-2">
              <Button type="submit" disabled={busy} className="rounded-xl bg-primary text-primary-foreground hover:bg-primary/90" data-testid="proc-save-btn">
                {busy ? "Salvando..." : "Salvar"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
