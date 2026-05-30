import React, { useEffect, useRef, useState } from "react";
import api from "@/lib/api";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Upload, Loader2, Building2, User as UserIcon, Globe2, Instagram } from "lucide-react";
import { toast } from "sonner";
import { formatApiErrorDetail } from "@/lib/api";

function Section({ title, icon: Icon, children }) {
  return (
    <section className="rounded-2xl border border-border bg-card p-6">
      <div className="flex items-center gap-3 mb-5">
        <div className="h-9 w-9 rounded-xl bg-primary/10 ring-1 ring-primary/30 flex items-center justify-center">
          <Icon className="h-4 w-4 text-primary" strokeWidth={1.5} />
        </div>
        <h3 className="font-display text-lg font-semibold tracking-tight">{title}</h3>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">{children}</div>
    </section>
  );
}

function Field({ label, value, onChange, testid, full, type = "text" }) {
  return (
    <div className={`${full ? "md:col-span-2" : ""} space-y-1.5`}>
      <Label className="text-xs uppercase tracking-wider text-muted-foreground">{label}</Label>
      <Input type={type} data-testid={testid} value={value || ""} onChange={(e) => onChange(e.target.value)} className="h-11 rounded-xl" />
    </div>
  );
}

export default function MinhaClinica() {
  const [data, setData] = useState({});
  const [busy, setBusy] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => {
    (async () => {
      try {
        const { data: c } = await api.get("/clinic");
        setData(c || {});
      } catch { /* ignore */ }
    })();
  }, []);

  const set = (k) => (v) => setData((d) => ({ ...d, [k]: v }));

  const save = async () => {
    setBusy(true);
    try {
      const payload = { ...data };
      delete payload.clinic_id;
      delete payload.created_at;
      delete payload.updated_at;
      const { data: saved } = await api.put("/clinic", payload);
      setData(saved);
      toast.success("Configurações salvas");
    } catch (err) {
      toast.error(formatApiErrorDetail(err.response?.data?.detail) || err.message);
    } finally { setBusy(false); }
  };

  const uploadLogo = async (f) => {
    if (!f) return;
    setUploadBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", f);
      const { data: up } = await api.post("/uploads", fd, { headers: { "Content-Type": "multipart/form-data" } });
      const { data: saved } = await api.put("/clinic", { ...data, logo_url: up.url });
      setData(saved);
      toast.success("Logo atualizada");
    } catch (e) {
      toast.error("Falha no upload");
    } finally { setUploadBusy(false); }
  };

  const resolveLogoSrc = (url) => {
    if (!url) return "";
    if (url.startsWith("http")) return url;
    const t = localStorage.getItem("pc_token");
    const sep = url.includes("?") ? "&" : "?";
    return `${process.env.REACT_APP_BACKEND_URL}${url}${t ? `${sep}auth=${encodeURIComponent(t)}` : ""}`;
  };

  return (
    <div data-testid="clinic-settings-page">
      <PageHeader
        title="Minha Clínica"
        subtitle="Configurações gerais e identidade"
        actions={
          <Button onClick={save} disabled={busy} className="rounded-xl bg-primary text-primary-foreground hover:bg-primary/90" data-testid="clinic-save-btn">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Salvar alterações"}
          </Button>
        }
      />
      <div className="p-6 sm:p-8 space-y-6 animate-fade-up max-w-4xl">
        {/* Logo */}
        <section className="rounded-2xl border border-border bg-card p-6">
          <div className="flex items-center gap-3 mb-5">
            <div className="h-9 w-9 rounded-xl bg-primary/10 ring-1 ring-primary/30 flex items-center justify-center">
              <Upload className="h-4 w-4 text-primary" strokeWidth={1.5} />
            </div>
            <h3 className="font-display text-lg font-semibold tracking-tight">Logomarca</h3>
          </div>
          <div className="flex items-center gap-6">
            <div className="h-24 w-24 rounded-2xl border border-border bg-muted/30 flex items-center justify-center overflow-hidden">
              {data.logo_url ? <img src={resolveLogoSrc(data.logo_url)} alt="" className="h-full w-full object-contain" /> :
                <Building2 className="h-8 w-8 text-muted-foreground" strokeWidth={1.5} />}
            </div>
            <div>
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
                onChange={(e) => uploadLogo(e.target.files?.[0])} />
              <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={uploadBusy} className="rounded-xl" data-testid="logo-upload-btn">
                {uploadBusy ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Upload className="h-4 w-4 mr-1.5" />}
                Carregar logomarca
              </Button>
              <p className="text-[11px] text-muted-foreground mt-2">PNG/JPG/WebP até 12MB. Usada em portais e documentos.</p>
            </div>
          </div>
        </section>

        <Section title="Identificação" icon={Building2}>
          <Field label="Nome Fantasia" value={data.name} onChange={set("name")} testid="clinic-name" full />
          <Field label="Razão Social" value={data.legal_name} onChange={set("legal_name")} testid="clinic-legal-name" />
          <Field label="CNPJ" value={data.cnpj} onChange={set("cnpj")} testid="clinic-cnpj" />
          <Field label="Inscrição Estadual" value={data.state_registration} onChange={set("state_registration")} testid="clinic-ie" full />
        </Section>

        <Section title="Contato" icon={Globe2}>
          <Field label="Telefone" value={data.phone} onChange={set("phone")} testid="clinic-phone" />
          <Field label="WhatsApp" value={data.whatsapp} onChange={set("whatsapp")} testid="clinic-whatsapp" />
          <Field label="E-mail" value={data.email} onChange={set("email")} testid="clinic-email" />
          <Field label="Site" value={data.website} onChange={set("website")} testid="clinic-website" />
        </Section>

        <Section title="Endereço" icon={Building2}>
          <Field label="Endereço" value={data.address} onChange={set("address")} testid="clinic-address" full />
          <Field label="CEP" value={data.zipcode} onChange={set("zipcode")} testid="clinic-zip" />
          <Field label="Cidade" value={data.city} onChange={set("city")} testid="clinic-city" />
          <Field label="Estado" value={data.state} onChange={set("state")} testid="clinic-state" />
          <Field label="País" value={data.country} onChange={set("country")} testid="clinic-country" />
        </Section>

        <Section title="Responsável Técnico" icon={UserIcon}>
          <Field label="Nome" value={data.technical_responsible_name} onChange={set("technical_responsible_name")} testid="rt-name" full />
          <Field label="Conselho (CRM, CRO, CRBM...)" value={data.technical_responsible_council} onChange={set("technical_responsible_council")} testid="rt-council" />
          <Field label="Nº do Registro" value={data.technical_responsible_number} onChange={set("technical_responsible_number")} testid="rt-number" />
        </Section>

        <Section title="Redes sociais" icon={Instagram}>
          <Field label="Instagram" value={data.instagram} onChange={set("instagram")} testid="social-instagram" />
          <Field label="Facebook" value={data.facebook} onChange={set("facebook")} testid="social-facebook" />
          <Field label="TikTok" value={data.tiktok} onChange={set("tiktok")} testid="social-tiktok" />
          <Field label="YouTube" value={data.youtube} onChange={set("youtube")} testid="social-youtube" />
        </Section>
      </div>
    </div>
  );
}
