import React, { useEffect, useState } from "react";
import api from "@/lib/api";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Plus, TrendingUp, TrendingDown, Wallet, Clock } from "lucide-react";
import { toast } from "sonner";
import { formatApiErrorDetail } from "@/lib/api";
import { format, parseISO } from "date-fns";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from "recharts";

export default function Financeiro() {
  const [entries, setEntries] = useState([]);
  const [summary, setSummary] = useState(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    type: "receita", category: "Procedimentos", description: "", amount: 0,
    due_date: format(new Date(), "yyyy-MM-dd"), paid: false, payment_method: "pix",
  });

  const load = async () => {
    const [e, s] = await Promise.all([api.get("/finance/entries"), api.get("/finance/summary")]);
    setEntries(e.data);
    setSummary(s.data);
  };
  useEffect(() => { load(); }, []);

  const brl = (n) => (n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  const onSubmit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post("/finance/entries", { ...form, amount: Number(form.amount) });
      toast.success("Lançamento criado");
      setOpen(false);
      setForm({ ...form, description: "", amount: 0 });
      await load();
    } catch (err) {
      toast.error(formatApiErrorDetail(err.response?.data?.detail) || err.message);
    } finally { setBusy(false); }
  };

  const togglePaid = async (entry) => {
    try {
      await api.put(`/finance/entries/${entry.entry_id}`, { ...entry, paid: !entry.paid });
      await load();
    } catch (err) { toast.error("Erro"); }
  };

  return (
    <div data-testid="finance-page">
      <PageHeader
        title="Financeiro"
        subtitle="Receitas, despesas e fluxo de caixa"
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button data-testid="new-entry-btn" className="rounded-xl bg-primary text-primary-foreground hover:bg-primary/90">
                <Plus className="h-4 w-4 mr-1.5" />Novo lançamento
              </Button>
            </DialogTrigger>
            <DialogContent className="rounded-2xl">
              <DialogHeader><DialogTitle className="font-display text-2xl tracking-tight">Novo lançamento</DialogTitle></DialogHeader>
              <form onSubmit={onSubmit} className="grid grid-cols-2 gap-4" data-testid="entry-form">
                <div className="space-y-1.5">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">Tipo</Label>
                  <select data-testid="entry-type" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}
                    className="w-full h-11 rounded-xl border border-border bg-card px-3 text-sm">
                    <option value="receita">Receita</option>
                    <option value="despesa">Despesa</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">Categoria</Label>
                  <Input data-testid="entry-category" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="h-11 rounded-xl" />
                </div>
                <div className="col-span-2 space-y-1.5">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">Descrição *</Label>
                  <Input required data-testid="entry-description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="h-11 rounded-xl" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">Valor (R$) *</Label>
                  <Input required type="number" step="0.01" data-testid="entry-amount" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className="h-11 rounded-xl" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">Vencimento</Label>
                  <Input type="date" data-testid="entry-due" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} className="h-11 rounded-xl" />
                </div>
                <div className="col-span-2 space-y-1.5">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">Forma de pagamento</Label>
                  <select data-testid="entry-method" value={form.payment_method} onChange={(e) => setForm({ ...form, payment_method: e.target.value })}
                    className="w-full h-11 rounded-xl border border-border bg-card px-3 text-sm">
                    <option value="pix">PIX</option>
                    <option value="cartão">Cartão</option>
                    <option value="dinheiro">Dinheiro</option>
                    <option value="boleto">Boleto</option>
                  </select>
                </div>
                <label className="col-span-2 flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={form.paid} onChange={(e) => setForm({ ...form, paid: e.target.checked })} data-testid="entry-paid" />
                  Já pago/recebido
                </label>
                <DialogFooter className="col-span-2">
                  <Button type="submit" disabled={busy} className="rounded-xl bg-primary text-primary-foreground hover:bg-primary/90" data-testid="entry-submit-btn">
                    {busy ? "Salvando..." : "Salvar"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        }
      />

      <div className="p-6 sm:p-8 space-y-6 animate-fade-up">
        {/* Summary cards */}
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { icon: TrendingUp, label: "Receitas pagas", value: brl(summary?.receitas), color: "text-success", ring: "ring-success/30 bg-success/10", testid: "sum-receitas" },
            { icon: TrendingDown, label: "Despesas pagas", value: brl(summary?.despesas), color: "text-destructive", ring: "ring-destructive/30 bg-destructive/10", testid: "sum-despesas" },
            { icon: Wallet, label: "Saldo", value: brl(summary?.saldo), color: "text-primary", ring: "ring-primary/30 bg-primary/10", testid: "sum-saldo" },
            { icon: Clock, label: "A receber", value: brl(summary?.a_receber), color: "text-secondary", ring: "ring-secondary/30 bg-secondary/10", testid: "sum-a-receber" },
          ].map((c) => (
            <div key={c.label} data-testid={c.testid} className="rounded-2xl border border-border bg-card p-6">
              <div className={`h-10 w-10 rounded-xl ring-1 ${c.ring} flex items-center justify-center`}>
                <c.icon className={`h-4.5 w-4.5 ${c.color}`} strokeWidth={1.5} />
              </div>
              <div className="mt-5">
                <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{c.label}</div>
                <div className="font-display text-2xl font-semibold tracking-tight mt-1">{c.value}</div>
              </div>
            </div>
          ))}
        </section>

        {/* Chart */}
        <section className="rounded-2xl border border-border bg-card p-6" data-testid="finance-chart">
          <h3 className="font-display text-xl font-semibold tracking-tight mb-5">Receitas x Despesas — 6 meses</h3>
          <div style={{ width: "100%", height: 280, minHeight: 280 }}>
            <ResponsiveContainer minWidth={280}>
              <BarChart data={summary?.chart || []}>
                <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="mes" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 12, fontSize: 12 }} formatter={(v) => brl(v)} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="receita" fill="hsl(var(--primary))" radius={[6, 6, 0, 0]} />
                <Bar dataKey="despesa" fill="hsl(var(--muted-foreground))" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        {/* Entries list */}
        <section className="rounded-2xl border border-border bg-card overflow-hidden" data-testid="entries-list">
          <div className="px-6 py-4 border-b border-border">
            <h3 className="font-display text-lg font-semibold tracking-tight">Lançamentos</h3>
          </div>
          <div className="divide-y divide-border">
            {entries.length === 0 && <p className="p-8 text-center text-sm text-muted-foreground">Nenhum lançamento.</p>}
            {entries.map((e) => (
              <div key={e.entry_id} data-testid={`entry-${e.entry_id}`} className="flex items-center gap-4 px-6 py-4">
                <div className={`h-2 w-2 rounded-full ${e.type === "receita" ? "bg-success" : "bg-destructive"}`} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{e.description}</div>
                  <div className="text-xs text-muted-foreground">{e.category} · vence {e.due_date}</div>
                </div>
                <div className={`text-sm font-mono ${e.type === "receita" ? "text-success" : "text-destructive"}`}>
                  {e.type === "receita" ? "+" : "-"} {brl(e.amount)}
                </div>
                <Badge
                  onClick={() => togglePaid(e)}
                  className={`cursor-pointer ${e.paid ? "bg-success/15 text-success border-success/30" : "bg-muted text-muted-foreground border-border"}`}
                  data-testid={`toggle-paid-${e.entry_id}`}
                >
                  {e.paid ? "Pago" : "Pendente"}
                </Badge>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
