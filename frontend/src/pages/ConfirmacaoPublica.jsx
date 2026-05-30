import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import axios from "axios";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { CheckCircle2, XCircle, Calendar, Clock, MapPin, Stethoscope, Loader2, Building2, Instagram } from "lucide-react";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";

const STATUS_META = {
  CONFIRMADO: { color: "text-success", bg: "bg-success/10", ring: "ring-success/30", label: "Agendamento confirmado", icon: CheckCircle2 },
  CANCELADO: { color: "text-destructive", bg: "bg-destructive/10", ring: "ring-destructive/30", label: "Agendamento cancelado", icon: XCircle },
  REAGENDAMENTO_SOLICITADO: { color: "text-secondary", bg: "bg-secondary/10", ring: "ring-secondary/30", label: "Reagendamento solicitado", icon: Calendar },
};

export default function ConfirmacaoPublica() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [showReschedule, setShowReschedule] = useState(false);
  const [note, setNote] = useState("");

  const apiBase = process.env.REACT_APP_BACKEND_URL;

  const load = async () => {
    setLoading(true);
    try {
      const { data: d } = await axios.get(`${apiBase}/api/public/appointment/${token}`);
      setData(d);
    } catch (err) {
      setError(err.response?.data?.detail || "Link inválido");
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [token]);

  const doAction = async (action) => {
    setBusy(true);
    try {
      await axios.post(`${apiBase}/api/public/appointment/${token}/action`, {
        action,
        reschedule_note: note || undefined,
      });
      await load();
      setShowReschedule(false);
      toast.success("Resposta enviada");
    } catch (err) {
      toast.error("Erro");
    } finally { setBusy(false); }
  };

  const resolveLogo = (url) => {
    if (!url) return null;
    if (url.startsWith("http")) return url;
    return `${apiBase}${url}`;
  };

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center bg-background"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  }
  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6 text-center">
        <div>
          <div className="h-16 w-16 mx-auto rounded-full bg-destructive/10 ring-1 ring-destructive/30 flex items-center justify-center">
            <XCircle className="h-8 w-8 text-destructive" strokeWidth={1.5} />
          </div>
          <h1 className="font-display text-2xl font-semibold tracking-tight mt-4">Link inválido</h1>
          <p className="text-sm text-muted-foreground mt-2">{error}</p>
        </div>
      </div>
    );
  }

  const apt = data.appointment;
  const clinic = data.clinic;
  const meta = STATUS_META[apt.confirmation_status];

  return (
    <div className="min-h-screen bg-background text-foreground" data-testid="public-confirmation-page">
      <div className="max-w-xl mx-auto px-6 py-12">
        {/* Clinic header */}
        <div className="text-center mb-10">
          {clinic.logo_url ? (
            <img src={resolveLogo(clinic.logo_url)} alt={clinic.name} className="h-16 mx-auto object-contain" />
          ) : (
            <div className="h-16 w-16 mx-auto rounded-2xl bg-primary/10 ring-1 ring-primary/30 flex items-center justify-center">
              <Building2 className="h-8 w-8 text-primary" strokeWidth={1.5} />
            </div>
          )}
          <h1 className="font-display text-2xl font-semibold tracking-tight mt-4">{clinic.name}</h1>
          {(clinic.city || clinic.address) && (
            <p className="text-xs text-muted-foreground mt-1">{clinic.address} · {clinic.city}{clinic.state ? `/${clinic.state}` : ""}</p>
          )}
        </div>

        {/* Confirmation status banner */}
        {meta && (
          <div className={`mb-6 p-4 rounded-2xl ${meta.bg} ring-1 ${meta.ring} flex items-center gap-3`} data-testid="confirmation-status-banner">
            <meta.icon className={`h-5 w-5 ${meta.color}`} />
            <div className={`text-sm font-medium ${meta.color}`}>{meta.label}</div>
          </div>
        )}

        {/* Appointment card */}
        <div className="rounded-2xl border border-border bg-card p-6 mb-6">
          <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Seu agendamento</div>
          <h2 className="font-display text-2xl font-semibold tracking-tight mt-1">{apt.procedure}</h2>
          <div className="mt-5 space-y-3 text-sm">
            <div className="flex items-center gap-3">
              <Calendar className="h-4 w-4 text-muted-foreground" strokeWidth={1.5} />
              <span>{format(parseISO(apt.start), "EEEE, dd 'de' MMMM 'de' yyyy", { locale: ptBR })}</span>
            </div>
            <div className="flex items-center gap-3">
              <Clock className="h-4 w-4 text-muted-foreground" strokeWidth={1.5} />
              <span>{format(parseISO(apt.start), "HH:mm")} - {format(parseISO(apt.end), "HH:mm")}</span>
            </div>
            {apt.professional_name && (
              <div className="flex items-center gap-3">
                <Stethoscope className="h-4 w-4 text-muted-foreground" strokeWidth={1.5} />
                <span>{apt.professional_name}</span>
              </div>
            )}
            {apt.room && (
              <div className="flex items-center gap-3">
                <MapPin className="h-4 w-4 text-muted-foreground" strokeWidth={1.5} />
                <span>{apt.room}</span>
              </div>
            )}
          </div>
          <div className="mt-5 pt-5 border-t border-border text-xs text-muted-foreground">
            Paciente: <span className="text-foreground font-medium">{apt.patient_name}</span>
          </div>
        </div>

        {/* Actions */}
        {!apt.confirmation_status || apt.confirmation_status === "REAGENDAMENTO_SOLICITADO" ? (
          <div className="space-y-3" data-testid="public-actions">
            {!showReschedule ? (
              <>
                <Button onClick={() => doAction("confirm")} disabled={busy} className="w-full h-12 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90" data-testid="public-confirm-btn">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <><CheckCircle2 className="h-4 w-4 mr-1.5" /> Confirmar Agendamento</>}
                </Button>
                <Button onClick={() => setShowReschedule(true)} variant="outline" className="w-full h-12 rounded-xl" data-testid="public-reschedule-btn">
                  Solicitar Reagendamento
                </Button>
                <Button onClick={() => doAction("cancel")} disabled={busy} variant="outline" className="w-full h-12 rounded-xl text-destructive" data-testid="public-cancel-btn">
                  Cancelar Agendamento
                </Button>
              </>
            ) : (
              <div className="rounded-2xl border border-border bg-card p-4">
                <div className="text-sm font-medium mb-2">Solicitar reagendamento</div>
                <Textarea value={note} onChange={(e) => setNote(e.target.value)}
                  placeholder="Conte quando prefere reagendar..." rows={3} className="rounded-xl" data-testid="reschedule-note" />
                <div className="grid grid-cols-2 gap-2 mt-3">
                  <Button onClick={() => setShowReschedule(false)} variant="outline" className="rounded-xl">Voltar</Button>
                  <Button onClick={() => doAction("reschedule")} disabled={busy} className="rounded-xl bg-primary text-primary-foreground hover:bg-primary/90" data-testid="public-reschedule-submit-btn">
                    Enviar
                  </Button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="text-center text-sm text-muted-foreground">
            Em caso de dúvida, entre em contato com a clínica.
          </div>
        )}

        {/* Footer */}
        <div className="mt-12 text-center text-xs text-muted-foreground space-y-1">
          {clinic.whatsapp && <div>WhatsApp: {clinic.whatsapp}</div>}
          {clinic.phone && <div>Telefone: {clinic.phone}</div>}
          {clinic.instagram && (
            <a href={clinic.instagram.startsWith("http") ? clinic.instagram : `https://instagram.com/${clinic.instagram}`}
              target="_blank" rel="noreferrer"
              className="inline-flex items-center gap-1 text-primary hover:underline">
              <Instagram className="h-3 w-3" /> {clinic.instagram}
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
