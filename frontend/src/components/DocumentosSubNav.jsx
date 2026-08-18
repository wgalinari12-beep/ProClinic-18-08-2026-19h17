import React from "react";
import { NavLink } from "react-router-dom";
import { FileSignature, FolderTree, Braces, Settings2 } from "lucide-react";

const ITEMS = [
  { to: "/documentos", label: "Documentos", icon: FileSignature, end: true },
  { to: "/documentos/categorias", label: "Categorias", icon: FolderTree },
  { to: "/documentos/variaveis", label: "Variáveis", icon: Braces },
  { to: "/documentos/configuracoes", label: "Configurações", icon: Settings2 },
];

export default function DocumentosSubNav() {
  return (
    <div className="flex flex-wrap gap-1.5 px-6 sm:px-8 pt-5" data-testid="documentos-subnav">
      {ITEMS.map((it) => (
        <NavLink
          key={it.to}
          to={it.to}
          end={it.end}
          className={({ isActive }) =>
            `inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-medium transition-colors border ${
              isActive
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-card text-muted-foreground border-border hover:text-foreground hover:border-primary/40"
            }`
          }
        >
          <it.icon className="h-4 w-4" strokeWidth={1.7} /> {it.label}
        </NavLink>
      ))}
    </div>
  );
}
