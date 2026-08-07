import React, { useEffect, useState } from "react";
import api from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import SignaturePad from "@/components/SignaturePad";
import { FileText, Loader2, CheckCircle2, QrCode, Download, ExternalLink, ChevronLeft } from "lucide-react";
import { toast } from "sonner";
import { QRCodeSVG } from "qrcode.react";

const moneyBR = (n) => (n == null ? "" : (Number(n) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));
const STATUS_LABEL = {
  rascunho: { label: "Rascunho", cls: "bg-muted text-muted-foreground" },
  aguardando_paciente: { label: "Aguardando paciente", cls: "bg-amber-500/15 text-amber-600" },
  aguardando_profissional: { label: "Aguardando profissional", cls: "bg-amber-500/15 text-amber-600" },
  finalizado: { label: "Finalizado", cls: "bg-success/15 text-success" },
};

/**
 * DocumentGenerator — full flow inside a Dialog:
 *  1. Choose template
 *  2. Review preview
 *  3. Sign patient + professional
 *  4. Finalize → download PDF
 *
 * Props:
 *  open, onOpenChange
 *  patientId (required)
 *  appointmentId? (optional)
 *  procedure? (default procedure name)
 *  procedureValue? (default value)
 *  onFinalized?: (doc) => void
 */
export default function DocumentGenerator({
  open, onOpenChange, patientId, appointmentId, procedure, procedureValue, onFinalized,
}) {
  const [step, setStep] = useState("pick"); // pick | review | finalized
  const [templates, setTemplates] = useState([]);
  const [busy, setBusy] = useState(false);
  const [doc, setDoc] = useState(null);
  const [patientSig, setPatientSig] = useState(null);
  const [proSig, setProSig] = useState(null);
  const [qrUrl, setQrUrl] = useState(null);

  useEffect(() => {
    if (!open) return;
    setStep("pick");
    setDoc(null);
    setPatientSig(null);
    setProSig(null);
    setQrUrl(null);
    (async () => {
      try {
        const { data } = await api.get("/document-templates", { params: { active_only: true } });
        setTemplates(data);
      } catch { /* ignore */ }
    })();
  }, [open]);

  const pickTemplate = async (tpl) => {
    setBusy(true);
    try {
      const { data } = await api.post("/documents", {
        template_id: tpl.template_id,
        patient_id: patientId,
        appointment_id: appointmentId || null,
        procedure: procedure || tpl.name,
        procedure_value: procedureValue ?? null,
      });
      setDoc(data);
      setStep("review");
    } catch (e) {
      toast.error(e.response?.data?.detail || "Erro ao gerar documento");
    } finally { setBusy(false); }
  };

  const signPatient = async () => {
    if (!patientSig) { toast.error("Capture a assinatura do paciente"); return; }
    setBusy(true);
    try {
      await api.put(`/documents/${doc.document_id}/sign-patient`, { signature: patientSig, device: "desktop" });
      setDoc((d) => ({ ...d, patient_signature: patientSig, signed_patient_at: new Date().toISOString() }));
      toast.success("Assinatura do paciente registrada");
    } catch { toast.error("Erro ao assinar"); } finally { setBusy(false); }
  };

  const signPro = async () => {
    if (!proSig) { toast.error("Capture a assinatura do profissional"); return; }
    setBusy(true);
    try {
      await api.put(`/documents/${doc.document_id}/sign-professional`, { signature: proSig, device: "desktop" });
      setDoc((d) => ({ ...d, professional_signature: proSig, signed_professional_at: new Date().toISOString() }));
      toast.success("Assinatura do profissional registrada");
    } catch { toast.error("Erro ao assinar"); } finally { setBusy(false); }
  };

  const finalize = async () => {
    if (!doc?.patient_signature || !doc?.professional_signature) {
      toast.error("Ambas assinaturas são obrigatórias");
      return;
    }
    setBusy(true);
    try {
      const { data } = await api.post(`/documents/${doc.document_id}/finalize`);
      setDoc(data);
      setStep("finalized");
      onFinalized?.(data);
      toast.success("Documento finalizado e PDF gerado");
    } catch (e) {
      toast.error(e.response?.data?.detail || "Erro ao finalizar");
    } finally { setBusy(false); }
  };

  const generateMobileSignQR = () => {
    const url = `${window.location.origin}/documento-publico/${doc.public_token}`;
    setQrUrl(url);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl rounded-2xl max-h-[90vh] overflow-y-auto" data-testid="document-generator">
        <DialogHeader>
          <DialogTitle className="font-display text-xl tracking-tight flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" strokeWidth={1.5} />
            {step === "pick" ? "Gerar documento" : (doc?.template_name || "Documento")}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            {step === "pick" && "Selecione um modelo. Os dados serão preenchidos automaticamente."}
            {step === "review" && "Revise o conteúdo e capture as assinaturas."}
            {step === "finalized" && "Documento finalizado. Baixe ou compartilhe o PDF."}
          </DialogDescription>
        </DialogHeader>

        {step === "pick" && (
          <div className="space-y-2" data-testid="dg-templates-list">
            {templates.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border p-8 text-center">
                <p className="text-sm text-muted-foreground">Nenhum modelo cadastrado.</p>
                <p className="text-xs text-muted-foreground/70 mt-1">Peça ao administrador para criar modelos em <strong>Documentos Jurídicos</strong>.</p>
              </div>
            ) : templates.map((t) => (
              <button key={t.template_id}
                onClick={() => pickTemplate(t)}
                disabled={busy}
                data-testid={`dg-pick-${t.template_id}`}
                className="w-full text-left rounded-xl border border-border p-4 hover:bg-muted/40 transition-colors disabled:opacity-50">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium">{t.name}</div>
                    {t.description && <div className="text-xs text-muted-foreground mt-0.5">{t.description}</div>}
                  </div>
                  <Badge variant="outline" className="text-[10px] uppercase">{t.category}</Badge>
                </div>
              </button>
            ))}
          </div>
        )}

        {step === "review" && doc && (
          <div className="space-y-4" data-testid="dg-review">
            <Button type="button" variant="ghost" size="sm" onClick={() => setStep("pick")} className="h-8 text-xs -ml-2" data-testid="dg-back">
              <ChevronLeft className="h-3.5 w-3.5 mr-1" /> Trocar modelo
            </Button>

            <Badge className={`${STATUS_LABEL[doc.status]?.cls} border-0`} data-testid="dg-status">
              {STATUS_LABEL[doc.status]?.label || doc.status}
            </Badge>

            <div className="rounded-xl border border-border bg-card p-5 prose prose-sm max-w-none max-h-72 overflow-auto"
              data-testid="dg-preview"
              dangerouslySetInnerHTML={{ __html: doc.content_html || "" }} />

            <div className="text-[11px] text-muted-foreground grid grid-cols-2 gap-2">
              <div><strong>Paciente:</strong> {doc.patient_name}</div>
              <div><strong>Profissional:</strong> {doc.professional_name}</div>
              {doc.procedure && <div><strong>Procedimento:</strong> {doc.procedure}</div>}
              {doc.procedure_value != null && <div><strong>Valor:</strong> {moneyBR(doc.procedure_value)}</div>}
            </div>

            <Tabs defaultValue="patient" className="w-full">
              <TabsList className="bg-muted/40 rounded-xl max-w-full overflow-x-auto justify-start">
                <TabsTrigger value="patient" data-testid="dg-tab-patient" className="rounded-lg">Assinatura paciente</TabsTrigger>
                <TabsTrigger value="pro" data-testid="dg-tab-pro" className="rounded-lg">Assinatura profissional</TabsTrigger>
                <TabsTrigger value="qr" data-testid="dg-tab-qr" className="rounded-lg">
                  <QrCode className="h-3.5 w-3.5 mr-1" /> QR celular
                </TabsTrigger>
              </TabsList>

              <TabsContent value="patient" className="mt-4 space-y-3">
                {doc.patient_signature ? (
                  <div className="text-center py-6 rounded-xl border border-success/30 bg-success/5">
                    <CheckCircle2 className="h-6 w-6 text-success mx-auto mb-1" strokeWidth={1.5} />
                    <div className="text-sm">Paciente assinou em {new Date(doc.signed_patient_at).toLocaleString("pt-BR")}</div>
                  </div>
                ) : (
                  <>
                    <SignaturePad testid="dg-sig-patient" value={patientSig} onChange={setPatientSig} />
                    <Button onClick={signPatient} disabled={busy || !patientSig} className="rounded-xl w-full" data-testid="dg-sign-patient-btn">
                      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Registrar assinatura do paciente"}
                    </Button>
                  </>
                )}
              </TabsContent>

              <TabsContent value="pro" className="mt-4 space-y-3">
                {doc.professional_signature ? (
                  <div className="text-center py-6 rounded-xl border border-success/30 bg-success/5">
                    <CheckCircle2 className="h-6 w-6 text-success mx-auto mb-1" strokeWidth={1.5} />
                    <div className="text-sm">Profissional assinou em {new Date(doc.signed_professional_at).toLocaleString("pt-BR")}</div>
                  </div>
                ) : (
                  <>
                    <SignaturePad testid="dg-sig-pro" value={proSig} onChange={setProSig} />
                    <Button onClick={signPro} disabled={busy || !proSig} className="rounded-xl w-full" data-testid="dg-sign-pro-btn">
                      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Registrar assinatura do profissional"}
                    </Button>
                  </>
                )}
              </TabsContent>

              <TabsContent value="qr" className="mt-4 space-y-3" data-testid="dg-qr-tab">
                <p className="text-xs text-muted-foreground">
                  Mostre o QR Code abaixo para o paciente apontar a câmera do celular dele e assinar pelo aparelho.
                </p>
                {qrUrl ? (
                  <div className="flex flex-col items-center gap-3 p-5 rounded-xl border border-border bg-card">
                    <QRCodeSVG value={qrUrl} size={180} data-testid="dg-qr-svg" />
                    <code className="text-[10px] text-muted-foreground break-all max-w-full">{qrUrl}</code>
                  </div>
                ) : (
                  <Button variant="outline" onClick={generateMobileSignQR} className="rounded-xl w-full" data-testid="dg-qr-generate">
                    <QrCode className="h-4 w-4 mr-1.5" /> Gerar QR Code
                  </Button>
                )}
              </TabsContent>
            </Tabs>

            <Button onClick={finalize} disabled={busy || !doc.patient_signature || !doc.professional_signature}
              className="w-full h-12 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90"
              data-testid="dg-finalize-btn">
              {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <><CheckCircle2 className="h-5 w-5 mr-1.5" /> Finalizar e gerar PDF</>}
            </Button>
          </div>
        )}

        {step === "finalized" && doc && (
          <div className="space-y-4 text-center py-6" data-testid="dg-finalized">
            <CheckCircle2 className="h-12 w-12 text-success mx-auto" strokeWidth={1.5} />
            <div>
              <div className="font-display text-xl">Documento finalizado</div>
              <p className="text-xs text-muted-foreground mt-1">PDF gerado e salvo na ficha do paciente.</p>
            </div>
            {doc.pdf_url && (
              <div className="flex flex-col items-center gap-2">
                <a href={`${process.env.REACT_APP_BACKEND_URL}${doc.pdf_url}`} target="_blank" rel="noreferrer" data-testid="dg-pdf-link">
                  <Button variant="outline" className="rounded-xl">
                    <Download className="h-4 w-4 mr-1.5" /> Baixar PDF
                  </Button>
                </a>
              </div>
            )}
            <Button onClick={() => onOpenChange(false)} className="rounded-xl" data-testid="dg-close">
              Fechar
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
