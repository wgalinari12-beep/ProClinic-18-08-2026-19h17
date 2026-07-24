import React, { useCallback, useEffect, useState } from "react";
import api from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Receipt, ExternalLink, Mail, MessageCircle, CheckCircle2, Clock, AlertTriangle, TrendingUp, Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useAuth } from "@/contexts/AuthContext";

const brl = (n) => (Number(n) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export default function PatientFinanceTab({ patientId, patientEmail, patientPhone }) {
  const { user } = useAuth();
  const [summary, setSummary] = useState(null);
  const [busy, setBusy] = useState(null); // {entryId, action}
  const [emailDialog, setEmailDialog] = useState({ open: false, entryId: null, email: "" });

  const canWrite = user?.role === "admin" || user?.role === "financeiro";
  const canRead = canWrite || user?.role === "recepcao" || user?.role === "super_admin";

  const load = useCallback(async () => {
    try {
      const { data } = await api.get(`/finance/patient/${patientId}/summary`);
      setSummary(data);
    } catch (e) {
      if (e.response?.status === 403) {
        setSummary({ forbidden: true });
      } else {
        toast.error("Erro ao carregar financeiro do paciente");
      }
    }
  }, [patientId]);

  useEffect(() => { if (canRead) load(); }, [canRead, load]);

  const openReceipt = async (entry) => {
    if (entry.receipt_url) {
      window.open(`${process.env.REACT_APP_BACKEND_URL}${entry.receipt_url}`, "_blank", "noopener");
      return;
    }
    setBusy({ entryId: entry.entry_id, action: "receipt" });
    try {
      const { data } = await api.post(`/finance/entries/${entry.entry_id}/receipt`);
      window.open(`${process.env.REACT_APP_BACKEND_URL}${data.receipt_url}`, "_blank", "noopener");
      await load();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Erro ao gerar recibo");
    } finally { setBusy(null); }
  };

  const emailReceipt = async (entryId, emailOverride) => {
    setBusy({ entryId, action: "email" });
    try {
      const body = emailOverride ? { email: emailOverride } : {};
      await api.post(`/finance/entries/${entryId}/receipt/email`, body);
      toast.success("Recibo enviado por email");
      setEmailDialog({ open: false, entryId: null, email: "" });
      await load();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Erro ao enviar email");
    } finally { setBusy(null); }
  };

  const whatsappReceipt = async (entryId) => {
    setBusy({ entryId, action: "whatsapp" });
    try {
      const { data } = await api.get(`/finance/entries/${entryId}/receipt/whatsapp-link`);
      window.open(data.whatsapp_url, "_blank", "noopener");
    } catch (e) {
      toast.error(e.response?.data?.detail || "Erro ao gerar link do WhatsApp");
    } finally { setBusy(null); }
  };

  const togglePaid = async (entry) => {
    setBusy({ entryId: entry.entry_id, action: "toggle" });
    try {
      await api.put(`/finance/entries/${entry.entry_id}`, { paid: !entry.paid });
      toast.success(entry.paid ? "Marcado como pendente" : "Recebimento confirmado — recibo gerado");
      await load();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Erro");
    } finally { setBusy(null); }
  };

  if (!canRead) return null;
  if (summary?.forbidden) {
    return <p className="text-sm text-muted-foreground py-8 text-center">Você não tem permissão para ver o financeiro.</p>;
  }
  if (!summary) {
    return <p className="text-sm text-muted-foreground py-8 text-center">Carregando...</p>;
  }

  const today = format(new Date(), "yyyy-MM-dd");

  return (
    <div className="space-y-6" data-testid="patient-finance-tab">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          testid="pf-kpi-pago"
          icon={CheckCircle2}
          label="Total pago"
          value={brl(summary.total_pago)}
          tone="success"
        />
        <KpiCard
          testid="pf-kpi-pendente"
          icon={Clock}
          label="Pendente"
          value={brl(summary.total_pendente)}
          tone="warning"
        />
        <KpiCard
          testid="pf-kpi-vencido"
          icon={AlertTriangle}
          label="Vencido"
          value={brl(summary.total_vencido)}
          tone="destructive"
        />
        <KpiCard
          testid="pf-kpi-proximo"
          icon={TrendingUp}
          label="Próximo vencimento"
          value={summary.proximo_vencimento
            ? format(parseISO(summary.proximo_vencimento), "dd 'de' MMM", { locale: ptBR })
            : "—"}
          tone="primary"
        />
      </div>

      {/* Entries list */}
      {summary.entries.length === 0 ? (
        <p className="text-sm text-muted-foreground py-12 text-center">Sem lançamentos financeiros para este paciente.</p>
      ) : (
        <div className="rounded-xl border border-border overflow-hidden">
          <table className="w-full text-sm" data-testid="pf-entries-table">
            <thead className="bg-muted/30">
              <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-2.5">Vencimento</th>
                <th className="px-4 py-2.5">Descrição</th>
                <th className="px-4 py-2.5 text-right">Valor</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {summary.entries.map((e) => {
                const overdue = !e.paid && (e.due_date || "") < today;
                const isParc = e.installment_total > 1;
                const isBusy = busy?.entryId === e.entry_id;
                return (
                  <tr key={e.entry_id} data-testid={`pf-entry-${e.entry_id}`} className={overdue ? "bg-destructive/5" : ""}>
                    <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                      {e.due_date ? format(parseISO(e.due_date), "dd/MM/yyyy", { locale: ptBR }) : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-[13px]">{e.description}</div>
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mt-0.5 flex items-center gap-2">
                        <span>{e.category}</span>
                        {isParc && <span>· parcela {e.installment_number}/{e.installment_total}</span>}
                        {e.payment_method && <span>· {e.payment_method}</span>}
                      </div>
                    </td>
                    <td className={`px-4 py-3 font-mono text-sm text-right ${e.type === "receita" ? "text-success" : "text-destructive"}`}>
                      {e.type === "receita" ? "+" : "-"} {brl(e.amount)}
                    </td>
                    <td className="px-4 py-3">
                      {e.paid ? (
                        <Badge className="bg-success/15 text-success border-success/30">Pago</Badge>
                      ) : overdue ? (
                        <Badge className="bg-destructive/15 text-destructive border-destructive/30">Vencido</Badge>
                      ) : (
                        <Badge variant="outline" className="text-muted-foreground">Pendente</Badge>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {!e.paid && canWrite && (
                          <Button
                            variant="ghost" size="sm"
                            onClick={() => togglePaid(e)}
                            disabled={isBusy}
                            data-testid={`pf-mark-paid-${e.entry_id}`}
                            className="h-8 text-xs">
                            {isBusy && busy?.action === "toggle" ? <Loader2 className="h-3 w-3 animate-spin" /> : "Marcar pago"}
                          </Button>
                        )}
                        {e.paid && e.type === "receita" && (
                          <>
                            <Button
                              variant="ghost" size="icon"
                              onClick={() => openReceipt(e)}
                              disabled={isBusy}
                              title={e.receipt_number ? `Recibo ${e.receipt_number}` : "Gerar recibo"}
                              data-testid={`pf-receipt-${e.entry_id}`}
                              className="h-8 w-8">
                              {isBusy && busy?.action === "receipt" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Receipt className="h-3.5 w-3.5" strokeWidth={1.5} />}
                            </Button>
                            {canWrite && (
                              <Button
                                variant="ghost" size="icon"
                                onClick={() => setEmailDialog({ open: true, entryId: e.entry_id, email: patientEmail || "" })}
                                disabled={isBusy}
                                title="Enviar por email"
                                data-testid={`pf-email-${e.entry_id}`}
                                className="h-8 w-8">
                                <Mail className="h-3.5 w-3.5" strokeWidth={1.5} />
                              </Button>
                            )}
                            <Button
                              variant="ghost" size="icon"
                              onClick={() => whatsappReceipt(e.entry_id)}
                              disabled={isBusy}
                              title="Compartilhar no WhatsApp"
                              data-testid={`pf-whatsapp-${e.entry_id}`}
                              className="h-8 w-8">
                              {isBusy && busy?.action === "whatsapp" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MessageCircle className="h-3.5 w-3.5" strokeWidth={1.5} />}
                            </Button>
                          </>
                        )}
                      </div>
                      {e.receipt_number && (
                        <div className="text-[10px] font-mono text-muted-foreground mt-1">{e.receipt_number}</div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Email dialog */}
      <Dialog open={emailDialog.open} onOpenChange={(o) => setEmailDialog((s) => ({ ...s, open: o }))}>
        <DialogContent className="rounded-2xl max-w-md" data-testid="pf-email-dialog">
          <DialogHeader>
            <DialogTitle className="font-display text-lg tracking-tight">Enviar recibo por email</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              O PDF será anexado ao email do paciente.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Destinatário</Label>
            <Input
              type="email"
              value={emailDialog.email}
              onChange={(e) => setEmailDialog((s) => ({ ...s, email: e.target.value }))}
              placeholder="paciente@email.com"
              className="h-11 rounded-xl"
              data-testid="pf-email-input"
            />
          </div>
          <DialogFooter className="grid grid-cols-2 gap-2">
            <Button
              variant="outline"
              onClick={() => setEmailDialog({ open: false, entryId: null, email: "" })}
              className="rounded-xl"
              data-testid="pf-email-cancel">
              Cancelar
            </Button>
            <Button
              onClick={() => emailReceipt(emailDialog.entryId, emailDialog.email)}
              disabled={!emailDialog.email || (busy?.action === "email")}
              className="rounded-xl bg-primary text-primary-foreground hover:bg-primary/90"
              data-testid="pf-email-send">
              {busy?.action === "email" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Enviar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function KpiCard({ icon: Icon, label, value, tone = "primary", testid }) {
  const tones = {
    success: "text-success bg-success/10 ring-success/30",
    warning: "text-yellow-600 bg-yellow-500/10 ring-yellow-500/30",
    destructive: "text-destructive bg-destructive/10 ring-destructive/30",
    primary: "text-primary bg-primary/10 ring-primary/30",
  };
  return (
    <div className="rounded-2xl border border-border bg-card p-4" data-testid={testid}>
      <div className={`h-8 w-8 rounded-lg ring-1 flex items-center justify-center ${tones[tone]}`}>
        <Icon className="h-4 w-4" strokeWidth={1.5} />
      </div>
      <div className="mt-3 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{label}</div>
      <div className="font-display text-lg font-semibold tracking-tight mt-0.5">{value}</div>
    </div>
  );
}
