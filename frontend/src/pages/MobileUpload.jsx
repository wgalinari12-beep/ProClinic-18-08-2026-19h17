import React, { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Camera, Upload, CheckCircle2, Loader2, Sparkles } from "lucide-react";
import axios from "axios";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

/**
 * Mobile upload page — public route /upload-mobile?token=XXX
 * User reaches this via QR code on desktop session.
 */
export default function MobileUpload() {
  const location = useLocation();
  const navigate = useNavigate();
  const params = new URLSearchParams(location.search);
  const token = params.get("token");
  const label = params.get("label") || "Avaliação";

  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [valid, setValid] = useState(null);
  const [uploaded, setUploaded] = useState([]);

  useEffect(() => {
    if (!token) { setValid(false); return; }
    (async () => {
      try {
        await axios.get(`${process.env.REACT_APP_BACKEND_URL}/api/mobile-upload/verify/${token}`);
        setValid(true);
      } catch {
        setValid(false);
      }
    })();
  }, [token]);

  const upload = async (files) => {
    if (!files?.length) return;
    setBusy(true);
    try {
      for (const f of files) {
        const fd = new FormData();
        fd.append("file", f);
        const { data } = await axios.post(
          `${process.env.REACT_APP_BACKEND_URL}/api/mobile-upload/upload?token=${encodeURIComponent(token)}`,
          fd,
        );
        setUploaded((u) => [data.url, ...u]);
      }
      toast.success("Foto enviada!");
    } catch (e) {
      toast.error("Falha no envio");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  if (valid === null) {
    return <div className="min-h-screen flex items-center justify-center bg-background"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  }
  if (valid === false) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6 text-center">
        <div>
          <div className="h-16 w-16 mx-auto rounded-full bg-destructive/10 ring-1 ring-destructive/30 flex items-center justify-center">
            <Camera className="h-8 w-8 text-destructive" strokeWidth={1.5} />
          </div>
          <h1 className="font-display text-2xl font-semibold tracking-tight mt-4">QR Code inválido ou expirado</h1>
          <p className="text-sm text-muted-foreground mt-2">Solicite um novo QR Code no desktop.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground p-6 flex flex-col" data-testid="mobile-upload-page">
      <div className="flex items-center gap-2 mb-6">
        <div className="h-9 w-9 rounded-xl bg-primary/10 ring-1 ring-primary/30 flex items-center justify-center">
          <Sparkles className="h-4 w-4 text-primary" strokeWidth={1.5} />
        </div>
        <div>
          <div className="font-display text-base font-semibold tracking-tight">ProClinic</div>
          <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Captura mobile</div>
        </div>
      </div>

      <div className="text-center mb-6">
        <h1 className="font-display text-2xl font-semibold tracking-tight">{label}</h1>
        <p className="text-sm text-muted-foreground mt-1">Tire as fotos e elas aparecerão automaticamente no desktop.</p>
      </div>

      <Button
        data-testid="mobile-camera-btn"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        className="h-16 rounded-2xl bg-primary text-primary-foreground hover:bg-primary/90 text-base"
      >
        {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <><Camera className="h-5 w-5 mr-2" /> Tirar foto / Escolher</>}
      </Button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        className="hidden"
        onChange={(e) => upload(Array.from(e.target.files || []))}
      />

      {uploaded.length > 0 && (
        <div className="mt-6">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-1.5">
            <CheckCircle2 className="h-3 w-3 text-success" />
            {uploaded.length} foto(s) enviada(s)
          </div>
          <div className="grid grid-cols-3 gap-2">
            {uploaded.map((u, i) => (
              <div key={i} className="aspect-square rounded-xl bg-muted/40 border border-border flex items-center justify-center">
                <CheckCircle2 className="h-6 w-6 text-success" />
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-auto pt-8 text-center text-xs text-muted-foreground">
        Pode fechar esta página quando terminar.
      </div>
    </div>
  );
}
