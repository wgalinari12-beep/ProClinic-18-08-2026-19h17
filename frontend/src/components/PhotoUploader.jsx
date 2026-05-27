import React, { useRef, useState } from "react";
import api, { API } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Upload, X, ImageIcon, Loader2 } from "lucide-react";
import { toast } from "sonner";

/**
 * PhotoUploader
 * Props:
 *   value: string[]               URLs (paths like /api/files/...)
 *   onChange: (urls: string[]) => void
 *   label: string
 *   accent?: "primary" | "default"
 *   testid?: string
 */
export default function PhotoUploader({ value = [], onChange, label, accent = "default", testid }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);

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

  // Resolve display src: /api/files/... → absolute URL with token query
  const resolveSrc = (url) => {
    if (!url) return "";
    if (url.startsWith("http")) return url;
    const t = localStorage.getItem("pc_token");
    const sep = url.includes("?") ? "&" : "?";
    return `${process.env.REACT_APP_BACKEND_URL}${url}${t ? `${sep}auth=${encodeURIComponent(t)}` : ""}`;
  };

  const isPrimary = accent === "primary";
  return (
    <div data-testid={testid}>
      {label && (
        <div className={`text-[10px] uppercase tracking-wider mb-2 ${isPrimary ? "text-primary" : "text-muted-foreground"}`}>
          {label}
        </div>
      )}
      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
        {(value || []).map((url, i) => (
          <div key={i} className={`relative group h-28 rounded-xl overflow-hidden border ${isPrimary ? "border-primary/40" : "border-border"}`}>
            <img src={resolveSrc(url)} alt="" className="w-full h-full object-cover" />
            <button
              type="button"
              data-testid={`${testid}-remove-${i}`}
              onClick={(e) => { e.stopPropagation(); removeAt(i); }}
              className="absolute top-1 right-1 h-6 w-6 rounded-full bg-black/60 text-white opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
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
    </div>
  );
}
