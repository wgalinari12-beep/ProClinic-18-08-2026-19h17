import React, { useState } from "react";
import { Outlet } from "react-router-dom";
import Sidebar from "@/components/Sidebar";
import TrialBanner from "@/components/TrialBanner";

export default function Layout() {
  const [collapsed, setCollapsed] = useState(false);
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
