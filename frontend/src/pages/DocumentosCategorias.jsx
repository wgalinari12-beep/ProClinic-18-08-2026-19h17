import React, { useEffect, useState } from "react";
import api from "@/lib/api";
import PageHeader from "@/components/PageHeader";
import DocumentosSubNav from "@/components/DocumentosSubNav";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Plus, Loader2, Pencil, Trash2, GripVertical, ShieldAlert } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
} from "@dnd-kit/core";
import {
  arrayMove, SortableContext, verticalListSortingStrategy, useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

function SortableRow({ cat, canEdit, onEdit, onToggle, onDelete }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: cat.category_id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1 };
  return (
    <div ref={setNodeRef} style={style}
      className="flex items-center gap-3 px-4 py-3 bg-card" data-testid={`cat-row-${cat.category_id}`}>
      {canEdit && (
        <button {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing text-muted-foreground" data-testid={`cat-drag-${cat.category_id}`}>
          <GripVertical className="h-4 w-4" />
        </button>
      )}
      <span className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: cat.color || "#d6c9bf" }} />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium truncate">{cat.name}</div>
        {cat.description && <div className="text-[11px] text-muted-foreground truncate">{cat.description}</div>}
      </div>
      {!cat.active && <span className="text-[10px] uppercase tracking-wide text-muted-foreground bg-muted rounded px-2 py-0.5">Inativa</span>}
      {canEdit && (
        <div className="flex items-center gap-1">
          <Switch checked={cat.active} onCheckedChange={() => onToggle(cat)} data-testid={`cat-toggle-${cat.category_id}`} />
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onEdit(cat)} data-testid={`cat-edit-${cat.category_id}`}>
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => onDelete(cat)} data-testid={`cat-delete-${cat.category_id}`}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}
    </div>
  );
}

export default function DocumentosCategorias() {
  const { user } = useAuth();
  const canEdit = user?.role === "admin";
  const [cats, setCats] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: "", description: "", color: "#B76E79", active: true });
  const [busy, setBusy] = useState(false);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/document-categories");
      setCats(data || []);
    } catch { toast.error("Erro ao carregar categorias"); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const openNew = () => { setEditing(null); setForm({ name: "", description: "", color: "#B76E79", active: true }); setDialogOpen(true); };
  const openEdit = (c) => { setEditing(c); setForm({ name: c.name, description: c.description || "", color: c.color || "#B76E79", active: c.active }); setDialogOpen(true); };

  const save = async () => {
    if (!form.name.trim()) { toast.error("Nome é obrigatório"); return; }
    setBusy(true);
    const payload = {
      name: form.name.trim(),
      description: form.description?.trim() || null,
      color: form.color || null,
      order: editing ? editing.order : cats.length,
      active: form.active,
    };
    try {
      if (editing) await api.put(`/document-categories/${editing.category_id}`, payload);
      else await api.post("/document-categories", payload);
      toast.success("Categoria salva");
      setDialogOpen(false);
      load();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Erro ao salvar categoria");
    } finally { setBusy(false); }
  };

  const toggle = async (c) => {
    try {
      await api.put(`/document-categories/${c.category_id}`, {
        name: c.name, description: c.description || null, color: c.color || null,
        order: c.order, active: !c.active,
      });
      setCats((prev) => prev.map((x) => x.category_id === c.category_id ? { ...x, active: !x.active } : x));
    } catch { toast.error("Erro ao atualizar"); }
  };

  const remove = async (c) => {
    if (!window.confirm(`Excluir a categoria "${c.name}"?`)) return;
    try {
      await api.delete(`/document-categories/${c.category_id}`);
      toast.success("Categoria excluída");
      setCats((prev) => prev.filter((x) => x.category_id !== c.category_id));
    } catch (e) {
      toast.error(e.response?.data?.detail || "Erro ao excluir");
    }
  };

  const onDragEnd = async (event) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = cats.findIndex((c) => c.category_id === active.id);
    const newIndex = cats.findIndex((c) => c.category_id === over.id);
    const reordered = arrayMove(cats, oldIndex, newIndex);
    setCats(reordered);
    try {
      await Promise.all(reordered.map((c, i) =>
        c.order === i ? null : api.put(`/document-categories/${c.category_id}`, {
          name: c.name, description: c.description || null, color: c.color || null,
          order: i, active: c.active,
        })
      ));
    } catch { toast.error("Erro ao reordenar"); load(); }
  };

  return (
    <div data-testid="documentos-categorias-page">
      <PageHeader title="Categorias" subtitle="Organize seus modelos e documentos por categoria"
        actions={canEdit && (
          <Button onClick={openNew} className="rounded-xl bg-primary text-primary-foreground" data-testid="cat-new-btn">
            <Plus className="h-4 w-4 mr-1.5" /> Nova categoria
          </Button>
        )} />
      <DocumentosSubNav />
      <div className="p-6 sm:p-8 animate-fade-up">
        {!canEdit && (
          <div className="mb-4 flex items-center gap-2 text-xs text-muted-foreground rounded-xl border border-border bg-muted/30 px-4 py-3">
            <ShieldAlert className="h-4 w-4" /> Somente administradores podem editar categorias. Visualização em modo leitura.
          </div>
        )}
        {loading ? (
          <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
        ) : cats.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border p-10 text-center text-muted-foreground">Nenhuma categoria.</div>
        ) : (
          <div className="rounded-2xl border border-border overflow-hidden divide-y divide-border" data-testid="cat-list">
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
              <SortableContext items={cats.map((c) => c.category_id)} strategy={verticalListSortingStrategy}>
                {cats.map((c) => (
                  <SortableRow key={c.category_id} cat={c} canEdit={canEdit}
                    onEdit={openEdit} onToggle={toggle} onDelete={remove} />
                ))}
              </SortableContext>
            </DndContext>
          </div>
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="rounded-2xl" data-testid="cat-dialog">
          <DialogHeader><DialogTitle className="font-display">{editing ? "Editar categoria" : "Nova categoria"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Nome</Label>
              <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Ex.: Consentimentos" className="h-11 rounded-xl" data-testid="cat-name" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Descrição (opcional)</Label>
              <Input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                className="h-11 rounded-xl" data-testid="cat-desc" />
            </div>
            <div className="flex items-center gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Cor</Label>
                <input type="color" value={form.color} onChange={(e) => setForm((f) => ({ ...f, color: e.target.value }))}
                  className="h-11 w-16 rounded-xl border border-border bg-card cursor-pointer" data-testid="cat-color" />
              </div>
              <div className="flex items-center gap-2 pt-6">
                <Switch checked={form.active} onCheckedChange={(v) => setForm((f) => ({ ...f, active: v }))} data-testid="cat-active" />
                <Label className="text-sm">Ativa</Label>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} className="rounded-xl">Cancelar</Button>
            <Button onClick={save} disabled={busy} className="rounded-xl bg-primary text-primary-foreground" data-testid="cat-save">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
