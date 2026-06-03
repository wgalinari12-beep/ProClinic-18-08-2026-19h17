import React, { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Lock, Loader2, ShieldCheck } from "lucide-react";
import api from "@/lib/api";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";

export default function ChangePasswordModal() {
  const { user, checkAuth } = useAuth();
  const [open, setOpen] = useState(false);
  const [pwd, setPwd] = useState("");
  const [pwd2, setPwd2] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (user?.password_change_required) setOpen(true);
    else setOpen(false);
  }, [user]);

  const submit = async (e) => {
    e?.preventDefault();
    if (pwd.length < 6) { toast.error("Senha mínimo 6 caracteres"); return; }
    if (pwd !== pwd2) { toast.error("Senhas não coincidem"); return; }
    setBusy(true);
    try {
      await api.post("/auth/change-password", { new_password: pwd });
      toast.success("Senha atualizada");
      await checkAuth();
      setOpen(false);
    } catch (err) {
      toast.error("Erro ao trocar senha");
    } finally { setBusy(false); }
  };

  if (!user?.password_change_required) return null;

  return (
    <Dialog open={open} onOpenChange={() => { /* force */ }}>
      <DialogContent
        data-testid="change-password-modal"
        className="rounded-2xl max-w-md"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <div className="h-12 w-12 rounded-xl bg-primary/10 ring-1 ring-primary/30 flex items-center justify-center mx-auto mb-2">
            <ShieldCheck className="h-5 w-5 text-primary" strokeWidth={1.5} />
          </div>
          <DialogTitle className="font-display text-xl tracking-tight text-center">Primeiro acesso</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground text-center">
            Por segurança, defina sua nova senha antes de continuar.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Nova senha</Label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" strokeWidth={1.5} />
              <Input data-testid="cp-new" type="password" required value={pwd} onChange={(e) => setPwd(e.target.value)} className="pl-9 h-11 rounded-xl" minLength={6} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Confirme a nova senha</Label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" strokeWidth={1.5} />
              <Input data-testid="cp-confirm" type="password" required value={pwd2} onChange={(e) => setPwd2(e.target.value)} className="pl-9 h-11 rounded-xl" minLength={6} />
            </div>
          </div>
          <Button type="submit" disabled={busy} className="w-full h-11 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90" data-testid="cp-submit">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Salvar nova senha"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
