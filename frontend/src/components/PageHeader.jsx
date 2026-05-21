import React from "react";

export default function PageHeader({ title, subtitle, actions, testid }) {
  return (
    <header
      data-testid={testid || "page-header"}
      className="sticky top-0 z-20 glass border-b border-border/70 px-8 py-5"
    >
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight truncate">
            {title}
          </h1>
          {subtitle && (
            <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>
          )}
        </div>
        {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
      </div>
    </header>
  );
}
