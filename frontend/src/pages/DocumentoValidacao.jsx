import React, { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import axios from "axios";
import { Sparkles, Loader2, CheckCircle2, XCircle, ShieldCheck } from "lucide-react";

export default function DocumentoValidacao() {
  const { documentId } = useParams();
  const [params] = useSearchParams();
  const token = params.get("t");
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    const api = axios.create({ baseURL: process.env.REACT_APP_BACKEND_URL });
    (async () => {
      try {
        if (!token) throw new Error("Token ausente");
        const { data } = await api.get(`/api/public/documents/${token}/validate`);
        setData(data);
      } catch (e) {
        setError(e.response?.data?.detail || e.message || "Token inválido");
      } finally { setLoading(false); }
    })();
  }, [documentId, token]);

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center bg-background"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  }

  const valid = data?.valid;

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 text-center" data-testid="doc-validation">
        <div className={`h-14 w-14 rounded-2xl mx-auto mb-4 flex items-center justify-center ${
          valid ? "bg-success/15 ring-1 ring-success/30" : "bg-destructive/15 ring-1 ring-destructive/30"}`}>
          {valid ? <CheckCircle2 className="h-7 w-7 text-success" strokeWidth={1.5} /> : <XCircle className="h-7 w-7 text-destructive" strokeWidth={1.5} />}
        </div>
        <h1 className="font-display text-2xl tracking-tight">{valid ? "Documento válido" : "Documento inválido"}</h1>
        <p className="text-xs text-muted-foreground mt-1">{error || (valid ? "Verificado em " + new Date().toLocaleString("pt-BR") : "Token inválido ou expirado.")}</p>

        {valid && (
          <div className="mt-5 text-left space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Documento</span><span className="font-medium">{data.template_name}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Paciente</span><span className="font-medium">{data.patient_name}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Profissional</span><span className="font-medium">{data.professional_name}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Clínica</span><span className="font-medium">{data.clinic_name || "—"}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Status</span><span className="font-medium">{data.status}</span></div>
            {data.finalized_at && (
              <div className="flex justify-between"><span className="text-muted-foreground">Finalizado</span><span className="font-medium">{new Date(data.finalized_at).toLocaleString("pt-BR")}</span></div>
            )}
          </div>
        )}

        <div className="text-[11px] text-muted-foreground/70 mt-6 flex items-center justify-center gap-1">
          <ShieldCheck className="h-3 w-3" /> ProClinic · Verificação pública de documento
        </div>
      </div>
    </div>
  );
}
