import React, { useEffect, useState } from "react";
import api from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Plus, Pencil, KeyRound, UserMinus, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { formatApiErrorDetail } from "@/lib/api";

const ROLE_LABEL = {
  admin: "Administrador",
  profissional: "Profissional",
  recepcao: "Recepcionista",
  financeiro: "Financeiro",
  marketing: "Marketing",
};
const COLOR_OPTIONS = ["#B76E79", "#7F9CF5", "#10B981", "#F59E0B", "#EC4899", "#6366F1", "#14B8A6", "#A855F7", "#EF4444", "#A0AEC0"];

const EMPTY = {
  name: "", email: "", cpf: "", role: "profissional", phone: "", birth_date: "",
  council: "", council_number: "", specialty: "", subspecialty: "",
  color: "#B76E79", active: true, initial_password: "",
};

export default function Equipe() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [resetPwd, setResetPwd] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (user && user.role !== "admin") navigate("/dashboard", { replace: true });
  }, [user, navigate]);

  const load = async () => {
    try {
      const { data } = await api.get("/users");
      setItems(data);
    } catch { /* ignore */ }
  };
  useEffect(() => { if (user?.role === "admin") load(); }, [user]);

  const onSave = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const payload = { ...form };
      if (editing && !payload.initial_password) delete payload.initial_password;
      if (editing) await api.put(`/users/${editing.user_id}`, payload);
      else await api.post("/users", payload);
      toast.success(editing ? "Atualizado" : "Usuário criado");
      setOpen(false); setEditing(null); setForm(EMPTY);
      await load();
    } catch (err) {
      toast.error(formatApiErrorDetail(err.response?.data?.detail) || err.message);
    } finally { setBusy(false); }
  };

  const onEdit = (u) => {
    setEditing(u);
    setForm({ ...EMPTY, ...u, initial_password: "" });
    setOpen(true);
  };

  const onDeactivate = async (u) => {
    if (!window.confirm(`Desativar ${u.name}?`)) return;
    try {
      await api.delete(`/users/${u.user_id}`);
      toast.success("Desativado");
      load();
    } catch { toast.error("Erro"); }
  };

  const onReset = (u) => {
    setEditing(u);
    setResetPwd("");
    setResetOpen(true);
  };

  const submitReset = async () => {
    if (resetPwd.length < 6) { toast.error("Senha mínimo 6"); return; }
    try {
      await api.post(`/users/${editing.user_id}/reset-password`, { new_password: resetPwd });
      toast.success("Senha redefinida");
      setResetOpen(false);
    } catch { toast.error("Erro"); }
  };

  if (!user || user.role !== "admin") return null;

  return (
    <div data-testid="team-page">
      <PageHeader
        title="Equipe"
        subtitle={`${items.length} usuários cadastrados`}
        actions={
          <Button
            data-testid="new-user-btn"
            onClick={() => { setEditing(null); setForm(EMPTY); setOpen(true); }}
            className="rounded-xl bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="h-4 w-4 mr-1.5" /> Novo usuário
          </Button>
        }
      />
      <div className="p-6 sm:p-8 animate-fade-up">
        <div className="rounded-2xl border border-border bg-card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/30 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              <tr>
                <th className="px-5 py-3 text-left">Nome</th>
                <th className="px-5 py-3 text-left">Perfil</th>
                <th className="px-5 py-3 text-left">CPF</th>
                <th className="px-5 py-3 text-left">Cor</th>
                <th className="px-5 py-3 text-left">Status</th>
                <th className="px-5 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {items.map((u) => (
                <tr key={u.user_id} data-testid={`user-row-${u.user_id}`} className="hover:bg-muted/20">
                  <td className="px-5 py-3">
                    <div className="font-medium">{u.name}</div>
                    <div className="text-xs text-muted-foreground">{u.email}</div>
                  </td>
                  <td className="px-5 py-3 text-xs">{ROLE_LABEL[u.role] || u.role}</td>
                  <td className="px-5 py-3 font-mono text-xs">{u.cpf || "—"}</td>
                  <td className="px-5 py-3"><div className="h-5 w-5 rounded-full ring-1 ring-border" style={{ backgroundColor: u.color || "#B76E79" }} /></td>
                  <td className="px-5 py-3">
                    {u.active === false
                      ? <Badge variant="outline" className="text-[10px]">Inativo</Badge>
                      : <Badge className="bg-success/15 text-success border-success/30 text-[10px]">Ativo</Badge>}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <Button size="icon" variant="ghost" className="h-8 w-8 rounded-lg" onClick={() => onEdit(u)} data-testid={`edit-user-${u.user_id}`}><Pencil className="h-3.5 w-3.5" /></Button>
                    <Button size="icon" variant="ghost" className="h-8 w-8 rounded-lg" onClick={() => onReset(u)} data-testid={`reset-user-${u.user_id}`}><KeyRound className="h-3.5 w-3.5" /></Button>
                    <Button size="icon" variant="ghost" className="h-8 w-8 rounded-lg text-destructive" onClick={() => onDeactivate(u)} data-testid={`deact-user-${u.user_id}`}><UserMinus className="h-3.5 w-3.5" /></Button>
                  </td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr><td colSpan={6} className="py-12 text-center text-muted-foreground text-sm">Nenhum usuário cadastrado.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Form */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="rounded-2xl max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl tracking-tight">{editing ? "Editar usuário" : "Novo usuário"}</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Profissional faz login por email ou CPF. {!editing && "A senha inicial será trocada no primeiro acesso."}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={onSave} className="grid grid-cols-2 gap-4" data-testid="user-form">
            <div className="col-span-2 space-y-1.5">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Nome completo *</Label>
              <Input required data-testid="user-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="h-11 rounded-xl" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Email *</Label>
              <Input required type="email" data-testid="user-email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="h-11 rounded-xl" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">CPF</Label>
              <Input data-testid="user-cpf" value={form.cpf} onChange={(e) => setForm({ ...form, cpf: e.target.value })} className="h-11 rounded-xl" placeholder="000.000.000-00" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Perfil *</Label>
              <select data-testid="user-role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}
                className="w-full h-11 rounded-xl border border-border bg-card px-3 text-sm">
                <option value="profissional">Profissional</option>
                <option value="recepcao">Recepcionista</option>
                <option value="financeiro">Financeiro</option>
                <option value="marketing">Marketing</option>
                <option value="admin">Administrador</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Telefone</Label>
              <Input data-testid="user-phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="h-11 rounded-xl" />
            </div>
            {form.role === "profissional" && (
              <>
                <div className="space-y-1.5">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">Conselho</Label>
                  <Input data-testid="user-council" value={form.council} onChange={(e) => setForm({ ...form, council: e.target.value })} className="h-11 rounded-xl" placeholder="CRM, CRBM..." />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">Nº Registro</Label>
                  <Input data-testid="user-council-number" value={form.council_number} onChange={(e) => setForm({ ...form, council_number: e.target.value })} className="h-11 rounded-xl" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">Especialidade</Label>
                  <Input data-testid="user-specialty" value={form.specialty} onChange={(e) => setForm({ ...form, specialty: e.target.value })} className="h-11 rounded-xl" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">Subespecialidade</Label>
                  <Input data-testid="user-subspecialty" value={form.subspecialty} onChange={(e) => setForm({ ...form, subspecialty: e.target.value })} className="h-11 rounded-xl" />
                </div>
              </>
            )}
            <div className="col-span-2 space-y-1.5">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Cor na agenda</Label>
              <div className="flex flex-wrap gap-2">
                {COLOR_OPTIONS.map((c) => (
                  <button key={c} type="button" onClick={() => setForm({ ...form, color: c })}
                    data-testid={`user-color-${c.replace('#', '')}`}
                    className={`h-9 w-9 rounded-full ring-2 transition-all ${form.color === c ? "ring-foreground" : "ring-transparent"}`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                {editing ? "Nova senha (deixe vazio para manter)" : "Senha inicial *"}
              </Label>
              <Input type="password" data-testid="user-pwd" value={form.initial_password}
                onChange={(e) => setForm({ ...form, initial_password: e.target.value })}
                className="h-11 rounded-xl" placeholder="Mínimo 6 caracteres" minLength={editing ? 0 : 6} required={!editing} />
            </div>
            <label className="col-span-2 flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} data-testid="user-active" />
              Ativo
            </label>
            <DialogFooter className="col-span-2">
              <Button type="submit" disabled={busy} className="rounded-xl bg-primary text-primary-foreground hover:bg-primary/90" data-testid="user-save-btn">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Salvar"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Reset password dialog */}
      <Dialog open={resetOpen} onOpenChange={setResetOpen}>
        <DialogContent className="rounded-2xl max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-display text-xl tracking-tight">Redefinir senha</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">{editing?.name}</DialogDescription>
          </DialogHeader>
          <Input type="password" placeholder="Nova senha" value={resetPwd} onChange={(e) => setResetPwd(e.target.value)} className="h-11 rounded-xl" data-testid="reset-pwd-input" />
          <DialogFooter>
            <Button onClick={submitReset} className="rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 w-full" data-testid="reset-pwd-submit">
              Redefinir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
