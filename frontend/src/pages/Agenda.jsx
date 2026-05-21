import React, { useEffect, useMemo, useState } from "react";
import api from "@/lib/api";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import {
  startOfWeek, addDays, format, addWeeks, subWeeks,
  parseISO, isSameDay, setHours, setMinutes,
} from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";
import { formatApiErrorDetail } from "@/lib/api";

const HOURS = Array.from({ length: 12 }, (_, i) => 8 + i); // 8h..19h
const STATUS_STYLES = {
  confirmado: "bg-success/15 text-success border-l-success",
  agendado: "bg-primary/10 text-primary border-l-primary",
  concluido: "bg-muted text-muted-foreground border-l-muted-foreground",
  cancelado: "bg-destructive/10 text-destructive border-l-destructive line-through",
  encaixe: "bg-secondary/20 text-secondary border-l-secondary",
};
const PROCEDURES = [
  "Botox", "Preenchimento Labial", "Bioestimulador", "Ultraformer",
  "Limpeza de Pele", "Microagulhamento", "Harmonização Facial",
  "Laser Facial", "Criolipólise", "Depilação a Laser",
];

export default function Agenda() {
  const [weekStart, setWeekStart] = useState(startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [appointments, setAppointments] = useState([]);
  const [patients, setPatients] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    patient_id: "", procedure: "Botox", start_date: format(new Date(), "yyyy-MM-dd"),
    start_time: "09:00", duration: 60, professional_name: "Dra. Bella Castro",
    status: "agendado", room: "Sala 1", price: 0,
  });
  const [busy, setBusy] = useState(false);

  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart]
  );

  const load = async () => {
    const start = format(weekStart, "yyyy-MM-dd");
    const end = format(addDays(weekStart, 7), "yyyy-MM-dd");
    const [apt, pts] = await Promise.all([
      api.get("/appointments", { params: { start, end: end + "T23:59:59" } }),
      api.get("/patients"),
    ]);
    setAppointments(apt.data);
    setPatients(pts.data);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [weekStart]);

  const itemsByDay = useMemo(() => {
    const map = {};
    appointments.forEach((a) => {
      const d = format(parseISO(a.start), "yyyy-MM-dd");
      (map[d] = map[d] || []).push(a);
    });
    return map;
  }, [appointments]);

  const onCreate = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const [h, m] = form.start_time.split(":").map(Number);
      const startDate = setMinutes(setHours(parseISO(form.start_date), h), m);
      const endDate = new Date(startDate.getTime() + form.duration * 60000);
      await api.post("/appointments", {
        patient_id: form.patient_id,
        procedure: form.procedure,
        professional_name: form.professional_name,
        start: startDate.toISOString(),
        end: endDate.toISOString(),
        status: form.status,
        room: form.room,
        price: Number(form.price) || 0,
      });
      toast.success("Atendimento agendado");
      setOpen(false);
      await load();
    } catch (err) {
      toast.error(formatApiErrorDetail(err.response?.data?.detail) || err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-testid="agenda-page">
      <PageHeader
        title="Agenda"
        subtitle={`${format(weekStart, "dd 'de' MMM", { locale: ptBR })} – ${format(addDays(weekStart, 6), "dd 'de' MMM yyyy", { locale: ptBR })}`}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" className="rounded-xl" onClick={() => setWeekStart(subWeeks(weekStart, 1))} data-testid="prev-week-btn">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" className="rounded-xl" onClick={() => setWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }))} data-testid="today-btn">
              Hoje
            </Button>
            <Button variant="outline" size="icon" className="rounded-xl" onClick={() => setWeekStart(addWeeks(weekStart, 1))} data-testid="next-week-btn">
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button data-testid="new-appointment-btn" className="rounded-xl bg-primary text-primary-foreground hover:bg-primary/90">
                  <Plus className="h-4 w-4 mr-1.5" /> Novo
                </Button>
              </DialogTrigger>
              <DialogContent className="rounded-2xl">
                <DialogHeader><DialogTitle className="font-display text-2xl tracking-tight">Novo atendimento</DialogTitle></DialogHeader>
                <form onSubmit={onCreate} className="grid grid-cols-2 gap-4" data-testid="appointment-form">
                  <div className="col-span-2 space-y-1.5">
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground">Paciente *</Label>
                    <select required data-testid="form-patient" value={form.patient_id}
                      onChange={(e) => setForm({ ...form, patient_id: e.target.value })}
                      className="w-full h-11 rounded-xl border border-border bg-card px-3 text-sm">
                      <option value="">Selecione...</option>
                      {patients.map((p) => <option key={p.patient_id} value={p.patient_id}>{p.name}</option>)}
                    </select>
                  </div>
                  <div className="col-span-2 space-y-1.5">
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground">Procedimento *</Label>
                    <select required data-testid="form-procedure" value={form.procedure}
                      onChange={(e) => setForm({ ...form, procedure: e.target.value })}
                      className="w-full h-11 rounded-xl border border-border bg-card px-3 text-sm">
                      {PROCEDURES.map((p) => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground">Data</Label>
                    <Input type="date" data-testid="form-date" value={form.start_date}
                      onChange={(e) => setForm({ ...form, start_date: e.target.value })} className="h-11 rounded-xl" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground">Horário</Label>
                    <Input type="time" data-testid="form-time" value={form.start_time}
                      onChange={(e) => setForm({ ...form, start_time: e.target.value })} className="h-11 rounded-xl" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground">Duração (min)</Label>
                    <Input type="number" data-testid="form-duration" value={form.duration}
                      onChange={(e) => setForm({ ...form, duration: e.target.value })} className="h-11 rounded-xl" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground">Valor (R$)</Label>
                    <Input type="number" data-testid="form-price" value={form.price}
                      onChange={(e) => setForm({ ...form, price: e.target.value })} className="h-11 rounded-xl" />
                  </div>
                  <div className="col-span-2 space-y-1.5">
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground">Status</Label>
                    <select data-testid="form-status" value={form.status}
                      onChange={(e) => setForm({ ...form, status: e.target.value })}
                      className="w-full h-11 rounded-xl border border-border bg-card px-3 text-sm">
                      <option value="agendado">Agendado</option>
                      <option value="confirmado">Confirmado</option>
                      <option value="encaixe">Encaixe</option>
                      <option value="concluido">Concluído</option>
                    </select>
                  </div>
                  <DialogFooter className="col-span-2">
                    <Button type="submit" disabled={busy} className="rounded-xl bg-primary text-primary-foreground hover:bg-primary/90" data-testid="appointment-submit-btn">
                      {busy ? "Salvando..." : "Agendar"}
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          </div>
        }
      />

      <div className="p-6 sm:p-8 animate-fade-up">
        <div className="rounded-2xl border border-border bg-card overflow-hidden">
          {/* Header days */}
          <div className="grid grid-cols-[60px_repeat(7,1fr)] border-b border-border bg-muted/30">
            <div />
            {days.map((d) => (
              <div key={d.toISOString()} className={`px-3 py-3 text-center border-l border-border ${isSameDay(d, new Date()) ? "bg-primary/5" : ""}`}>
                <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                  {format(d, "EEE", { locale: ptBR })}
                </div>
                <div className={`font-display text-lg font-semibold ${isSameDay(d, new Date()) ? "text-primary" : ""}`}>
                  {format(d, "dd")}
                </div>
              </div>
            ))}
          </div>
          {/* Hours grid */}
          <div className="grid grid-cols-[60px_repeat(7,1fr)]">
            {HOURS.map((h) => (
              <React.Fragment key={h}>
                <div className="text-[11px] text-muted-foreground text-right pr-2 pt-1 border-t border-border h-20">
                  {String(h).padStart(2, "0")}:00
                </div>
                {days.map((d) => {
                  const key = format(d, "yyyy-MM-dd");
                  const items = (itemsByDay[key] || []).filter((a) => parseISO(a.start).getHours() === h);
                  return (
                    <div key={d.toISOString() + h} className="border-t border-l border-border h-20 p-1 relative">
                      {items.map((a) => (
                        <div
                          key={a.appointment_id}
                          data-testid={`apt-block-${a.appointment_id}`}
                          className={`px-2 py-1 rounded-md border-l-2 text-[11px] leading-tight mb-1 ${STATUS_STYLES[a.status] || STATUS_STYLES.agendado}`}
                        >
                          <div className="font-medium truncate">{a.patient_name}</div>
                          <div className="opacity-75 truncate">{format(parseISO(a.start), "HH:mm")} · {a.procedure}</div>
                        </div>
                      ))}
                    </div>
                  );
                })}
              </React.Fragment>
            ))}
          </div>
        </div>

        {/* Legend */}
        <div className="mt-4 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5"><div className="h-2.5 w-2.5 rounded-full bg-success" /> Confirmado</span>
          <span className="flex items-center gap-1.5"><div className="h-2.5 w-2.5 rounded-full bg-primary" /> Agendado</span>
          <span className="flex items-center gap-1.5"><div className="h-2.5 w-2.5 rounded-full bg-secondary" /> Encaixe</span>
          <span className="flex items-center gap-1.5"><div className="h-2.5 w-2.5 rounded-full bg-muted-foreground" /> Concluído</span>
          <span className="flex items-center gap-1.5"><div className="h-2.5 w-2.5 rounded-full bg-destructive" /> Cancelado</span>
        </div>
      </div>
    </div>
  );
}
