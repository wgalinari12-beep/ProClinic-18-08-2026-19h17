import React, { useState, useEffect } from "react";
import { Outlet } from "react-router-dom";
import Sidebar from "@/components/Sidebar";
import TrialBanner from "@/components/TrialBanner";

export default function Layout() {
  const [collapsed, setCollapsed] = useState(
    () => typeof window !== "undefined" && window.innerWidth < 1280
  );

  // ⭐ Lote 4 / Fase A (R4/R7): auto-recolhe o sidebar em telas estreitas.
  // Só recolhe automaticamente (nunca força expandir), preservando o toggle manual.
  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth < 1280) setCollapsed(true);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return (
    <div className="min-h-screen w-full flex bg-background text-foreground">
      <Sidebar collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)} />
      <main className="flex-1 min-w-0 flex flex-col">
        <TrialBanner />
        <div className="flex-1 min-w-0">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
