import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "@/lib/api";
import PageHeader from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import {
  Users, Calendar as CalendarIcon, TrendingUp, Cake, Activity,
  ArrowUpRight, CircleDot,
} from "lucide-react";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";

const STATUS_COLORS = {
  confirmado: "bg-success/15 text-success border border-success/30",
  agendado: "bg-primary/15 text-primary border border-primary/30",
  concluido: "bg-muted text-muted-foreground border border-border",
  cancelado: "bg-destructive/10 text-destructive border border-destructive/30",
};

function StatCard({ icon: Icon, label, value, trend, color = "primary", testid }) {
  return (
    <div
      data-testid={testid}
      className="group relative rounded-2xl border border-border bg-card p-6 hover:border-primary/40 transition-colors"
    >
      <div className="flex items-start justify-between">
        <div className={`h-10 w-10 rounded-xl bg-${color}/10 ring-1 ring-${color}/30 flex items-center justify-center`}>
          <Icon className={`h-4.5 w-4.5 text-${color}`} strokeWidth={1.5} />
        </div>
        {trend && (
          <div className="flex items-center gap-1 text-xs text-success">
            <ArrowUpRight className="h-3 w-3" /> {trend}
          </div>
        )}
      </div>
      <div className="mt-6">
        <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
        <div className="font-display text-3xl font-semibold tracking-tight mt-1.5">{value}</div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [finance, setFinance] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    (async () => {
      try {
        const [s, f] = await Promise.all([
          api.get("/dashboard/stats"),
          api.get("/finance/summary"),
        ]);
        setStats(s.data);
        setFinance(f.data);
      } catch (e) {
        console.error(e);
      }
    })();
  }, []);

  const brl = (n) => (n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  return (
    <div data-testid="dashboard-page">
      <PageHeader
        title="Painel executivo"
        subtitle={`Visão geral da clínica · ${format(new Date(), "EEEE, dd 'de' MMMM", { locale: ptBR })}`}
        testid="dashboard-header"
      />

      <div className="p-6 sm:p-8 space-y-8 animate-fade-up">
        {/* KPIs */}
        <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          <StatCard testid="kpi-revenue" icon={TrendingUp} label="Faturamento (mês)"
            value={brl(stats?.revenue_month)} trend="+12%" />
          <StatCard testid="kpi-appointments" icon={CalendarIcon} label="Atendimentos hoje"
            value={stats?.appointments_today ?? 0} />
          <StatCard testid="kpi-patients" icon={Users} label="Pacientes ativos"
            value={stats?.total_patients ?? 0} trend={`+${stats?.new_this_month ?? 0} este mês`} />
          <StatCard testid="kpi-occupancy" icon={Activity} label="Ocupação agenda"
            value={`${stats?.occupancy_pct ?? 0}%`} />
        </section>

        {/* Main grid */}
        <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Revenue chart */}
          <div className="lg:col-span-2 rounded-2xl border border-border bg-card p-6" data-testid="revenue-chart">
            <div className="flex items-end justify-between mb-6">
              <div>
                <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Receita x Despesa</div>
                <h3 className="font-display text-xl font-semibold tracking-tight mt-1">Fluxo dos últimos 6 meses</h3>
              </div>
              <Badge variant="outline" className="text-[11px] font-normal">
                Saldo {brl(finance?.saldo)}
              </Badge>
            </div>
            <div style={{ width: "100%", height: 260 }}>
              <ResponsiveContainer>
                <AreaChart data={finance?.chart || []}>
                  <defs>
                    <linearGradient id="grad-rev" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="grad-exp" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(var(--muted-foreground))" stopOpacity={0.25} />
                      <stop offset="100%" stopColor="hsl(var(--muted-foreground))" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="mes" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                  <Tooltip
                    contentStyle={{
                      background: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: 12, fontSize: 12,
                    }}
                    formatter={(v) => brl(v)}
                  />
                  <Area type="monotone" dataKey="receita" stroke="hsl(var(--primary))" strokeWidth={2} fill="url(#grad-rev)" />
                  <Area type="monotone" dataKey="despesa" stroke="hsl(var(--muted-foreground))" strokeWidth={2} fill="url(#grad-exp)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Birthdays */}
          <div className="rounded-2xl border border-border bg-card p-6" data-testid="birthdays-card">
            <div className="flex items-center gap-3 mb-5">
              <div className="h-9 w-9 rounded-xl bg-primary/10 ring-1 ring-primary/30 flex items-center justify-center">
                <Cake className="h-4 w-4 text-primary" strokeWidth={1.5} />
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Atenção especial</div>
                <h3 className="font-display text-lg font-semibold tracking-tight">Aniversariantes do mês</h3>
              </div>
            </div>
            <div className="space-y-3">
              {(stats?.birthdays || []).length === 0 && (
                <p className="text-sm text-muted-foreground">Nenhum aniversariante no mês.</p>
              )}
              {(stats?.birthdays || []).map((p) => (
                <div key={p.patient_id} className="flex items-center gap-3 py-2">
                  <div className="h-9 w-9 rounded-full bg-secondary/20 ring-1 ring-secondary/40 flex items-center justify-center text-xs font-semibold text-secondary">
                    {p.name?.[0]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{p.name}</div>
                    <div className="text-xs text-muted-foreground">{p.birth_date}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Agenda hoje + Top procedimentos */}
        <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 rounded-2xl border border-border bg-card p-6" data-testid="today-agenda">
            <div className="flex items-center justify-between mb-5">
              <div>
                <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Hoje</div>
                <h3 className="font-display text-xl font-semibold tracking-tight">Agenda do dia</h3>
              </div>
              <button
                onClick={() => navigate("/agenda")}
                data-testid="goto-agenda-btn"
                className="text-xs font-medium text-primary hover:underline"
              >
                Ver agenda completa →
              </button>
            </div>
            <div className="divide-y divide-border">
              {(stats?.today_agenda || []).length === 0 && (
                <p className="text-sm text-muted-foreground py-6">Nenhum atendimento marcado para hoje.</p>
              )}
              {(stats?.today_agenda || []).map((a) => (
                <div key={a.appointment_id} className="flex items-center gap-4 py-3.5">
                  <div className="text-sm font-mono w-14 text-muted-foreground">
                    {format(parseISO(a.start), "HH:mm")}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{a.patient_name}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {a.procedure} · {a.professional_name || "—"}
                    </div>
                  </div>
                  <span className={`text-[10px] uppercase tracking-wider px-2 py-1 rounded-full ${STATUS_COLORS[a.status] || STATUS_COLORS.agendado}`}>
                    {a.status}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-card p-6" data-testid="top-procedures">
            <div className="mb-5">
              <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Performance</div>
              <h3 className="font-display text-lg font-semibold tracking-tight">Top procedimentos</h3>
            </div>
            <div className="space-y-4">
              {(stats?.top_procedures || []).length === 0 && (
                <p className="text-sm text-muted-foreground">Sem dados.</p>
              )}
              {(stats?.top_procedures || []).map((p, i) => (
                <div key={p.name}>
                  <div className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2">
                      <CircleDot className="h-3 w-3 text-primary" />
                      {p.name}
                    </span>
                    <span className="text-muted-foreground font-mono text-xs">{p.count}</span>
                  </div>
                  <div className="mt-1.5 h-1.5 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full bg-primary"
                      style={{ width: `${(p.count / (stats.top_procedures[0]?.count || 1)) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
