import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import api from "@/lib/api";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import {
  ArrowLeft, Phone, Mail, MapPin, AlertTriangle, CalendarDays,
  ClipboardList, Cake, Wallet, FileSignature, ExternalLink, Activity,
} from "lucide-react";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import BudgetEditor from "@/components/BudgetEditor";
import DocumentGenerator from "@/components/DocumentGenerator";
import PatientFinanceTab from "@/components/PatientFinanceTab";
import PatientClinicalTimeline from "@/components/PatientClinicalTimeline";
import PatientAnamneseTab from "@/components/PatientAnamneseTab";
import { useAuth } from "@/contexts/AuthContext";

export default function PatientDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [patient, setPatient] = useState(null);
  const [appointments, setAppointments] = useState([]);
  const [anamnesis, setAnamnesis] = useState([]);
  const [budgets, setBudgets] = useState([]);
  const [signedDocs, setSignedDocs] = useState([]);
  const [budgetOpen, setBudgetOpen] = useState(false);
  const [budgetId, setBudgetId] = useState(null);
  const [docGenOpen, setDocGenOpen] = useState(false);
  const [continueDocId, setContinueDocId] = useState(null); // F2: retomar documento existente
  // ⭐ Fase 4/7 + Lote 4/Fase B (B3): "Histórico" (timeline clínica) é a aba principal.
  // Recepção (sem acesso clínico) mantém a Timeline de agendamentos como aba inicial.
  const [activeTab, setActiveTab] = useState(user?.role === "recepcao" ? "timeline" : "clinica");
  const [focusSession, setFocusSession] = useState(null);

  const openOriginalSession = (sid) => {
    setFocusSession(sid);
    setActiveTab("clinica");
  };

  const canClinical = user?.role !== "recepcao";

  useEffect(() => {
    (async () => {
      try {
        const calls = [
          api.get(`/patients/${id}`),
          api.get(`/appointments`),
        ];
        if (canClinical) {
          calls.push(api.get(`/anamnesis`, { params: { patient_id: id } }));
          calls.push(api.get(`/budgets`, { params: { patient_id: id } }));
          calls.push(api.get(`/documents`, { params: { patient_id: id } }));
        }
        const res = await Promise.all(calls);
        setPatient(res[0].data);
        setAppointments(res[1].data.filter((a) => a.patient_id === id));
        if (canClinical) {
          setAnamnesis(res[2].data);
          setBudgets(res[3].data);
          setSignedDocs(res[4].data);
        }
      } catch (e) {
        console.error(e);
      }
    })();
  }, [id, canClinical]);

  const reloadBudgets = async () => {
    try {
      const { data } = await api.get(`/budgets`, { params: { patient_id: id } });
      setBudgets(data);
    } catch { /* ignore */ }
  };

  if (!patient) {
    return <div className="p-12 text-muted-foreground">Carregando...</div>;
  }

  return (
    <div data-testid="patient-detail-page">
      <PageHeader
        title={patient.name}
        subtitle={patient.cpf ? `CPF · ${patient.cpf}` : "Perfil do paciente"}
        actions={
          <div className="flex items-center gap-2">
            {canClinical && (
              <Button variant="outline" size="sm" className="rounded-xl" onClick={() => { setContinueDocId(null); setDocGenOpen(true); }} data-testid="new-document-btn">
                <FileSignature className="h-3.5 w-3.5 mr-1.5" /> Documento
              </Button>
            )}
            {canClinical && (
              <Button variant="outline" size="sm" className="rounded-xl" onClick={() => { setBudgetId(null); setBudgetOpen(true); }} data-testid="new-budget-btn">
                <Wallet className="h-3.5 w-3.5 mr-1.5" /> Novo orçamento
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={() => navigate("/pacientes")} data-testid="back-to-patients">
              <ArrowLeft className="h-4 w-4 mr-1" /> Voltar
            </Button>
          </div>
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
          <Tabs value={activeTab} onValueChange={setActiveTab} data-testid="patient-tabs">
            <TabsList className="bg-muted/50 rounded-xl max-w-full overflow-x-auto justify-start">
              {!canClinical && (
                <TabsTrigger value="timeline" data-testid="tab-timeline" className="rounded-lg data-[state=active]:bg-card data-[state=active]:text-primary">
                  <CalendarDays className="h-4 w-4 mr-1.5" />Timeline
                </TabsTrigger>
              )}
              {canClinical && (
                <>
                  <TabsTrigger value="clinica" data-testid="tab-clinica" className="rounded-lg data-[state=active]:bg-card data-[state=active]:text-primary">
                    <Activity className="h-4 w-4 mr-1.5" />Histórico
                  </TabsTrigger>
                  <TabsTrigger value="anamnese" data-testid="tab-anamnese" className="rounded-lg data-[state=active]:bg-card data-[state=active]:text-primary">
                    <ClipboardList className="h-4 w-4 mr-1.5" />Anamnese
                  </TabsTrigger>
                </>
              )}
              {canClinical && (
                <TabsTrigger value="orcamentos" data-testid="tab-orcamentos" className="rounded-lg data-[state=active]:bg-card data-[state=active]:text-primary">
                  <Wallet className="h-4 w-4 mr-1.5" />Orçamentos
                </TabsTrigger>
              )}
              {canClinical && (
                <TabsTrigger value="documentos" data-testid="tab-documentos" className="rounded-lg data-[state=active]:bg-card data-[state=active]:text-primary">
                  <FileSignature className="h-4 w-4 mr-1.5" />Documentos
                </TabsTrigger>
              )}
              {(user?.role === "admin" || user?.role === "financeiro" || user?.role === "recepcao") && (
                <TabsTrigger value="financeiro" data-testid="tab-financeiro" className="rounded-lg data-[state=active]:bg-card data-[state=active]:text-primary">
                  <Wallet className="h-4 w-4 mr-1.5" />Financeiro
                </TabsTrigger>
              )}
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

            <TabsContent value="clinica" className="mt-5" data-testid="clinica-tab-content">
              {!canClinical ? null : <PatientClinicalTimeline patientId={id} focusSessionId={focusSession} />}
            </TabsContent>

            <TabsContent value="anamnese" className="mt-5">
              {!canClinical ? null : (
                <PatientAnamneseTab patientId={id} onOpenSession={openOriginalSession} legacyAnamnesis={anamnesis} />
              )}
            </TabsContent>

            {canClinical && (
              <TabsContent value="orcamentos" className="mt-5" data-testid="orcamentos-list">
                {budgets.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-8 text-center">Nenhum orçamento.</p>
                ) : (
                  <div className="space-y-3">
                    {budgets.map((b) => (
                      <button key={b.budget_id}
                        onClick={() => { setBudgetId(b.budget_id); setBudgetOpen(true); }}
                        data-testid={`budget-row-${b.budget_id}`}
                        className="w-full text-left border border-border rounded-xl p-4 hover:bg-muted/40 transition-colors">
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="font-medium">{(Number(b.total) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</div>
                            <div className="text-xs text-muted-foreground">
                              {format(parseISO(b.created_at), "dd/MM/yyyy", { locale: ptBR })} · {b.items?.length || 0} itens · {b.payment_method || "—"}
                            </div>
                          </div>
                          <Badge variant="outline" className="text-[10px] uppercase tracking-wider">{b.status}</Badge>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </TabsContent>
            )}

            {canClinical && (
              <TabsContent value="documentos" className="mt-5" data-testid="documentos-assinados">
                {signedDocs.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-8 text-center">Nenhum documento gerado para este paciente.</p>
                ) : (
                  <div className="rounded-xl border border-border bg-card overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/30">
                        <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                          <th className="px-4 py-2">Documento</th>
                          <th className="px-4 py-2">Procedimento</th>
                          <th className="px-4 py-2">Profissional</th>
                          <th className="px-4 py-2">Data</th>
                          <th className="px-4 py-2">Status</th>
                          <th className="px-4 py-2" />
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {signedDocs.map((d) => (
                          <tr key={d.document_id} className="hover:bg-muted/20" data-testid={`patient-doc-${d.document_id}`}>
                            <td className="px-4 py-3">{d.template_name}</td>
                            <td className="px-4 py-3 text-xs text-muted-foreground">{d.procedure || "—"}</td>
                            <td className="px-4 py-3">{d.professional_name}</td>
                            <td className="px-4 py-3 text-xs text-muted-foreground">{format(parseISO(d.created_at), "dd/MM/yyyy HH:mm", { locale: ptBR })}</td>
                            <td className="px-4 py-3">
                              <Badge variant="outline" className="text-[10px] uppercase">{d.status}</Badge>
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                {d.pdf_url ? (
                                  <a href={`${process.env.REACT_APP_BACKEND_URL}${d.pdf_url}`} target="_blank" rel="noreferrer"
                                    className="text-primary hover:underline text-xs inline-flex items-center gap-1">
                                    PDF <ExternalLink className="h-3 w-3" />
                                  </a>
                                ) : (
                                  <span className="text-[11px] text-muted-foreground">—</span>
                                )}
                                {d.status !== "finalizado" && (
                                  <Button variant="outline" size="sm" className="h-7 rounded-lg text-[11px]"
                                    onClick={() => { setContinueDocId(d.document_id); setDocGenOpen(true); }}
                                    data-testid={`continue-doc-${d.document_id}`}>
                                    Continuar
                                  </Button>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </TabsContent>
            )}

            {(user?.role === "admin" || user?.role === "financeiro" || user?.role === "recepcao") && (
              <TabsContent value="financeiro" className="mt-5" data-testid="financeiro-tab-content">
                <PatientFinanceTab
                  patientId={id}
                  patientEmail={patient.email}
                  patientPhone={patient.phone}
                />
              </TabsContent>
            )}
          </Tabs>
        </div>
      </div>

      <Dialog open={budgetOpen} onOpenChange={(o) => { setBudgetOpen(o); if (!o) reloadBudgets(); }}>
        <DialogContent className="max-w-3xl rounded-2xl" data-testid="budget-dialog">
          <DialogHeader>
            <DialogTitle className="font-display text-xl tracking-tight">
              {budgetId ? "Editar orçamento" : "Novo orçamento"}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Paciente: {patient.name}
            </DialogDescription>
          </DialogHeader>
          <BudgetEditor patientId={id} budgetId={budgetId} onSaved={(b) => setBudgetId(b.budget_id)} />
        </DialogContent>
      </Dialog>

      <DocumentGenerator
        open={docGenOpen}
        onOpenChange={(o) => {
          setDocGenOpen(o);
          if (!o) {
            setContinueDocId(null);
            api.get(`/documents`, { params: { patient_id: id } }).then((r) => setSignedDocs(r.data)).catch(() => {});
          }
        }}
        patientId={id}
        documentId={continueDocId}
      />
    </div>
  );
}
