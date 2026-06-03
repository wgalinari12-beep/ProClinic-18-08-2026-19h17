import React, { useEffect, useState, useRef } from "react";
import { X, ZoomIn, ZoomOut, Maximize2, Download } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Lightbox — premium image viewer.
 *  - zoom in/out (1x..5x)
 *  - drag when zoomed
 *  - ESC closes
 *  - click outside closes
 *  - arrow keys to navigate when multiple images
 *  - metadata footer (uploaded_at, by)
 *
 * Props:
 *  images: [{ url, uploaded_at?, uploaded_by_name?, label? }]
 *  startIndex: number
 *  open, onOpenChange
 */
export default function Lightbox({ images = [], startIndex = 0, open, onOpenChange }) {
  const [idx, setIdx] = useState(startIndex);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [drag, setDrag] = useState(null);
  const imgRef = useRef(null);

  useEffect(() => {
    if (open) {
      setIdx(startIndex);
      setZoom(1);
      setPan({ x: 0, y: 0 });
    }
  }, [open, startIndex]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") onOpenChange(false);
      else if (e.key === "ArrowLeft") setIdx((i) => Math.max(0, i - 1));
      else if (e.key === "ArrowRight") setIdx((i) => Math.min(images.length - 1, i + 1));
      else if (e.key === "+" || e.key === "=") setZoom((z) => Math.min(5, z + 0.5));
      else if (e.key === "-") setZoom((z) => Math.max(1, z - 0.5));
      else if (e.key === "0") { setZoom(1); setPan({ x: 0, y: 0 }); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, images.length, onOpenChange]);

  // Reset pan when image changes
  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [idx]);

  if (!open) return null;
  const current = images[idx];
  if (!current) return null;

  const onMouseDown = (e) => {
    if (zoom <= 1) return;
    setDrag({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  };
  const onMouseMove = (e) => {
    if (!drag) return;
    setPan({ x: e.clientX - drag.x, y: e.clientY - drag.y });
  };
  const onMouseUp = () => setDrag(null);

  return (
    <div
      data-testid="lightbox"
      className="fixed inset-0 z-[200] bg-black/90 backdrop-blur-sm flex flex-col"
      onClick={(e) => { if (e.target === e.currentTarget) onOpenChange(false); }}
    >
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-3 text-white">
        <div className="text-xs uppercase tracking-[0.18em] opacity-70">
          {idx + 1} / {images.length}
        </div>
        <div className="flex items-center gap-2">
          <Button data-testid="lb-zoom-out" variant="ghost" size="icon" className="text-white hover:bg-white/10 rounded-lg" onClick={() => setZoom((z) => Math.max(1, z - 0.5))}>
            <ZoomOut className="h-4 w-4" />
          </Button>
          <span className="text-xs font-mono w-12 text-center">{Math.round(zoom * 100)}%</span>
          <Button data-testid="lb-zoom-in" variant="ghost" size="icon" className="text-white hover:bg-white/10 rounded-lg" onClick={() => setZoom((z) => Math.min(5, z + 0.5))}>
            <ZoomIn className="h-4 w-4" />
          </Button>
          <Button data-testid="lb-fit" variant="ghost" size="icon" className="text-white hover:bg-white/10 rounded-lg" onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}>
            <Maximize2 className="h-4 w-4" />
          </Button>
          <a href={current.url} target="_blank" rel="noopener noreferrer" data-testid="lb-download"
            className="p-2 text-white hover:bg-white/10 rounded-lg">
            <Download className="h-4 w-4" />
          </a>
          <Button data-testid="lb-close" variant="ghost" size="icon" className="text-white hover:bg-white/10 rounded-lg" onClick={() => onOpenChange(false)}>
            <X className="h-5 w-5" />
          </Button>
        </div>
      </div>

      {/* Image */}
      <div
        className="flex-1 overflow-hidden flex items-center justify-center relative select-none"
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
        style={{ cursor: zoom > 1 ? (drag ? "grabbing" : "grab") : "default" }}
      >
        <img
          ref={imgRef}
          src={current.url}
          alt={current.label || ""}
          draggable={false}
          className="max-h-[85vh] max-w-[90vw] object-contain transition-transform duration-150"
          style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
          data-testid="lb-image"
        />

        {idx > 0 && (
          <button
            onClick={(e) => { e.stopPropagation(); setIdx(idx - 1); }}
            className="absolute left-4 h-10 w-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center"
            data-testid="lb-prev"
          >
            ‹
          </button>
        )}
        {idx < images.length - 1 && (
          <button
            onClick={(e) => { e.stopPropagation(); setIdx(idx + 1); }}
            className="absolute right-4 h-10 w-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center"
            data-testid="lb-next"
          >
            ›
          </button>
        )}
      </div>

      {/* Footer metadata */}
      {(current.uploaded_at || current.uploaded_by_name || current.label) && (
        <div className="px-6 py-3 text-xs text-white/80 flex items-center gap-4">
          {current.label && <span className="font-medium">{current.label}</span>}
          {current.uploaded_at && <span>{new Date(current.uploaded_at).toLocaleString("pt-BR")}</span>}
          {current.uploaded_by_name && <span>· {current.uploaded_by_name}</span>}
        </div>
      )}
    </div>
  );
}
