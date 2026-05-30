import React, { useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import {
  LayoutDashboard, Users, Calendar, FileText, ClipboardList,
  Wallet, Sparkles, Settings, LogOut, Sun, Moon, ChevronsLeft,
  Stethoscope, ChevronsRight, MessageSquare, Briefcase, Building2,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/dashboard", icon: LayoutDashboard, label: "Painel" },
  { to: "/pacientes", icon: Users, label: "Pacientes" },
  { to: "/agenda", icon: Calendar, label: "Agenda" },
  { to: "/prontuario", icon: FileText, label: "Prontuário" },
  { to: "/anamnese", icon: ClipboardList, label: "Anamnese" },
  { to: "/procedimentos", icon: Briefcase, label: "Procedimentos" },
  { to: "/financeiro", icon: Wallet, label: "Financeiro" },
  { to: "/mensagens", icon: MessageSquare, label: "Mensagens" },
  { to: "/assistente-ia", icon: Sparkles, label: "Assistente IA" },
  { to: "/minha-clinica", icon: Building2, label: "Minha Clínica" },
];

export default function Sidebar({ collapsed, onToggle }) {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();

  return (
    <aside
      data-testid="app-sidebar"
      className={cn(
        "h-screen sticky top-0 border-r border-border bg-card/40 flex flex-col transition-[width] duration-300 ease-out",
        collapsed ? "w-[72px]" : "w-[248px]"
      )}
    >
      {/* Brand */}
      <div className="h-16 px-4 flex items-center gap-3 border-b border-border/70">
        <div className="h-9 w-9 rounded-xl bg-primary/10 ring-1 ring-primary/30 flex items-center justify-center">
          <Stethoscope className="h-4.5 w-4.5 text-primary" strokeWidth={1.5} />
        </div>
        {!collapsed && (
          <div className="flex flex-col leading-tight">
            <span className="font-display text-[17px] font-semibold tracking-tight">ProClinic</span>
            <span className="text-[11px] text-muted-foreground -mt-0.5">Luxury Edition</span>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            data-testid={`nav-${item.label.toLowerCase().replace(/\s/g, "-")}`}
            className={({ isActive }) =>
              cn(
                "group flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                isActive
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
              )
            }
          >
            <item.icon className="h-4 w-4 shrink-0" strokeWidth={1.5} />
            {!collapsed && <span className="truncate">{item.label}</span>}
          </NavLink>
        ))}
      </nav>

      {/* Footer */}
      <div className="border-t border-border/70 p-3 space-y-1">
        <button
          data-testid="theme-toggle-btn"
          onClick={toggleTheme}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
        >
          {theme === "dark" ? <Sun className="h-4 w-4" strokeWidth={1.5} /> : <Moon className="h-4 w-4" strokeWidth={1.5} />}
          {!collapsed && <span>{theme === "dark" ? "Tema claro" : "Tema escuro"}</span>}
        </button>
        <NavLink
          to="/configuracoes"
          data-testid="nav-configuracoes"
          className={({ isActive }) =>
            cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
              isActive ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
            )
          }
        >
          <Settings className="h-4 w-4" strokeWidth={1.5} />
          {!collapsed && <span>Configurações</span>}
        </NavLink>
        <button
          data-testid="logout-btn"
          onClick={async () => { await logout(); navigate("/login"); }}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
        >
          <LogOut className="h-4 w-4" strokeWidth={1.5} />
          {!collapsed && <span>Sair</span>}
        </button>

        {!collapsed && user && (
          <div className="mt-3 flex items-center gap-3 px-3 py-2 rounded-lg bg-muted/40">
            <div className="h-8 w-8 rounded-full bg-primary/15 flex items-center justify-center ring-1 ring-primary/30">
              {user.picture ? (
                <img src={user.picture} alt="" className="h-8 w-8 rounded-full object-cover" />
              ) : (
                <span className="text-xs font-semibold text-primary">
                  {user.name?.[0]?.toUpperCase()}
                </span>
              )}
            </div>
            <div className="min-w-0 leading-tight">
              <div className="text-xs font-semibold truncate" data-testid="sidebar-user-name">{user.name}</div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{user.role}</div>
            </div>
          </div>
        )}

        <button
          data-testid="sidebar-collapse-btn"
          onClick={onToggle}
          className="mt-3 w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          {collapsed ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
        </button>
      </div>
    </aside>
  );
}
