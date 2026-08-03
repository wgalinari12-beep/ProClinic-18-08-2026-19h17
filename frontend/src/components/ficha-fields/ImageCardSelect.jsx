import React, { useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { ZoomIn, ImageOff } from "lucide-react";

/**
 * ImageCardSelect — premium selector featuring illustrations/images.
 * Reusable for Norwood-Hamilton, Savin, Alopecia Areata, Scars, Discromias, Estrias, Cabelo, etc.
 *
 * Props:
 *  - value / onChange / multi
 *  - options: [{ value, label, description?, image?, icon?, subtitle?, badge? }]
 *  - columns? number
 *  - allowZoom? boolean (default true)
 *  - testid? string
 */
export default function ImageCardSelect({
  value, onChange, options = [], multi = false,
  columns, allowZoom = true, testid = "image-card-select",
}) {
  const [zoomSrc, setZoomSrc] = useState(null);

  const isSelected = (v) =>
    multi ? Array.isArray(value) && value.includes(v) : value === v;

  const toggle = (v) => {
    if (multi) {
      const arr = Array.isArray(value) ? value : [];
      onChange(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
    } else {
      onChange(value === v ? "" : v);
    }
  };

  const colCls =
    columns === 2 ? "grid-cols-2"
    : columns === 3 ? "grid-cols-2 md:grid-cols-3"
    : columns === 4 ? "grid-cols-2 md:grid-cols-4"
    : "grid-cols-2 md:grid-cols-3 lg:grid-cols-4";

  return (
    <>
      <div className={`grid ${colCls} gap-3`} data-testid={testid}>
        {options.map((opt) => {
          const on = isSelected(opt.value);
          return (
            <div
              key={opt.value}
              className={`group relative overflow-hidden rounded-xl border transition-all duration-200
                ${on
                  ? "border-primary ring-2 ring-primary/40 shadow-md shadow-primary/10"
                  : "border-border hover:border-primary/50 hover:shadow-sm"}
              `}
            >
              <button
                type="button"
                onClick={() => toggle(opt.value)}
                data-testid={`${testid}-${opt.value}`}
                className="block w-full text-left"
              >
                <div className="h-32 w-full bg-muted/40 flex items-center justify-center relative overflow-hidden">
                  {opt.image ? (
                    <img
                      src={opt.image}
                      alt={opt.label}
                      className="h-full w-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                  ) : opt.icon ? (
                    <span className="text-4xl opacity-80">{opt.icon}</span>
                  ) : (
                    <ImageOff className="h-8 w-8 text-muted-foreground/50" />
                  )}
                  {opt.badge && (
                    <span className="absolute top-1.5 left-1.5 text-[10px] font-medium bg-primary text-primary-foreground rounded-full px-2 py-0.5">
                      {opt.badge}
                    </span>
                  )}
                  {on && (
                    <span className="absolute top-1.5 right-1.5 h-5 w-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs">
                      ✓
                    </span>
                  )}
                </div>
                <div className="p-2.5 bg-card">
                  <div className="font-medium text-sm tracking-tight">{opt.label}</div>
                  {opt.subtitle && (
                    <div className="text-[11px] text-muted-foreground mt-0.5">{opt.subtitle}</div>
                  )}
                  {opt.description && (
                    <div className="text-[11px] text-muted-foreground/80 mt-1 line-clamp-2">
                      {opt.description}
                    </div>
                  )}
                </div>
              </button>
              {allowZoom && opt.image && (
                <button
                  type="button"
                  aria-label="Ampliar"
                  onClick={(e) => { e.stopPropagation(); setZoomSrc(opt.image); }}
                  className="absolute bottom-[92px] right-1.5 h-7 w-7 rounded-full bg-black/50 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  data-testid={`${testid}-${opt.value}-zoom`}
                >
                  <ZoomIn className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          );
        })}
      </div>

      <Dialog open={!!zoomSrc} onOpenChange={(o) => !o && setZoomSrc(null)}>
        <DialogContent className="max-w-3xl p-2 bg-black/95 border-none">
          {zoomSrc && (
            <img src={zoomSrc} alt="Ampliada" className="w-full h-auto rounded-md" />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
