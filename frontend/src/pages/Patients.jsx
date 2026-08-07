import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "@/lib/api";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Plus, Search, User as UserIcon, Phone, Mail, AlertTriangle, Download, ChevronDown } from "lucide-react";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { formatApiErrorDetail, downloadFile } from "@/lib/api";

const EMPTY = {
  name: "", cpf: "", birth_date: "", phone: "", whatsapp: "", email: "",
  address: "", city: "", state: "", allergies: "", medications: "",
  emergency_contact: "", notes: "", photo_url: "", lgpd_consent: false, status: "ativo",
};

export default function Patients() {
  const [patients, setPatients] = useState([]);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  const load = async () => {
    const { data } = await api.get("/patients", { params: { search } });
    setPatients(data);
  };

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const onCreate = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post("/patients", form);
      toast.success("Paciente cadastrado");
      setOpen(false);
      setForm(EMPTY);
      await load();
    } catch (err) {
      toast.error(formatApiErrorDetail(err.response?.data?.detail) || err.message);
    } finally {
      setBusy(false);
    }
  };

  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const [exporting, setExporting] = useState(false);
  const onExport = async (fmt) => {
    setExporting(true);
    try {
      const params = search ? { search } : {};
      await downloadFile(`/export/patients.${fmt}`, `pacientes.${fmt}`, params);
      toast.success(`Exportado (${fmt.toUpperCase()})`);
    } catch (err) {
      toast.error(formatApiErrorDetail(err.response?.data?.detail) || "Falha ao exportar");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div data-testid="patients-page">
      <PageHeader
        title="Pacientes"
        subtitle={`${patients.length} registrados`}
        actions={
          <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="rounded-xl h-10" disabled={exporting} data-testid="export-patients-btn">
                <Download className="h-4 w-4 mr-1.5" /> {exporting ? "Exportando..." : "Exportar"} <ChevronDown className="h-3.5 w-3.5 ml-1" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="rounded-xl">
              <DropdownMenuItem onClick={() => onExport("csv")} data-testid="export-patients-csv">CSV (.csv)</DropdownMenuItem>
              <DropdownMenuItem onClick={() => onExport("xlsx")} data-testid="export-patients-xlsx">Excel (.xlsx)</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button data-testid="new-patient-btn" className="rounded-xl h-10 bg-primary text-primary-foreground hover:bg-primary/90">
                <Plus className="h-4 w-4 mr-1.5" /> Novo paciente
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl rounded-2xl">
              <DialogHeader>
                <DialogTitle className="font-display text-2xl tracking-tight">Novo paciente</DialogTitle>
              </DialogHeader>
              <form onSubmit={onCreate} className="grid grid-cols-1 sm:grid-cols-2 gap-4" data-testid="new-patient-form">
                <div className="col-span-2 space-y-1.5">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">Nome completo *</Label>
                  <Input data-testid="form-name" required value={form.name} onChange={(e) => setField("name", e.target.value)} className="h-11 rounded-xl" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">CPF</Label>
                  <Input data-testid="form-cpf" value={form.cpf} onChange={(e) => setField("cpf", e.target.value)} className="h-11 rounded-xl" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">Nascimento</Label>
                  <Input type="date" data-testid="form-birth" value={form.birth_date} onChange={(e) => setField("birth_date", e.target.value)} className="h-11 rounded-xl" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">Telefone</Label>
                  <Input data-testid="form-phone" value={form.phone} onChange={(e) => setField("phone", e.target.value)} className="h-11 rounded-xl" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">WhatsApp</Label>
                  <Input data-testid="form-whatsapp" value={form.whatsapp} onChange={(e) => setField("whatsapp", e.target.value)} className="h-11 rounded-xl" />
                </div>
                <div className="col-span-2 space-y-1.5">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">Email</Label>
                  <Input type="email" data-testid="form-email" value={form.email} onChange={(e) => setField("email", e.target.value)} className="h-11 rounded-xl" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">Cidade</Label>
                  <Input data-testid="form-city" value={form.city} onChange={(e) => setField("city", e.target.value)} className="h-11 rounded-xl" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">UF</Label>
                  <Input data-testid="form-state" value={form.state} onChange={(e) => setField("state", e.target.value)} className="h-11 rounded-xl" />
                </div>
                <div className="col-span-2 space-y-1.5">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">Alergias</Label>
                  <Input data-testid="form-allergies" value={form.allergies} onChange={(e) => setField("allergies", e.target.value)} className="h-11 rounded-xl" />
                </div>
                <div className="col-span-2 space-y-1.5">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">Observações</Label>
                  <Textarea data-testid="form-notes" value={form.notes} onChange={(e) => setField("notes", e.target.value)} className="rounded-xl" />
                </div>
                <label className="col-span-2 flex items-center gap-2 text-sm">
                  <input type="checkbox" data-testid="form-lgpd" checked={form.lgpd_consent} onChange={(e) => setField("lgpd_consent", e.target.checked)} className="rounded" />
                  Consentimento LGPD obtido
                </label>
                <DialogFooter className="col-span-2">
                  <Button type="submit" disabled={busy} data-testid="form-submit-btn" className="rounded-xl bg-primary text-primary-foreground hover:bg-primary/90">
                    {busy ? "Salvando..." : "Cadastrar paciente"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
          </div>
        }
      />

      <div className="p-6 sm:p-8 space-y-6 animate-fade-up">
        <div className="relative max-w-md">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" strokeWidth={1.5} />
          <Input
            data-testid="patients-search"
            value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar paciente..."
            className="pl-10 h-11 rounded-xl bg-card"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {patients.length === 0 && (
            <div className="col-span-full text-center py-16 text-muted-foreground" data-testid="empty-patients">
              Nenhum paciente encontrado.
            </div>
          )}
          {patients.map((p) => (
            <div
              key={p.patient_id}
              data-testid={`patient-card-${p.patient_id}`}
              onClick={() => navigate(`/pacientes/${p.patient_id}`)}
              className="cursor-pointer group rounded-2xl border border-border bg-card p-5 hover:border-primary/40 transition-all hover:-translate-y-0.5"
            >
              <div className="flex items-start gap-3">
                <div className="h-12 w-12 rounded-full bg-primary/10 ring-1 ring-primary/30 flex items-center justify-center text-sm font-semibold text-primary">
                  {p.name?.[0]?.toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-display text-base font-semibold tracking-tight truncate">{p.name}</div>
                  <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1.5">
                    <UserIcon className="h-3 w-3" /> {p.cpf || "—"}
                  </div>
                </div>
              </div>
              <div className="mt-4 space-y-1.5 text-xs text-muted-foreground">
                {p.phone && <div className="flex items-center gap-1.5"><Phone className="h-3 w-3" /> {p.phone}</div>}
                {p.email && <div className="flex items-center gap-1.5"><Mail className="h-3 w-3" /> {p.email}</div>}
                {p.allergies && (
                  <div className="flex items-center gap-1.5 text-destructive">
                    <AlertTriangle className="h-3 w-3" /> {p.allergies}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
