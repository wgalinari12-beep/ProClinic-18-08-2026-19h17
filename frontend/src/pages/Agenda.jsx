import React, { useEffect, useMemo, useState } from "react";
import api from "@/lib/api";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { ChevronLeft, ChevronRight, Plus, Play, X, Trash2, Pencil, Phone, MessageSquare, Loader2, Copy, Link as LinkIcon } from "lucide-react";
import {
  startOfWeek, addDays, format, addWeeks, subWeeks,
  parseISO, isSameDay, setHours, setMinutes, differenceInMinutes,
  addMinutes,
} from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";
import { formatApiErrorDetail } from "@/lib/api";
import {
  DndContext, useDraggable, useDroppable,
  PointerSensor, useSensor, useSensors, DragOverlay,
} from "@dnd-kit/core";
import AttendanceDialog from "@/components/AttendanceDialog";

const HOURS = Array.from({ length: 12 }, (_, i) => 8 + i); // 8h..19h
const SLOT_HEIGHT = 80; // px per hour
const PROCEDURES = [
  "Botox", "Preenchimento Labial", "Bioestimulador", "Ultraformer",
  "Limpeza de Pele", "Microagulhamento", "Harmonização Facial",
  "Laser Facial", "Criolipólise", "Depilação a Laser",
];

const STATUS_STYLES = {
  confirmado: { bg: "bg-success/15", text: "text-success", border: "border-l-success" },
  agendado: { bg: "bg-primary/10", text: "text-primary", border: "border-l-primary" },
  concluido: { bg: "bg-muted", text: "text-muted-foreground", border: "border-l-muted-foreground" },
  cancelado: { bg: "bg-destructive/10", text: "text-destructive", border: "border-l-destructive" },
  encaixe: { bg: "bg-secondary/20", text: "text-secondary", border: "border-l-secondary" },
};

// ============================================================
// Draggable appointment block
// ============================================================
function ApptBlock({ appointment, onClick, dragging }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: appointment.appointment_id,
    data: { appointment },
  });

  const start = parseISO(appointment.start);
  const end = parseISO(appointment.end);
  const duration = Math.max(15, differenceInMinutes(end, start));
  const top = (start.getMinutes() / 60) * SLOT_HEIGHT;
  const height = (duration / 60) * SLOT_HEIGHT - 4;

  const proColor = appointment.professional_color || "#B76E79";
  const style = {
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    top: `${top}px`,
    height: `${height}px`,
    opacity: isDragging ? 0.4 : 1,
    zIndex: isDragging ? 50 : 1,
    borderLeftColor: proColor,
    boxShadow: `inset 3px 0 0 ${proColor}`,
  };

  const st = STATUS_STYLES[appointment.status] || STATUS_STYLES.agendado;

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-testid={`apt-block-${appointment.appointment_id}`}
      className={`absolute left-1 right-1 rounded-lg border-l-[3px] px-2 py-1 text-[11px] cursor-grab active:cursor-grabbing select-none overflow-hidden ${st.bg} ${st.text}`}
      onClick={(e) => {
        // Prevent click during drag; ignore if was dragging
        if (!isDragging && !dragging) {
          e.stopPropagation();
          onClick(appointment);
        }
      }}
      {...listeners}
      {...attributes}
    >
      <div className="font-medium truncate pointer-events-none">{appointment.patient_name}</div>
      <div className="opacity-75 truncate text-[10px] pointer-events-none">
        {format(start, "HH:mm")} · {appointment.procedure}
      </div>
    </div>
  );
}

// ============================================================
// Droppable cell — week view (day + hour)
// ============================================================
function DayHourCell({ day, hour, children, onEmptyClick }) {
  const dropId = `${format(day, "yyyy-MM-dd")}_${hour}`;
  const { setNodeRef, isOver } = useDroppable({
    id: dropId,
    data: { day: format(day, "yyyy-MM-dd"), hour },
  });
  return (
    <div
      ref={setNodeRef}
      data-testid={`agenda-cell-${dropId}`}
      onClick={() => onEmptyClick(day, hour)}
      className={`border-t border-l border-border relative cursor-pointer transition-colors ${isOver ? "bg-primary/5" : ""}`}
      style={{ height: SLOT_HEIGHT }}
    >
      {children}
    </div>
  );
}

// ============================================================
// Droppable cell — by-professional view (pro + hour on a fixed day)
// ============================================================
function ProHourCell({ day, hour, pro, children, onEmptyClick }) {
  const dropId = `pro_${pro.user_id}_${format(day, "yyyy-MM-dd")}_${hour}`;
  const { setNodeRef, isOver } = useDroppable({
    id: dropId,
    data: { day: format(day, "yyyy-MM-dd"), hour, professional_id: pro.user_id },
  });
  return (
    <div
      ref={setNodeRef}
      data-testid={`agenda-procell-${pro.user_id}-${hour}`}
      onClick={() => onEmptyClick(day, hour, pro)}
      className={`border-t border-l border-border relative cursor-pointer transition-colors ${isOver ? "bg-primary/5" : ""}`}
      style={{ height: SLOT_HEIGHT }}
    >
      {children}
    </div>
  );
}

// ============================================================
// Main Agenda
// ============================================================
export default function Agenda() {
  const [weekStart, setWeekStart] = useState(startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [appointments, setAppointments] = useState([]);
  const [patients, setPatients] = useState([]);
  const [procedures, setProcedures] = useState([]);
  const [professionals, setProfessionals] = useState([]);
  const [showPreReg, setShowPreReg] = useState(false);
  const [preReg, setPreReg] = useState({ name: "", phone: "" });
  const [preRegBusy, setPreRegBusy] = useState(false);

  // Dialog state — single source of truth (prevents multiple modals)
  const [dialogMode, setDialogMode] = useState(null); // 'new' | 'detail' | null
  const [selected, setSelected] = useState(null);
  const [attendance, setAttendance] = useState({ open: false, appointment: null });

  const [newForm, setNewForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [viewMode, setViewMode] = useState("all"); // 'all' | 'by-professional'

  // dnd-kit
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const [activeDrag, setActiveDrag] = useState(null);
  const dragging = !!activeDrag;

  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart]
  );

  const load = async () => {
    const start = format(weekStart, "yyyy-MM-dd");
    const end = format(addDays(weekStart, 7), "yyyy-MM-dd");
    const [apt, pts, procs, profs] = await Promise.all([
      api.get("/appointments", { params: { start, end: end + "T23:59:59" } }),
      api.get("/patients"),
      api.get("/procedures", { params: { active_only: true } }),
      api.get("/users/professionals-public").catch(() => ({ data: [] })),
    ]);
    setAppointments(apt.data);
    setPatients(pts.data);
    setProcedures(procs.data);
    setProfessionals(profs.data || []);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [weekStart]);

  // === Cell click → open new appointment ===
  const onEmptyClick = (day, hour, forcedPro = null) => {
    if (dragging) return;
    if (dialogMode) return; // prevent multiple modals
    const dateStr = format(day, "yyyy-MM-dd");
    const defaultPro = forcedPro || professionals[0];
    setNewForm({
      patient_id: "", procedure: "Botox", start_date: dateStr,
      start_time: `${String(hour).padStart(2, "0")}:00`, duration: 60,
      professional_id: defaultPro?.user_id || "",
      professional_name: defaultPro?.name || "Dra. Bella Castro",
      professional_color: defaultPro?.color || "#B76E79",
      status: "agendado",
      room: "Sala 1", price: 0, notes: "",
    });
    setDialogMode("new");
  };

  // === Apt block click → open detail ===
  const onApptClick = (apt) => {
    if (dragging) return;
    if (dialogMode) return;
    setSelected(apt);
    setDialogMode("detail");
  };

  // === DnD handlers ===
  const onDragStart = (event) => {
    setActiveDrag(event.active.data.current?.appointment || null);
  };
  const onDragEnd = async (event) => {
    const { active, over } = event;
    setActiveDrag(null);
    if (!over) return;
    const apt = active.data.current?.appointment;
    if (!apt) return;
    const { day, hour, professional_id: dropProId } = over.data.current || {};
    if (!day || hour == null) return;
    // Compute new start/end preserving duration
    const oldStart = parseISO(apt.start);
    const oldEnd = parseISO(apt.end);
    const minutes = differenceInMinutes(oldEnd, oldStart);
    const newStart = setMinutes(setHours(parseISO(day), hour), oldStart.getMinutes());
    const newEnd = addMinutes(newStart, minutes);
    // Determine new professional (may change in by-pro view)
    let newProId = apt.professional_id;
    let newProName = apt.professional_name;
    let newProColor = apt.professional_color;
    if (dropProId && dropProId !== apt.professional_id) {
      const np = professionals.find((p) => p.user_id === dropProId);
      if (np) {
        newProId = np.user_id;
        newProName = np.name;
        newProColor = np.color;
      }
    }
    const sameSlot = isSameDay(newStart, oldStart) && newStart.getHours() === oldStart.getHours();
    if (sameSlot && newProId === apt.professional_id) return;
    try {
      await api.put(`/appointments/${apt.appointment_id}`, {
        patient_id: apt.patient_id,
        professional_id: newProId,
        professional_name: newProName,
        professional_color: newProColor,
        procedure: apt.procedure,
        start: newStart.toISOString(),
        end: newEnd.toISOString(),
        status: apt.status,
        room: apt.room,
        notes: apt.notes,
        price: apt.price || 0,
      });
      toast.success("Atendimento movido");
      await load();
    } catch (e) {
      toast.error("Erro ao mover");
    }
  };

  // === Save new ===
  const createAppointment = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const [h, m] = newForm.start_time.split(":").map(Number);
      const startDate = setMinutes(setHours(parseISO(newForm.start_date), h), m);
      const proc = procedures.find((p) => p.name === newForm.procedure);
      const dur = proc?.duration_minutes || Number(newForm.duration) || 60;
      const endDate = new Date(startDate.getTime() + dur * 60000);
      await api.post("/appointments", {
        patient_id: newForm.patient_id,
        procedure: newForm.procedure,
        professional_id: newForm.professional_id || null,
        professional_name: newForm.professional_name,
        professional_color: newForm.professional_color,
        start: startDate.toISOString(),
        end: endDate.toISOString(),
        status: newForm.status,
        room: newForm.room,
        notes: newForm.notes,
        price: Number(newForm.price ?? proc?.price ?? 0),
      });
      toast.success("Agendado");
      closeDialog();
      await load();
    } catch (err) {
      toast.error(formatApiErrorDetail(err.response?.data?.detail) || err.message);
    } finally { setBusy(false); }
  };

  // Pre-register patient inline
  const savePreReg = async () => {
    if (!preReg.name.trim() || !preReg.phone.trim()) {
      toast.error("Nome e telefone são obrigatórios");
      return;
    }
    setPreRegBusy(true);
    try {
      const { data } = await api.post("/patients", {
        name: preReg.name.trim(),
        phone: preReg.phone.trim(),
        is_pre_registered: true,
      });
      setPatients((p) => [data, ...p]);
      setNewForm((f) => ({ ...f, patient_id: data.patient_id }));
      setShowPreReg(false);
      setPreReg({ name: "", phone: "" });
      toast.success("Pré-cadastro criado");
    } catch (err) {
      toast.error(formatApiErrorDetail(err.response?.data?.detail) || err.message);
    } finally { setPreRegBusy(false); }
  };

  // === Detail actions ===
  const updateStatus = async (status) => {
    if (!selected) return;
    try {
      await api.put(`/appointments/${selected.appointment_id}`, {
        patient_id: selected.patient_id,
        professional_id: selected.professional_id,
        professional_name: selected.professional_name,
        professional_color: selected.professional_color,
        procedure: selected.procedure,
        start: selected.start, end: selected.end,
        status, room: selected.room, notes: selected.notes, price: selected.price || 0,
      });
      toast.success(`Status: ${status}`);
      closeDialog();
      await load();
    } catch { toast.error("Erro"); }
  };

  const deleteAppointment = async () => {
    if (!selected) return;
    if (!window.confirm("Excluir este agendamento?")) return;
    try {
      await api.delete(`/appointments/${selected.appointment_id}`);
      toast.success("Excluído");
      closeDialog();
      await load();
    } catch { toast.error("Erro"); }
  };

  const startAttendance = () => {
    const apt = selected;
    closeDialog();
    // brief defer so dialog unmounts cleanly
    setTimeout(() => setAttendance({ open: true, appointment: apt }), 50);
  };

  const sendWhatsappConfirmation = async () => {
    if (!selected) return;
    try {
      // 1. generate public confirmation link
      const { data: linkData } = await api.get(`/appointments/${selected.appointment_id}/confirmation-link`);
      const url = `${window.location.origin}/confirmacao/${linkData.token}`;
      // 2. enqueue message with the link
      await api.post("/messages", {
        patient_id: selected.patient_id,
        channel: "whatsapp",
        template: "confirmation",
        body: `Olá ${selected.patient_name}! Confirme seu agendamento de ${selected.procedure} em ${format(parseISO(selected.start), "dd/MM 'às' HH:mm", { locale: ptBR })}: ${url}`,
      });
      // 3. open WhatsApp web with the message pre-filled
      const phone = (selected.patient_whatsapp || "").replace(/\D/g, "");
      const text = encodeURIComponent(
        `Olá ${selected.patient_name}! Confirme seu agendamento: ${url}`
      );
      const waUrl = phone
        ? `https://wa.me/${phone}?text=${text}`
        : `https://wa.me/?text=${text}`;
      window.open(waUrl, "_blank", "noopener,noreferrer");
      toast.success("WhatsApp aberto");
    } catch { toast.error("Erro ao gerar link"); }
  };

  const closeDialog = () => {
    setDialogMode(null);
    setSelected(null);
    setNewForm(null);
  };

  const apptsByDayHour = useMemo(() => {
    const m = {};
    appointments.forEach((a) => {
      const d = format(parseISO(a.start), "yyyy-MM-dd");
      const h = parseISO(a.start).getHours();
      const k = `${d}_${h}`;
      (m[k] = m[k] || []).push(a);
    });
    return m;
  }, [appointments]);

  // For "by-professional" view: index by professional_id + hour for a single day
  const apptsByProHour = useMemo(() => {
    const m = {};
    const dayKey = format(weekStart, "yyyy-MM-dd");
    appointments.forEach((a) => {
      const d = format(parseISO(a.start), "yyyy-MM-dd");
      if (d !== dayKey) return;
      const h = parseISO(a.start).getHours();
      const k = `${a.professional_id || "_none"}_${h}`;
      (m[k] = m[k] || []).push(a);
    });
    return m;
  }, [appointments, weekStart]);

  return (
    <div data-testid="agenda-page">
      <PageHeader
        title="Agenda"
        subtitle={`${format(weekStart, "dd 'de' MMM", { locale: ptBR })} – ${format(addDays(weekStart, 6), "dd 'de' MMM yyyy", { locale: ptBR })}`}
        actions={
          <div className="flex items-center gap-2">
            {professionals.length > 1 && (
              <div className="flex items-center rounded-xl border border-border bg-card p-0.5" data-testid="view-mode-toggle">
                <button
                  data-testid="view-mode-all"
                  onClick={() => setViewMode("all")}
                  className={`text-[11px] px-3 py-1.5 rounded-lg transition-colors ${viewMode === "all" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>
                  Todas
                </button>
                <button
                  data-testid="view-mode-bypro"
                  onClick={() => setViewMode("by-professional")}
                  className={`text-[11px] px-3 py-1.5 rounded-lg transition-colors ${viewMode === "by-professional" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>
                  Por profissional
                </button>
              </div>
            )}
            <Button variant="outline" size="icon" className="rounded-xl" onClick={() => setWeekStart(subWeeks(weekStart, 1))} data-testid="prev-week-btn">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" className="rounded-xl" onClick={() => setWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }))} data-testid="today-btn">
              Hoje
            </Button>
            <Button variant="outline" size="icon" className="rounded-xl" onClick={() => setWeekStart(addWeeks(weekStart, 1))} data-testid="next-week-btn">
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button
              data-testid="new-appointment-btn"
              onClick={() => {
                if (dialogMode) return;
                const today = format(new Date(), "yyyy-MM-dd");
                const defaultPro = professionals[0];
                setNewForm({
                  patient_id: "", procedure: "Botox", start_date: today,
                  start_time: "09:00", duration: 60,
                  professional_id: defaultPro?.user_id || "",
                  professional_name: defaultPro?.name || "Dra. Bella Castro",
                  professional_color: defaultPro?.color || "#B76E79",
                  status: "agendado", room: "Sala 1", price: 0, notes: "",
                });
                setDialogMode("new");
              }}
              className="rounded-xl bg-primary text-primary-foreground hover:bg-primary/90"
            >
              <Plus className="h-4 w-4 mr-1.5" /> Novo
            </Button>
          </div>
        }
      />

      <div className="p-6 sm:p-8 animate-fade-up">
        <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
          {viewMode === "all" ? (
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

            {/* Grid */}
            <div className="grid grid-cols-[60px_repeat(7,1fr)]">
              {HOURS.map((h) => (
                <React.Fragment key={h}>
                  <div className="text-[11px] text-muted-foreground text-right pr-2 pt-1 border-t border-border" style={{ height: SLOT_HEIGHT }}>
                    {String(h).padStart(2, "0")}:00
                  </div>
                  {days.map((d) => {
                    const k = `${format(d, "yyyy-MM-dd")}_${h}`;
                    const items = apptsByDayHour[k] || [];
                    return (
                      <DayHourCell key={k} day={d} hour={h} onEmptyClick={onEmptyClick}>
                        {items.map((a) => (
                          <ApptBlock key={a.appointment_id} appointment={a} onClick={onApptClick} dragging={dragging} />
                        ))}
                      </DayHourCell>
                    );
                  })}
                </React.Fragment>
              ))}
            </div>
          </div>
          ) : (
          /* By-professional view: single day × N professionals */
          <div className="rounded-2xl border border-border bg-card overflow-hidden" data-testid="agenda-bypro-grid">
            <div className="px-4 py-3 border-b border-border bg-muted/30 flex items-center justify-between">
              <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                {format(weekStart, "EEEE, dd 'de' MMMM yyyy", { locale: ptBR })}
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="icon" className="h-7 w-7 rounded-lg" onClick={() => setWeekStart(addDays(weekStart, -1))} data-testid="prev-day-btn">
                  <ChevronLeft className="h-3.5 w-3.5" />
                </Button>
                <Button variant="outline" size="icon" className="h-7 w-7 rounded-lg" onClick={() => setWeekStart(addDays(weekStart, 1))} data-testid="next-day-btn">
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
            {/* Pro header */}
            <div className="grid border-b border-border bg-muted/20"
              style={{ gridTemplateColumns: `60px repeat(${professionals.length}, 1fr)` }}>
              <div />
              {professionals.map((p) => (
                <div key={p.user_id} className="px-3 py-3 text-center border-l border-border">
                  <div className="flex items-center justify-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: p.color || "#B76E79" }} />
                    <div className="font-display text-sm font-semibold tracking-tight truncate" title={p.name}>{p.name}</div>
                  </div>
                  {p.specialty && <div className="text-[10px] uppercase tracking-wider text-muted-foreground mt-0.5 truncate">{p.specialty}</div>}
                </div>
              ))}
            </div>
            {/* Grid hours × pros */}
            <div className="grid" style={{ gridTemplateColumns: `60px repeat(${professionals.length}, 1fr)` }}>
              {HOURS.map((h) => (
                <React.Fragment key={h}>
                  <div className="text-[11px] text-muted-foreground text-right pr-2 pt-1 border-t border-border" style={{ height: SLOT_HEIGHT }}>
                    {String(h).padStart(2, "0")}:00
                  </div>
                  {professionals.map((p) => {
                    const k = `${p.user_id}_${h}`;
                    const items = apptsByProHour[k] || [];
                    return (
                      <ProHourCell key={`${p.user_id}_${h}`} day={weekStart} hour={h} pro={p} onEmptyClick={onEmptyClick}>
                        {items.map((a) => (
                          <ApptBlock key={a.appointment_id} appointment={a} onClick={onApptClick} dragging={dragging} />
                        ))}
                      </ProHourCell>
                    );
                  })}
                </React.Fragment>
              ))}
            </div>
          </div>
          )}

          <DragOverlay>
            {activeDrag ? (
              <div
                className="rounded-lg bg-card border-l-[3px] px-2 py-1 text-[11px] shadow-xl"
                style={{ borderLeftColor: activeDrag.professional_color || "#B76E79", boxShadow: `inset 3px 0 0 ${activeDrag.professional_color || "#B76E79"}` }}
              >
                <div className="font-medium">{activeDrag.patient_name}</div>
                <div className="opacity-75 text-[10px]">{activeDrag.procedure}</div>
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>

        {/* Legend */}
        <div className="mt-4 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5"><div className="h-2.5 w-2.5 rounded-full bg-success" /> Confirmado</span>
          <span className="flex items-center gap-1.5"><div className="h-2.5 w-2.5 rounded-full bg-primary" /> Agendado</span>
          <span className="flex items-center gap-1.5"><div className="h-2.5 w-2.5 rounded-full bg-secondary" /> Encaixe</span>
          <span className="flex items-center gap-1.5"><div className="h-2.5 w-2.5 rounded-full bg-muted-foreground" /> Concluído</span>
          <span className="flex items-center gap-1.5"><div className="h-2.5 w-2.5 rounded-full bg-destructive" /> Cancelado</span>
          <span className="ml-auto italic">Arraste para mover · Clique no card para detalhes · Clique em célula vazia para criar</span>
        </div>

        {professionals.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground" data-testid="professionals-legend">
            <span className="text-[10px] uppercase tracking-[0.18em] mr-1">Profissionais:</span>
            {professionals.map((p) => (
              <span key={p.user_id} className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full ring-1 ring-border" style={{ backgroundColor: p.color || "#B76E79" }} />
                {p.name}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* New appointment dialog */}
      <Dialog open={dialogMode === "new"} onOpenChange={(o) => { if (!o) closeDialog(); }}>
        <DialogContent className="rounded-2xl">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl tracking-tight">Novo atendimento</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">Agende um novo procedimento</DialogDescription>
          </DialogHeader>
          {newForm && (
            <form onSubmit={createAppointment} className="grid grid-cols-2 gap-4" data-testid="appointment-form">
              <div className="col-span-2 space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">Paciente *</Label>
                  <button
                    type="button"
                    onClick={() => setShowPreReg(true)}
                    data-testid="open-prereg-btn"
                    className="text-[11px] text-primary hover:underline font-medium"
                  >
                    + Novo paciente
                  </button>
                </div>
                <select required data-testid="form-patient" value={newForm.patient_id}
                  onChange={(e) => setNewForm({ ...newForm, patient_id: e.target.value })}
                  className="w-full h-11 rounded-xl border border-border bg-card px-3 text-sm">
                  <option value="">Selecione...</option>
                  {patients.map((p) => (
                    <option key={p.patient_id} value={p.patient_id}>
                      {p.name}{p.is_pre_registered ? " · pré-cadastro" : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Procedimento *</Label>
                <select required data-testid="form-procedure" value={newForm.procedure}
                  onChange={(e) => {
                    const v = e.target.value;
                    const p = procedures.find((x) => x.name === v);
                    setNewForm({
                      ...newForm,
                      procedure: v,
                      duration: p?.duration_minutes || newForm.duration,
                      price: p?.price ?? newForm.price,
                    });
                  }}
                  className="w-full h-11 rounded-xl border border-border bg-card px-3 text-sm">
                  {procedures.length === 0 && (
                    PROCEDURES.map((p) => <option key={p} value={p}>{p}</option>)
                  )}
                  {procedures.map((p) => (
                    <option key={p.procedure_id} value={p.name}>{p.name}</option>
                  ))}
                </select>
                {procedures.length === 0 && (
                  <p className="text-[11px] text-muted-foreground/80">
                    💡 Cadastre seus procedimentos em "Procedimentos" para preenchimento automático de valor e duração.
                  </p>
                )}
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Profissional *</Label>
                <select required data-testid="form-professional" value={newForm.professional_id}
                  onChange={(e) => {
                    const pro = professionals.find((x) => x.user_id === e.target.value);
                    setNewForm({
                      ...newForm,
                      professional_id: e.target.value,
                      professional_name: pro?.name || "",
                      professional_color: pro?.color || "#B76E79",
                    });
                  }}
                  className="w-full h-11 rounded-xl border border-border bg-card px-3 text-sm">
                  <option value="">Selecione...</option>
                  {professionals.map((p) => (
                    <option key={p.user_id} value={p.user_id}>
                      {p.name}{p.specialty ? ` · ${p.specialty}` : ""}
                    </option>
                  ))}
                </select>
                {professionals.length === 0 && (
                  <p className="text-[11px] text-muted-foreground/80">
                    💡 Cadastre profissionais em "Equipe" para selecioná-los aqui.
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Data</Label>
                <Input type="date" data-testid="form-date" value={newForm.start_date}
                  onChange={(e) => setNewForm({ ...newForm, start_date: e.target.value })} className="h-11 rounded-xl" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Horário</Label>
                <Input type="time" data-testid="form-time" value={newForm.start_time}
                  onChange={(e) => setNewForm({ ...newForm, start_time: e.target.value })} className="h-11 rounded-xl" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Duração (min)</Label>
                <Input type="number" data-testid="form-duration" value={newForm.duration}
                  onChange={(e) => setNewForm({ ...newForm, duration: e.target.value })} className="h-11 rounded-xl" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Valor (R$)</Label>
                <Input type="number" data-testid="form-price" value={newForm.price}
                  onChange={(e) => setNewForm({ ...newForm, price: e.target.value })} className="h-11 rounded-xl" />
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Status</Label>
                <select data-testid="form-status" value={newForm.status}
                  onChange={(e) => setNewForm({ ...newForm, status: e.target.value })}
                  className="w-full h-11 rounded-xl border border-border bg-card px-3 text-sm">
                  <option value="agendado">Agendado</option>
                  <option value="confirmado">Confirmado</option>
                  <option value="encaixe">Encaixe</option>
                </select>
              </div>
              <DialogFooter className="col-span-2">
                <Button type="submit" disabled={busy} className="rounded-xl bg-primary text-primary-foreground hover:bg-primary/90" data-testid="appointment-submit-btn">
                  {busy ? "Salvando..." : "Agendar"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Detail dialog */}
      <Dialog open={dialogMode === "detail"} onOpenChange={(o) => { if (!o) closeDialog(); }}>
        <DialogContent className="rounded-2xl max-w-lg" data-testid="appointment-detail-dialog">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle className="font-display text-2xl tracking-tight">{selected.patient_name}</DialogTitle>
                <DialogDescription className="text-sm text-muted-foreground">{selected.procedure} · {selected.professional_name || "—"}</DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Quando</span>
                  <span className="font-medium">{format(parseISO(selected.start), "dd 'de' MMM 'às' HH:mm", { locale: ptBR })}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Sala</span>
                  <span>{selected.room || "—"}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Valor</span>
                  <span className="font-mono">{(selected.price || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Status</span>
                  <Badge className={`${STATUS_STYLES[selected.status]?.bg} ${STATUS_STYLES[selected.status]?.text} border-0`}>
                    {selected.status}
                  </Badge>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 mt-4">
                <Button variant="outline" onClick={() => updateStatus("confirmado")} className="rounded-xl" data-testid="confirm-btn">
                  Confirmar
                </Button>
                <Button variant="outline" onClick={sendWhatsappConfirmation} className="rounded-xl" data-testid="whatsapp-confirm-btn">
                  <MessageSquare className="h-3.5 w-3.5 mr-1" /> WhatsApp
                </Button>
                <Button variant="outline" onClick={() => updateStatus("cancelado")} className="rounded-xl text-destructive" data-testid="cancel-btn">
                  Cancelar
                </Button>
                <Button variant="outline" onClick={deleteAppointment} className="rounded-xl text-destructive" data-testid="delete-btn">
                  <Trash2 className="h-3.5 w-3.5 mr-1" /> Excluir
                </Button>
              </div>
              <Button onClick={startAttendance} className="w-full rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 mt-2" data-testid="start-attendance-btn">
                <Play className="h-4 w-4 mr-1.5" /> Iniciar atendimento
              </Button>
            </>
          )}
        </DialogContent>
      </Dialog>

      <AttendanceDialog
        appointment={attendance.appointment}
        open={attendance.open}
        onOpenChange={(o) => setAttendance({ ...attendance, open: o })}
        onCompleted={load}
      />

      {/* Pre-register patient (inline) */}
      <Dialog open={showPreReg} onOpenChange={setShowPreReg}>
        <DialogContent className="rounded-2xl max-w-sm" data-testid="prereg-dialog">
          <DialogHeader>
            <DialogTitle className="font-display text-xl tracking-tight">Novo paciente</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Pré-cadastro rápido. O cadastro completo será solicitado no atendimento.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Nome completo *</Label>
              <Input data-testid="prereg-name" value={preReg.name}
                onChange={(e) => setPreReg({ ...preReg, name: e.target.value })} className="h-11 rounded-xl" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Telefone *</Label>
              <Input data-testid="prereg-phone" value={preReg.phone}
                onChange={(e) => setPreReg({ ...preReg, phone: e.target.value })} className="h-11 rounded-xl" />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={savePreReg} disabled={preRegBusy} className="rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 w-full" data-testid="prereg-save-btn">
              {preRegBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Salvar e selecionar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
