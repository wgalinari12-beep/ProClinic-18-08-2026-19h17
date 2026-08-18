import React, { useEffect, useRef, useState } from "react";
import api, { resolveFileUrl } from "@/lib/api";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Upload, Loader2, Building2, User as UserIcon, Globe2, Instagram,
  Palette, Trash2, RotateCcw, Check, AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import { formatApiErrorDetail } from "@/lib/api";
import { useClinicBrand } from "@/contexts/ClinicBrandContext";
import { isValidHex, normalizeHex, getContrastHex } from "@/lib/color";

const DEFAULTS = {
  primary_color: "#B76E79",
  secondary_color: "#C0A080",
  accent_color: "#B76E79",
};

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

// Campo de cor: seletor visual + input HEX com validação.
function ColorField({ label, hint, value, fallback, onChange, testid }) {
  const current = value || fallback;
  const valid = isValidHex(normalizeHex(current));
  return (
    <div className="space-y-2">
      <Label className="text-xs uppercase tracking-wider text-muted-foreground">{label}</Label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={valid ? normalizeHex(current) : fallback}
          onChange={(e) => onChange(e.target.value)}
          className="h-11 w-14 rounded-lg border border-border cursor-pointer bg-transparent shrink-0"
          data-testid={`${testid}-picker`}
          aria-label={`${label} seletor`}
        />
        <div className="relative flex-1">
          <Input
            value={current || ""}
            onChange={(e) => onChange(e.target.value)}
            placeholder={fallback}
            maxLength={7}
            className={`h-11 rounded-xl font-mono uppercase ${!valid ? "border-destructive focus-visible:ring-destructive" : ""}`}
            data-testid={`${testid}-hex`}
          />
        </div>
      </div>
      {!valid ? (
        <p className="text-[11px] text-destructive flex items-center gap-1">
          <AlertTriangle className="h-3 w-3" /> HEX inválido. Use o formato #RRGGBB (ex.: #BD5573).
        </p>
      ) : hint ? (
        <p className="text-[11px] text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

// Área de pré-visualização da identidade visual.
function BrandPreview({ primary, secondary, accent }) {
  const p = isValidHex(normalizeHex(primary)) ? normalizeHex(primary) : DEFAULTS.primary_color;
  const s = isValidHex(normalizeHex(secondary)) ? normalizeHex(secondary) : DEFAULTS.secondary_color;
  const a = isValidHex(normalizeHex(accent)) ? normalizeHex(accent) : DEFAULTS.accent_color;
  return (
    <div className="rounded-xl border border-border overflow-hidden" data-testid="brand-preview">
      {/* Cabeçalho de exemplo */}
      <div className="flex items-center justify-between px-4 py-3" style={{ background: p, color: getContrastHex(p) }}>
        <span className="font-display text-sm font-semibold tracking-tight">Sua Clínica</span>
        <span className="text-[11px] opacity-90">Cabeçalho</span>
      </div>
      <div className="p-4 space-y-4 bg-card">
        <div className="flex flex-wrap gap-2">
          <button type="button" className="h-9 px-4 rounded-lg text-sm font-medium" style={{ background: p, color: getContrastHex(p) }}>
            Botão principal
          </button>
          <button type="button" className="h-9 px-4 rounded-lg text-sm font-medium" style={{ background: s, color: getContrastHex(s) }}>
            Botão secundário
          </button>
          <button type="button" className="h-9 px-4 rounded-lg text-sm font-medium" style={{ background: a, color: getContrastHex(a) }}>
            Destaque
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {/* Item de navegação "selecionado" */}
          <span className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium"
            style={{ background: `${p}1a`, color: p }}>
            <span className="h-2 w-2 rounded-full" style={{ background: p }} /> Item selecionado
          </span>
          {/* Badges */}
          <span className="rounded-full px-3 py-1 text-xs font-semibold" style={{ background: s, color: getContrastHex(s) }}>Etiqueta</span>
          <span className="rounded-full px-3 py-1 text-xs font-semibold ring-1" style={{ color: a, borderColor: a, boxShadow: `inset 0 0 0 1px ${a}` }}>Acento</span>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="h-6 w-6 rounded-md" style={{ background: p }} />
          <span className="h-6 w-6 rounded-md" style={{ background: s }} />
          <span className="h-6 w-6 rounded-md" style={{ background: a }} />
          <span>Prévia — as cores serão aplicadas após salvar.</span>
        </div>
      </div>
    </div>
  );
}

export default function MinhaClinica() {
  const [data, setData] = useState({});
  const [busy, setBusy] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false);
  const fileRef = useRef(null);
  const { refreshBrand } = useClinicBrand();

  useEffect(() => {
    (async () => {
      try {
        const { data: c } = await api.get("/clinic");
        setData(c || {});
      } catch { /* ignore */ }
    })();
  }, []);

  const set = (k) => (v) => setData((d) => ({ ...d, [k]: v }));
  const setColor = (k) => (v) => setData((d) => ({ ...d, [k]: normalizeHex(v) }));

  const colorsValid = ["primary_color", "secondary_color", "accent_color"].every((k) => {
    const v = data[k];
    return !v || isValidHex(normalizeHex(v));
  });

  const buildPayload = (extra = {}) => {
    const payload = { ...data, ...extra };
    delete payload.clinic_id;
    delete payload.created_at;
    delete payload.updated_at;
    ["primary_color", "secondary_color", "accent_color"].forEach((k) => {
      if (payload[k]) payload[k] = normalizeHex(payload[k]);
      if (!payload[k]) payload[k] = null;
    });
    return payload;
  };

  const save = async () => {
    if (!colorsValid) {
      toast.error("Corrija as cores inválidas antes de salvar.");
      return;
    }
    setBusy(true);
    try {
      const { data: saved } = await api.put("/clinic", buildPayload());
      setData(saved);
      await refreshBrand();
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
      const { data: saved } = await api.put("/clinic", buildPayload({ logo_url: up.url }));
      setData(saved);
      await refreshBrand();
      toast.success("Logo atualizada");
    } catch (e) {
      toast.error("Falha no upload. Verifique o formato (PNG/JPG/WebP) e o tamanho (até 12MB).");
    } finally {
      setUploadBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const removeLogo = async () => {
    setUploadBusy(true);
    try {
      const { data: saved } = await api.put("/clinic", buildPayload({ logo_url: null }));
      setData(saved);
      await refreshBrand();
      toast.success("Logo removida");
    } catch (e) {
      toast.error("Falha ao remover a logo");
    } finally { setUploadBusy(false); }
  };

  const restoreDefault = async () => {
    if (!window.confirm("Restaurar a identidade visual padrão do ProClinic? A logo e as cores personalizadas serão removidas. Nenhum dado clínico é afetado.")) return;
    setBusy(true);
    try {
      const { data: saved } = await api.put("/clinic", buildPayload({
        logo_url: null, primary_color: null, secondary_color: null, accent_color: null,
      }));
      setData(saved);
      await refreshBrand();
      toast.success("Identidade visual padrão restaurada");
    } catch (err) {
      toast.error(formatApiErrorDetail(err.response?.data?.detail) || err.message);
    } finally { setBusy(false); }
  };

  return (
    <div data-testid="clinic-settings-page">
      <PageHeader
        title="Minha Clínica"
        subtitle="Configurações gerais e identidade visual"
        actions={
          <Button onClick={save} disabled={busy || !colorsValid} className="rounded-xl bg-primary text-primary-foreground hover:bg-primary/90" data-testid="clinic-save-btn">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Salvar alterações"}
          </Button>
        }
      />
      <div className="p-6 sm:p-8 space-y-6 animate-fade-up max-w-4xl">
        {/* ===================== Identidade Visual ===================== */}
        <section className="rounded-2xl border border-border bg-card p-6" data-testid="brand-identity-section">
          <div className="flex items-center gap-3 mb-5">
            <div className="h-9 w-9 rounded-xl bg-primary/10 ring-1 ring-primary/30 flex items-center justify-center">
              <Palette className="h-4 w-4 text-primary" strokeWidth={1.5} />
            </div>
            <div className="flex-1">
              <h3 className="font-display text-lg font-semibold tracking-tight">Identidade Visual</h3>
              <p className="text-xs text-muted-foreground">Logo e cores da marca aplicadas em todo o sistema desta clínica.</p>
            </div>
            <Button variant="ghost" size="sm" onClick={restoreDefault} disabled={busy} className="rounded-lg text-muted-foreground" data-testid="brand-restore-btn">
              <RotateCcw className="h-3.5 w-3.5 mr-1.5" /> Restaurar padrão
            </Button>
          </div>

          {/* Logo */}
          <div className="flex flex-wrap items-center gap-6 mb-6">
            <div className="h-24 w-24 rounded-2xl border border-border bg-muted/30 flex items-center justify-center overflow-hidden shrink-0">
              {data.logo_url ? <img src={resolveFileUrl(data.logo_url)} alt="Logo da clínica" className="h-full w-full object-contain" data-testid="clinic-logo-preview" /> :
                <Building2 className="h-8 w-8 text-muted-foreground" strokeWidth={1.5} />}
            </div>
            <div>
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
                onChange={(e) => uploadLogo(e.target.files?.[0])} />
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={uploadBusy} className="rounded-xl" data-testid="logo-upload-btn">
                  {uploadBusy ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Upload className="h-4 w-4 mr-1.5" />}
                  {data.logo_url ? "Substituir logo" : "Carregar logomarca"}
                </Button>
                {data.logo_url && (
                  <Button variant="ghost" onClick={removeLogo} disabled={uploadBusy} className="rounded-xl text-destructive hover:text-destructive" data-testid="logo-remove-btn">
                    <Trash2 className="h-4 w-4 mr-1.5" /> Remover
                  </Button>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground mt-2">PNG, JPG ou WebP até 12MB. Usada no menu, portais e documentos.</p>
            </div>
          </div>

          {/* Cores + Preview */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="space-y-4">
              <ColorField label="Cor principal" testid="clinic-primary-color"
                value={data.primary_color} fallback={DEFAULTS.primary_color}
                onChange={setColor("primary_color")}
                hint="Elementos de destaque, botões e navegação ativa." />
              <ColorField label="Cor secundária" testid="clinic-secondary-color"
                value={data.secondary_color} fallback={DEFAULTS.secondary_color}
                onChange={setColor("secondary_color")}
                hint="Elementos complementares e etiquetas." />
              <ColorField label="Cor de destaque" testid="clinic-accent-color"
                value={data.accent_color} fallback={DEFAULTS.accent_color}
                onChange={setColor("accent_color")}
                hint="Ações e realces pontuais." />
            </div>
            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Pré-visualização</Label>
              <BrandPreview primary={data.primary_color} secondary={data.secondary_color} accent={data.accent_color} />
              <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                <Check className="h-3 w-3 text-primary" /> O contraste do texto é ajustado automaticamente para manter a legibilidade.
              </p>
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
