import React from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Sun, Moon, Mail, ShieldCheck, Building2 } from "lucide-react";

export default function Configuracoes() {
  const { user } = useAuth();
  const { theme, toggleTheme } = useTheme();

  return (
    <div data-testid="settings-page">
      <PageHeader title="Configurações" subtitle="Preferências e perfil da clínica" />
      <div className="p-6 sm:p-8 max-w-3xl mx-auto space-y-6 animate-fade-up">
        {/* Profile */}
        <section className="rounded-2xl border border-border bg-card p-6">
          <h3 className="font-display text-lg font-semibold tracking-tight mb-4">Seu perfil</h3>
          <div className="flex items-center gap-4">
            <div className="h-14 w-14 rounded-full bg-primary/10 ring-1 ring-primary/30 flex items-center justify-center">
              {user?.picture ? <img src={user.picture} alt="" className="h-14 w-14 rounded-full object-cover" /> :
                <span className="font-display text-xl font-semibold text-primary">{user?.name?.[0]?.toUpperCase()}</span>}
            </div>
            <div>
              <div className="font-display text-lg font-semibold tracking-tight" data-testid="profile-name">{user?.name}</div>
              <div className="text-sm text-muted-foreground flex items-center gap-2">
                <Mail className="h-3.5 w-3.5" /> {user?.email}
              </div>
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground mt-1 flex items-center gap-2">
                <ShieldCheck className="h-3.5 w-3.5" /> Perfil: {user?.role}
              </div>
            </div>
          </div>
        </section>

        {/* Theme */}
        <section className="rounded-2xl border border-border bg-card p-6">
          <h3 className="font-display text-lg font-semibold tracking-tight mb-1">Aparência</h3>
          <p className="text-sm text-muted-foreground mb-4">Alterne entre tema claro e escuro premium.</p>
          <div className="flex items-center gap-3">
            <Button onClick={toggleTheme} variant="outline" className="rounded-xl" data-testid="settings-theme-toggle">
              {theme === "dark" ? <Sun className="h-4 w-4 mr-2" /> : <Moon className="h-4 w-4 mr-2" />}
              Alterar para tema {theme === "dark" ? "claro" : "escuro"}
            </Button>
            <span className="text-xs text-muted-foreground uppercase tracking-wider">Atual: {theme}</span>
          </div>
        </section>

        {/* Clinic */}
        <section className="rounded-2xl border border-border bg-card p-6">
          <h3 className="font-display text-lg font-semibold tracking-tight mb-3">Clínica</h3>
          <div className="flex items-center gap-3 text-sm">
            <Building2 className="h-4 w-4 text-muted-foreground" />
            <span className="font-mono text-xs text-muted-foreground" data-testid="clinic-id">{user?.clinic_id}</span>
          </div>
        </section>
      </div>
    </div>
  );
}
