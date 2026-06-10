import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import axios from "axios";
import { Button } from "@/components/ui/button";
import SignaturePad from "@/components/SignaturePad";
import { Sparkles, Loader2, CheckCircle2, XCircle, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

export default function DocumentoPublico() {
  const { token } = useParams();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [signature, setSignature] = useState(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const api = axios.create({ baseURL: process.env.REACT_APP_BACKEND_URL });

  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get(`/api/public/documents/${token}`);
        setData(data);
        setDone(data.has_patient_signature);
      } catch (e) {
        setError(e.response?.data?.detail || "Documento indisponível");
      } finally { setLoading(false); }
    })();
    // eslint-disable-next-line
  }, [token]);

  const submit = async () => {
    if (!signature) { toast.error("Assine para enviar"); return; }
    setBusy(true);
    try {
      await api.post(`/api/public/documents/${token}/sign-patient`, {
        signature,
        device: /Mobi|Android|iPhone/i.test(navigator.userAgent) ? "mobile-qr" : "desktop",
      });
      setDone(true);
      toast.success("Assinatura enviada");
    } catch (e) {
      toast.error(e.response?.data?.detail || "Erro ao enviar assinatura");
    } finally { setBusy(false); }
  };

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center bg-background"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  }
  if (error || !data) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background p-8 text-center">
        <XCircle className="h-12 w-12 text-destructive mb-3" strokeWidth={1.5} />
        <h1 className="font-display text-2xl tracking-tight">Não foi possível carregar</h1>
        <p className="text-sm text-muted-foreground mt-1">{error || "Link inválido ou expirado."}</p>
      </div>
    );
  }

  const doc = data.document;
  const clinic = data.clinic;

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b border-border bg-card/40">
        <div className="max-w-2xl mx-auto px-5 py-4 flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-primary/15 ring-1 ring-primary/30 flex items-center justify-center">
            <Sparkles className="h-5 w-5 text-primary" strokeWidth={1.5} />
          </div>
          <div>
            <div className="font-display text-lg font-semibold tracking-tight">{clinic?.name || "ProClinic"}</div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Documento para assinatura</div>
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-5 py-6 space-y-5" data-testid="documento-publico">
        <div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Para</div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">{doc.patient_name}</h1>
        </div>

        <div className="rounded-2xl border border-border bg-card p-5 prose prose-sm max-w-none"
          dangerouslySetInnerHTML={{ __html: doc.content_html || "" }} />

        <div className="text-[11px] text-muted-foreground space-y-1">
          <div><strong>Profissional:</strong> {doc.professional_name}</div>
          {doc.procedure && <div><strong>Procedimento:</strong> {doc.procedure}</div>}
        </div>

        {done ? (
          <div className="rounded-2xl border border-success/30 bg-success/10 p-6 text-center" data-testid="doc-signed-ok">
            <CheckCircle2 className="h-10 w-10 text-success mx-auto mb-2" strokeWidth={1.5} />
            <div className="font-display text-lg">Assinatura registrada</div>
            <p className="text-xs text-muted-foreground mt-1">Você pode fechar esta página com segurança.</p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Sua assinatura</div>
            <SignaturePad testid="doc-public-signature" value={signature} onChange={setSignature} />
            <Button onClick={submit} disabled={busy || !signature}
              className="w-full h-12 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90"
              data-testid="doc-public-submit">
              {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <><CheckCircle2 className="h-5 w-5 mr-1.5" /> Enviar assinatura</>}
            </Button>
          </div>
        )}

        <div className="text-center text-[11px] text-muted-foreground/70 mt-8 flex items-center justify-center gap-1">
          <ShieldCheck className="h-3 w-3" /> Conexão segura · {clinic?.name || "ProClinic"}
        </div>
      </div>
    </div>
  );
}
