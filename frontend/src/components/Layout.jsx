import React, { useState, useEffect } from "react";
import { Outlet } from "react-router-dom";
import { Menu, Stethoscope } from "lucide-react";
import Sidebar from "@/components/Sidebar";
import TrialBanner from "@/components/TrialBanner";
import { useClinicBrand } from "@/contexts/ClinicBrandContext";
import { resolveFileUrl } from "@/lib/api";

export default function Layout() {
  const { logoUrl } = useClinicBrand();
  const [collapsed, setCollapsed] = useState(
    () => typeof window !== "undefined" && window.innerWidth < 1280
  );
  // ⭐ Lote 4 / Fase B (B2): drawer mobile do sidebar (< 1024px)
  const [mobileOpen, setMobileOpen] = useState(false);

  // ⭐ Lote 4 / Fase A (R4/R7): auto-recolhe o sidebar em telas estreitas.
  // Só recolhe automaticamente (nunca força expandir), preservando o toggle manual.
  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth < 1280) setCollapsed(true);
      if (window.innerWidth >= 1024) setMobileOpen(false);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return (
    <div className="min-h-screen w-full flex bg-background text-foreground">
      {/* Sidebar desktop (>= lg) */}
      <div className="hidden lg:block">
        <Sidebar collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)} />
      </div>

      {/* Sidebar drawer mobile (< lg) */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" data-testid="mobile-sidebar-overlay">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
          />
          <div
            className="absolute left-0 top-0 h-full shadow-2xl animate-in slide-in-from-left duration-200"
            onClick={(e) => { if (e.target.closest("a")) setMobileOpen(false); }}
          >
            <Sidebar collapsed={false} onToggle={() => setMobileOpen(false)} />
          </div>
        </div>
      )}

      <main className="flex-1 min-w-0 flex flex-col">
        {/* Top bar mobile com hambúrguer */}
        <div className="lg:hidden h-14 border-b border-border bg-card/60 backdrop-blur flex items-center gap-3 px-4 sticky top-0 z-30">
          <button
            onClick={() => setMobileOpen(true)}
            className="h-9 w-9 rounded-lg flex items-center justify-center hover:bg-muted/60 transition-colors"
            data-testid="mobile-menu-btn"
            aria-label="Abrir menu"
          >
            <Menu className="h-5 w-5" strokeWidth={1.5} />
          </button>
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-lg bg-primary/10 ring-1 ring-primary/30 flex items-center justify-center overflow-hidden">
              {logoUrl ? (
                <img src={resolveFileUrl(logoUrl)} alt="Logo" className="h-full w-full object-contain" />
              ) : (
                <Stethoscope className="h-4 w-4 text-primary" strokeWidth={1.5} />
              )}
            </div>
            <span className="font-display text-[15px] font-semibold tracking-tight">ProClinic</span>
          </div>
        </div>

        <TrialBanner />
        <div className="flex-1 min-w-0">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
