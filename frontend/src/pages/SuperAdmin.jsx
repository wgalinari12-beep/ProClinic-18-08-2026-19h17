import React, { useEffect, useState } from "react";
import api from "@/lib/api";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { TrendingUp, Users, Wallet, Percent, Plus, Loader2, Trash2, Building2 } from "lucide-react";
import { toast } from "sonner";

const moneyBR = (n) => (Number(n) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const STATUS_MAP = {
  trial:     { label: "Trial",       cls: "bg-amber-500/15 text-amber-600" },
  active:    { label: "Ativa",       cls: "bg-success/15 text-success" },
  pending:   { label: "Aguardando",  cls: "bg-primary/10 text-primary" },
  past_due:  { label: "Em atraso",   cls: "bg-destructive/15 text-destructive" },
  read_only: { label: "Read-only",   cls: "bg-amber-500/15 text-amber-600" },
  expired:   { label: "Expirada",    cls: "bg-destructive/15 text-destructive" },
  cancelled: { label: "Cancelada",   cls: "bg-muted text-muted-foreground" },
};

export default function SuperAdmin() {
  const [summary, setSummary] = useState(null);
  const [clinics, setClinics] = useState([]);
  const [coupons, setCoupons] = useState([]);
  const [emails, setEmails] = useState([]);
  const [loading, setLoading] = useState(true);
  const [couponOpen, setCouponOpen] = useState(false);
  const [couponForm, setCouponForm] = useState({
    code: "", kind: "percent", value: 20,
    applies_to: ["professional", "premium"],
    first_payment_only: true, max_uses: 100, valid_until: "", active: true,
  });

  const load = async () => {
    setLoading(true);
    try {
      const [s, c, cp, el] = await Promise.all([
        api.get("/super-admin/summary"),
        api.get("/super-admin/clinics"),
        api.get("/coupons"),
        api.get("/super-admin/email-logs").catch(() => ({ data: [] })),
      ]);
      setSummary(s.data);
      setClinics(c.data);
      setCoupons(cp.data);
      setEmails(el.data);
    } catch (e) {
      toast.error("Erro ao carregar dashboard");
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const createCoupon = async () => {
    try {
      await api.post("/coupons", couponForm);
      toast.success("Cupom criado");
      setCouponOpen(false);
      load();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Erro ao criar cupom");
    }
  };

  const deleteCoupon = async (id) => {
    if (!window.confirm("Excluir cupom?")) return;
    try {
      await api.delete(`/coupons/${id}`);
      toast.success("Cupom removido");
      load();
    } catch { toast.error("Erro"); }
  };

  if (loading || !summary) {
    return <div className="p-12 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  }

  return (
    <div data-testid="super-admin-page">
      <PageHeader
        title="Super Admin"
        subtitle="Visão global · MRR/ARR · Cupons · Clínicas"
      />

      <div className="p-6 sm:p-8 max-w-7xl mx-auto animate-fade-up space-y-6">
        {/* KPI cards */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4" data-testid="kpi-cards">
          <KPI icon={Wallet} label="MRR" value={moneyBR(summary.mrr)} sub={`ARR: ${moneyBR(summary.arr)}`} testid="kpi-mrr" />
          <KPI icon={TrendingUp} label="Conversão" value={`${summary.conversion_rate}%`} sub={`Churn: ${summary.churn_rate}%`} testid="kpi-conversion" />
          <KPI icon={Users} label="Assinaturas ativas" value={summary.active} sub={`Trial: ${summary.trial} · Atraso: ${summary.past_due}`} testid="kpi-active" />
          <KPI icon={Building2} label="Clínicas totais" value={summary.clinics} sub={`Receita total: ${moneyBR(summary.total_revenue)}`} testid="kpi-clinics" />
        </div>

        <Tabs defaultValue="clinics" className="w-full">
          <TabsList className="bg-muted/40 rounded-xl">
            <TabsTrigger value="clinics" data-testid="tab-clinics" className="rounded-lg data-[state=active]:bg-card data-[state=active]:text-primary">Clínicas</TabsTrigger>
            <TabsTrigger value="coupons" data-testid="tab-coupons" className="rounded-lg data-[state=active]:bg-card data-[state=active]:text-primary">Cupons</TabsTrigger>
            <TabsTrigger value="emails" data-testid="tab-emails" className="rounded-lg data-[state=active]:bg-card data-[state=active]:text-primary">Emails</TabsTrigger>
          </TabsList>

          {/* Clinics */}
          <TabsContent value="clinics" className="mt-5">
            <div className="rounded-2xl border border-border bg-card overflow-hidden" data-testid="clinics-table">
              <table className="w-full text-sm">
                <thead className="bg-muted/30">
                  <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                    <th className="px-4 py-2">Clínica</th>
                    <th className="px-4 py-2">Plano</th>
                    <th className="px-4 py-2">Status</th>
                    <th className="px-4 py-2">MRR</th>
                    <th className="px-4 py-2">Usuários</th>
                    <th className="px-4 py-2">Pacientes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {clinics.map((c) => {
                    const st = STATUS_MAP[c.subscription?.effective_status || c.subscription?.status || "trial"];
                    return (
                      <tr key={c.clinic_id} data-testid={`clinic-row-${c.clinic_id}`}>
                        <td className="px-4 py-3">
                          <div className="font-medium">{c.name}</div>
                          <div className="text-[10px] text-muted-foreground">{c.clinic_id}</div>
                        </td>
                        <td className="px-4 py-3 capitalize">{c.subscription?.plan_key || "—"}</td>
                        <td className="px-4 py-3">
                          <Badge className={`${st?.cls || ""} border-0 text-[10px]`}>{st?.label || "—"}</Badge>
                        </td>
                        <td className="px-4 py-3 font-mono">{moneyBR(c.subscription?.value || 0)}</td>
                        <td className="px-4 py-3">{c.user_count}</td>
                        <td className="px-4 py-3">{c.patient_count}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </TabsContent>

          {/* Coupons */}
          <TabsContent value="coupons" className="mt-5 space-y-4">
            <div className="flex justify-end">
              <Button onClick={() => setCouponOpen(true)} className="rounded-xl bg-primary text-primary-foreground" data-testid="new-coupon-btn">
                <Plus className="h-4 w-4 mr-1" /> Novo cupom
              </Button>
            </div>
            <div className="rounded-2xl border border-border bg-card overflow-hidden" data-testid="coupons-table">
              {coupons.length === 0 ? (
                <div className="p-8 text-center text-sm text-muted-foreground">Nenhum cupom criado.</div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-muted/30">
                    <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                      <th className="px-4 py-2">Código</th>
                      <th className="px-4 py-2">Desconto</th>
                      <th className="px-4 py-2">Planos</th>
                      <th className="px-4 py-2">Usos</th>
                      <th className="px-4 py-2">Validade</th>
                      <th className="px-4 py-2" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {coupons.map((c) => (
                      <tr key={c.coupon_id} data-testid={`coupon-row-${c.code}`}>
                        <td className="px-4 py-3 font-mono font-semibold">{c.code}</td>
                        <td className="px-4 py-3">{c.kind === "percent" ? `${c.value}%` : moneyBR(c.value)}{c.first_payment_only ? " (1º pagto)" : " (recorrente)"}</td>
                        <td className="px-4 py-3 text-xs">{(c.applies_to || []).join(", ") || "todos"}</td>
                        <td className="px-4 py-3">{c.uses_count}{c.max_uses ? ` / ${c.max_uses}` : ""}</td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">{c.valid_until || "—"}</td>
                        <td className="px-4 py-3">
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => deleteCoupon(c.coupon_id)}
                            data-testid={`delete-coupon-${c.code}`}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </TabsContent>

          {/* Emails */}
          <TabsContent value="emails" className="mt-5" data-testid="emails-tab">
            <div className="rounded-2xl border border-border bg-card overflow-hidden">
              {emails.length === 0 ? (
                <div className="p-8 text-center text-sm text-muted-foreground">Nenhum email enviado ainda.</div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-muted/30">
                    <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                      <th className="px-4 py-2">Data</th>
                      <th className="px-4 py-2">Para</th>
                      <th className="px-4 py-2">Assunto</th>
                      <th className="px-4 py-2">Status</th>
                      <th className="px-4 py-2">Abertura</th>
                      <th className="px-4 py-2">Cliques</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {emails.map((e) => (
                      <tr key={e.email_id} data-testid={`email-row-${e.email_id}`}>
                        <td className="px-4 py-3 text-xs text-muted-foreground">{e.sent_at ? new Date(e.sent_at).toLocaleString("pt-BR") : "—"}</td>
                        <td className="px-4 py-3 text-xs">{e.to}</td>
                        <td className="px-4 py-3 text-xs">{e.subject}</td>
                        <td className="px-4 py-3">
                          <Badge variant="outline" className={`text-[10px] uppercase ${e.status === "sent" ? "text-success" : "text-destructive"}`}>{e.status}</Badge>
                        </td>
                        <td className="px-4 py-3 text-xs">{e.opened_at ? "✓ aberto" : "—"}</td>
                        <td className="px-4 py-3 text-xs">{e.click_count || 0}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </div>

      <Dialog open={couponOpen} onOpenChange={setCouponOpen}>        <DialogContent className="rounded-2xl max-w-lg" data-testid="coupon-form-dialog">
          <DialogHeader>
            <DialogTitle className="font-display text-xl tracking-tight">Novo cupom</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Configure código, desconto e planos onde o cupom pode ser aplicado.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <F label="Código (ex.: LAUNCH20)"><Input value={couponForm.code} onChange={(e) => setCouponForm({ ...couponForm, code: e.target.value.toUpperCase() })} className="h-11 rounded-xl" data-testid="coupon-code" /></F>
            <div className="grid grid-cols-2 gap-3">
              <F label="Tipo">
                <select value={couponForm.kind} onChange={(e) => setCouponForm({ ...couponForm, kind: e.target.value })}
                  className="w-full h-11 rounded-xl border border-border bg-card px-3 text-sm" data-testid="coupon-kind">
                  <option value="percent">Porcentagem</option>
                  <option value="fixed">Valor fixo (R$)</option>
                </select>
              </F>
              <F label={couponForm.kind === "percent" ? "Valor (%)" : "Valor (R$)"}>
                <Input type="number" value={couponForm.value} onChange={(e) => setCouponForm({ ...couponForm, value: Number(e.target.value) })} className="h-11 rounded-xl" data-testid="coupon-value" />
              </F>
            </div>
            <F label="Planos aplicáveis">
              <div className="flex gap-2 flex-wrap">
                {["starter", "professional", "premium"].map((p) => (
                  <label key={p} className="flex items-center gap-1.5 text-xs cursor-pointer">
                    <input type="checkbox" checked={couponForm.applies_to.includes(p)}
                      onChange={(e) => {
                        const s = new Set(couponForm.applies_to);
                        if (e.target.checked) s.add(p); else s.delete(p);
                        setCouponForm({ ...couponForm, applies_to: [...s] });
                      }}
                      data-testid={`coupon-plan-${p}`} />
                    <span className="capitalize">{p}</span>
                  </label>
                ))}
              </div>
            </F>
            <div className="grid grid-cols-2 gap-3">
              <F label="Máximo de usos">
                <Input type="number" value={couponForm.max_uses || ""} onChange={(e) => setCouponForm({ ...couponForm, max_uses: e.target.value ? Number(e.target.value) : null })} className="h-11 rounded-xl" data-testid="coupon-max-uses" />
              </F>
              <F label="Validade (opcional)">
                <Input type="date" value={couponForm.valid_until} onChange={(e) => setCouponForm({ ...couponForm, valid_until: e.target.value })} className="h-11 rounded-xl" data-testid="coupon-valid-until" />
              </F>
            </div>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input type="checkbox" checked={couponForm.first_payment_only}
                onChange={(e) => setCouponForm({ ...couponForm, first_payment_only: e.target.checked })}
                data-testid="coupon-first-only" />
              Aplicar apenas no 1º pagamento
            </label>
            <Button onClick={createCoupon} className="w-full h-11 rounded-xl bg-primary text-primary-foreground" data-testid="coupon-save">
              Criar cupom
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function KPI({ icon: Icon, label, value, sub, testid }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5" data-testid={testid}>
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        <Icon className="h-3.5 w-3.5" strokeWidth={1.5} /> {label}
      </div>
      <div className="font-display text-3xl font-semibold tracking-tight mt-2">{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground mt-1">{sub}</div>}
    </div>
  );
}

function F({ label, children }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
