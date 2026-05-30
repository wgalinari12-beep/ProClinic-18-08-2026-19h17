import React, { useEffect, useState } from "react";
import { QRCodeCanvas } from "qrcode.react";
import api, { API } from "@/lib/api";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Smartphone, RefreshCw, CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "sonner";

/**
 * MobileUploadQR — generates a one-time QR code for mobile camera capture.
 * Props:
 *  open, onOpenChange
 *  contextType: "anamnesis" | "session"
 *  contextId: string (module_id or session_id)
 *  contextLabel?: string
 *  onUploaded?: (urls: string[]) => void   (called when new files appear)
 */
export default function MobileUploadQR({ open, onOpenChange, contextType = "anamnesis", contextId, contextLabel, onUploaded }) {
  const [token, setToken] = useState(null);
  const [busy, setBusy] = useState(false);
  const [uploadedCount, setUploadedCount] = useState(0);
  const [initialCount, setInitialCount] = useState(0);

  // Generate token when opened
  useEffect(() => {
    if (!open || !contextId) return;
    setToken(null);
    setUploadedCount(0);
    (async () => {
      setBusy(true);
      try {
        const { data } = await api.post("/mobile-upload/init", {
          context_type: contextType,
          context_id: contextId,
          label: contextLabel,
        });
        setToken(data.token);
        // get initial file count
        try {
          const r = await api.get(`/mobile-upload/files/${data.token}`);
          setInitialCount(r.data.length);
          setUploadedCount(r.data.length);
        } catch { setInitialCount(0); }
      } catch (e) {
        toast.error("Erro ao gerar QR Code");
      } finally { setBusy(false); }
    })();
  }, [open, contextId, contextType, contextLabel]);

  // Poll for new uploads every 2s while open
  useEffect(() => {
    if (!open || !token) return;
    const t = setInterval(async () => {
      try {
        const { data } = await api.get(`/mobile-upload/files/${token}`);
        if (data.length > uploadedCount) {
          setUploadedCount(data.length);
          const newOnes = data.length - initialCount;
          if (newOnes > 0) {
            onUploaded?.(data.map((d) => d.url));
          }
        }
      } catch { /* ignore */ }
    }, 2500);
    return () => clearInterval(t);
  }, [open, token, uploadedCount, initialCount, onUploaded]);

  const mobileUrl = token
    ? `${window.location.origin}/upload-mobile?token=${encodeURIComponent(token)}&label=${encodeURIComponent(contextLabel || "")}`
    : "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-2xl max-w-md" data-testid="mobile-qr-dialog">
        <DialogHeader>
          <DialogTitle className="font-display text-xl tracking-tight">Capturar com celular</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Aponte a câmera do seu celular para o QR Code abaixo
          </DialogDescription>
        </DialogHeader>

        <div className="py-4 flex flex-col items-center text-center">
          {busy && !token && <Loader2 className="h-8 w-8 animate-spin text-primary my-12" />}
          {token && (
            <>
              <div className="p-4 rounded-2xl bg-white border border-border">
                <QRCodeCanvas value={mobileUrl} size={220} level="M" includeMargin />
              </div>
              <p className="text-xs text-muted-foreground mt-4 max-w-xs">
                Após a leitura, abra o link, escolha a câmera e tire as fotos.
                Elas aparecerão aqui automaticamente.
              </p>
              <div className="mt-4 flex items-center gap-2 text-sm">
                <Smartphone className="h-4 w-4 text-primary" />
                <span className="font-mono text-xs text-muted-foreground">QR válido por 20 min</span>
              </div>
              <div className="mt-4 flex items-center gap-2">
                {uploadedCount > initialCount ? (
                  <span className="flex items-center gap-1.5 text-sm text-success" data-testid="mobile-uploads-count">
                    <CheckCircle2 className="h-4 w-4" />
                    {uploadedCount - initialCount} foto(s) recebida(s)
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <RefreshCw className="h-3 w-3 animate-spin" />
                    Aguardando fotos...
                  </span>
                )}
              </div>
            </>
          )}
        </div>

        <Button onClick={() => onOpenChange(false)} variant="outline" className="rounded-xl w-full" data-testid="mobile-qr-close-btn">
          Fechar
        </Button>
      </DialogContent>
    </Dialog>
  );
}
