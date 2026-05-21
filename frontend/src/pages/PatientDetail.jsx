import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import api from "@/lib/api";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  ArrowLeft, Phone, Mail, MapPin, AlertTriangle, CalendarDays,
  FileText, ClipboardList, Image as ImageIcon, Cake,
} from "lucide-react";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";

export default function PatientDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [patient, setPatient] = useState(null);
  const [appointments, setAppointments] = useState([]);
  const [records, setRecords] = useState([]);
  const [anamnesis, setAnamnesis] = useState([]);

  useEffect(() => {
    (async () => {
      try {
        const [p, apt, rec, ana] = await Promise.all([
          api.get(`/patients/${id}`),
          api.get(`/appointments`),
          api.get(`/medical-records`, { params: { patient_id: id } }),
          api.get(`/anamnesis`, { params: { patient_id: id } }),
        ]);
        setPatient(p.data);
        setAppointments(apt.data.filter((a) => a.patient_id === id));
        setRecords(rec.data);
        setAnamnesis(ana.data);
      } catch (e) {
        console.error(e);
      }
    })();
  }, [id]);

  if (!patient) {
    return <div className="p-12 text-muted-foreground">Carregando...</div>;
  }

  return (
    <div data-testid="patient-detail-page">
      <PageHeader
        title={patient.name}
        subtitle={patient.cpf ? `CPF · ${patient.cpf}` : "Perfil do paciente"}
        actions={
          <Button variant="ghost" size="sm" onClick={() => navigate("/pacientes")} data-testid="back-to-patients">
            <ArrowLeft className="h-4 w-4 mr-1" /> Voltar
          </Button>
        }
      />

      <div className="p-6 sm:p-8 grid grid-cols-1 lg:grid-cols-3 gap-6 animate-fade-up">
        {/* Profile card */}
        <div className="lg:col-span-1 rounded-2xl border border-border bg-card p-6 h-fit">
          <div className="flex flex-col items-center text-center">
            <div className="h-24 w-24 rounded-full bg-primary/10 ring-1 ring-primary/30 flex items-center justify-center">
              <span className="font-display text-3xl font-semibold text-primary">
                {patient.name?.[0]?.toUpperCase()}
              </span>
            </div>
            <h2 className="font-display text-xl font-semibold tracking-tight mt-4">{patient.name}</h2>
            <Badge variant="outline" className="mt-2 text-[10px] uppercase tracking-wider">
              {patient.status}
            </Badge>
          </div>
          <div className="mt-6 space-y-3 text-sm">
            {patient.birth_date && (
              <div className="flex items-center gap-3">
                <Cake className="h-4 w-4 text-muted-foreground" strokeWidth={1.5} />
                <span>{patient.birth_date}</span>
              </div>
            )}
            {patient.phone && (
              <div className="flex items-center gap-3">
                <Phone className="h-4 w-4 text-muted-foreground" strokeWidth={1.5} />
                <span>{patient.phone}</span>
              </div>
            )}
            {patient.email && (
              <div className="flex items-center gap-3">
                <Mail className="h-4 w-4 text-muted-foreground" strokeWidth={1.5} />
                <span className="truncate">{patient.email}</span>
              </div>
            )}
            {(patient.city || patient.state) && (
              <div className="flex items-center gap-3">
                <MapPin className="h-4 w-4 text-muted-foreground" strokeWidth={1.5} />
                <span>{[patient.city, patient.state].filter(Boolean).join(" / ")}</span>
              </div>
            )}
            {patient.allergies && (
              <div className="flex items-center gap-3 text-destructive">
                <AlertTriangle className="h-4 w-4" strokeWidth={1.5} />
                <span>{patient.allergies}</span>
              </div>
            )}
            {patient.notes && (
              <div className="pt-3 border-t border-border text-xs text-muted-foreground leading-relaxed">
                {patient.notes}
              </div>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="lg:col-span-2 rounded-2xl border border-border bg-card p-6">
          <Tabs defaultValue="timeline" data-testid="patient-tabs">
            <TabsList className="bg-muted/50 rounded-xl">
              <TabsTrigger value="timeline" data-testid="tab-timeline" className="rounded-lg data-[state=active]:bg-card data-[state=active]:text-primary">
                <CalendarDays className="h-4 w-4 mr-1.5" />Timeline
              </TabsTrigger>
              <TabsTrigger value="prontuario" data-testid="tab-prontuario" className="rounded-lg data-[state=active]:bg-card data-[state=active]:text-primary">
                <FileText className="h-4 w-4 mr-1.5" />Prontuário
              </TabsTrigger>
              <TabsTrigger value="anamnese" data-testid="tab-anamnese" className="rounded-lg data-[state=active]:bg-card data-[state=active]:text-primary">
                <ClipboardList className="h-4 w-4 mr-1.5" />Anamnese
              </TabsTrigger>
            </TabsList>

            <TabsContent value="timeline" className="mt-5">
              {appointments.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">Sem atendimentos.</p>
              ) : (
                <div className="relative pl-6 border-l border-border space-y-5">
                  {appointments.map((a) => (
                    <div key={a.appointment_id} className="relative" data-testid={`timeline-item-${a.appointment_id}`}>
                      <div className="absolute -left-[27px] top-1.5 h-2.5 w-2.5 rounded-full bg-primary ring-4 ring-card" />
                      <div className="text-xs text-muted-foreground">
                        {format(parseISO(a.start), "dd 'de' MMM 'às' HH:mm", { locale: ptBR })}
                      </div>
                      <div className="font-medium mt-0.5">{a.procedure}</div>
                      <div className="text-xs text-muted-foreground">{a.professional_name} · {a.status}</div>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="prontuario" className="mt-5">
              {records.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">Nenhum registro clínico.</p>
              ) : (
                <div className="space-y-4">
                  {records.map((r) => (
                    <div key={r.record_id} className="border border-border rounded-xl p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="font-medium">{r.procedure}</div>
                          <div className="text-xs text-muted-foreground">
                            {format(parseISO(r.created_at), "dd/MM/yyyy", { locale: ptBR })} · {r.professional_name}
                          </div>
                        </div>
                        {r.signed && <Badge className="bg-success/15 text-success border-success/30">Assinado</Badge>}
                      </div>
                      <p className="text-sm text-muted-foreground mt-3">{r.evolution}</p>
                      {(r.photos_before?.length > 0 || r.photos_after?.length > 0) && (
                        <div className="flex items-center gap-1 mt-3 text-xs text-primary">
                          <ImageIcon className="h-3.5 w-3.5" />
                          {(r.photos_before?.length || 0) + (r.photos_after?.length || 0)} fotos
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="anamnese" className="mt-5">
              {anamnesis.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">Sem anamnese.</p>
              ) : (
                <div className="space-y-3">
                  {anamnesis.map((a) => (
                    <div key={a.anamnesis_id} className="border border-border rounded-xl p-4">
                      <div className="flex items-center justify-between">
                        <div className="font-medium">{a.template_name}</div>
                        {a.signed && <Badge className="bg-success/15 text-success border-success/30">Assinada</Badge>}
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {format(parseISO(a.created_at), "dd/MM/yyyy", { locale: ptBR })}
                      </div>
                      <div className="mt-3 text-sm space-y-1">
                        {Object.entries(a.answers || {}).slice(0, 4).map(([k, v]) => (
                          <div key={k} className="flex gap-2">
                            <span className="text-muted-foreground">{k}:</span>
                            <span>{String(v)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
