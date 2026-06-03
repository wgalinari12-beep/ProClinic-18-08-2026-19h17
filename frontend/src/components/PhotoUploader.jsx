import React, { useRef, useState } from "react";
import api from "@/lib/api";
import { Upload, X, Loader2 } from "lucide-react";
import { toast } from "sonner";
import Lightbox from "@/components/Lightbox";

/**
 * PhotoUploader v2 — uses signed URLs (no auth dependency).
 * The backend returns `url` already containing `?sig=...`, so we use it directly.
 * Backward-compatible: if url lacks sig, falls back to `?auth=token`.
 *
 * Props:
 *  value: string[]               URLs from backend (typically "/api/files/...?sig=...")
 *  onChange: (urls) => void
 *  label, accent, testid
 */
export default function PhotoUploader({ value = [], onChange, label, accent = "default", testid }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [lb, setLb] = useState({ open: false, index: 0 });

  const uploadFiles = async (files) => {
    if (!files?.length) return;
    setBusy(true);
    try {
      const uploaded = [];
      for (const file of files) {
        const fd = new FormData();
        fd.append("file", file);
        const { data } = await api.post("/uploads", fd, {
          headers: { "Content-Type": "multipart/form-data" },
        });
        uploaded.push(data.url);
      }
      onChange?.([...(value || []), ...uploaded]);
      toast.success(`${uploaded.length} foto(s) enviada(s)`);
    } catch (e) {
      toast.error("Falha no upload");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const removeAt = (i) => {
    const next = [...(value || [])];
    next.splice(i, 1);
    onChange?.(next);
  };

  // Resolve display src: if url starts with /api/files and has no ?sig=, add auth fallback
  const resolveSrc = (url) => {
    if (!url) return "";
    if (url.startsWith("http")) return url;
    // signed URL (preferred) — use as-is
    if (url.includes("?sig=") || url.includes("&sig=")) {
      return `${process.env.REACT_APP_BACKEND_URL}${url}`;
    }
    // legacy fallback: append auth from localStorage
    const t = localStorage.getItem("pc_token");
    const sep = url.includes("?") ? "&" : "?";
    return `${process.env.REACT_APP_BACKEND_URL}${url}${t ? `${sep}auth=${encodeURIComponent(t)}` : ""}`;
  };

  const isPrimary = accent === "primary";
  const resolved = (value || []).map((url) => ({ url: resolveSrc(url), label }));

  return (
    <div data-testid={testid}>
      {label && (
        <div className={`text-[10px] uppercase tracking-wider mb-2 ${isPrimary ? "text-primary" : "text-muted-foreground"}`}>
          {label}
        </div>
      )}
      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
        {(value || []).map((url, i) => (
          <div key={i}
            className={`relative group h-28 rounded-xl overflow-hidden border cursor-zoom-in ${isPrimary ? "border-primary/40" : "border-border"} bg-muted/30`}
            onClick={() => setLb({ open: true, index: i })}
            data-testid={`${testid}-thumb-${i}`}
          >
            <img
              src={resolveSrc(url)}
              alt=""
              loading="lazy"
              className="w-full h-full object-cover"
              onError={(e) => { e.currentTarget.style.opacity = "0.3"; }}
            />
            <button
              type="button"
              data-testid={`${testid}-remove-${i}`}
              onClick={(e) => { e.stopPropagation(); removeAt(i); }}
              className="absolute top-1 right-1 h-6 w-6 rounded-full bg-black/70 text-white opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}
        <button
          type="button"
          data-testid={`${testid}-add-btn`}
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className={`h-28 rounded-xl border-2 border-dashed flex flex-col items-center justify-center text-xs gap-1 transition-colors
            ${isPrimary ? "border-primary/40 hover:border-primary text-primary" : "border-border hover:border-muted-foreground text-muted-foreground"}`}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" strokeWidth={1.5} />}
          <span>{busy ? "Enviando..." : "Adicionar"}</span>
        </button>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => uploadFiles(Array.from(e.target.files || []))}
      />

      <Lightbox
        images={resolved}
        startIndex={lb.index}
        open={lb.open}
        onOpenChange={(o) => setLb({ ...lb, open: o })}
      />
    </div>
  );
}
