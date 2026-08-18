import React, { useEffect, useMemo, useState } from "react";
import api, { resolveFileUrl } from "@/lib/api";
import PageHeader from "@/components/PageHeader";
import DocumentosSubNav from "@/components/DocumentosSubNav";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Loader2, Save, ShieldAlert, Info } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

const DEFAULT_HEADER = { show_logo: true, show_legal_name: true, show_cnpj: true, show_address: true, show_contacts: true, show_social: false, layout: "logo_left" };
const DEFAULT_WM = { enabled: false, type: "none", text: "", opacity: 0.08, size: "medium", rotation: -30, position: "diagonal" };
const SIZE_PX = { small: 28, medium: 44, large: 64 };

function Toggle({ label, checked, onChange, testid }) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-border bg-card px-4 py-3">
      <Label className="text-sm">{label}</Label>
      <Switch checked={checked} onCheckedChange={onChange} data-testid={testid} />
    </div>
  );
}

export default function DocumentosConfiguracoes() {
  const { user } = useAuth();
  const canEdit = user?.role === "admin";
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [header, setHeader] = useState(DEFAULT_HEADER);
  const [wm, setWm] = useState(DEFAULT_WM);
  const [clinic, setClinic] = useState({});

  useEffect(() => {
    (async () => {
      try {
        const [s, c] = await Promise.all([
          api.get("/clinic/document-settings"),
          api.get("/clinic"),
        ]);
        setHeader({ ...DEFAULT_HEADER, ...(s.data.header || {}) });
        setWm({ ...DEFAULT_WM, ...(s.data.watermark || {}) });
        setClinic(c.data || {});
      } catch { toast.error("Erro ao carregar configurações"); }
      finally { setLoading(false); }
    })();
  }, []);

  const save = async () => {
    setBusy(true);
    try {
      await api.put("/clinic/document-settings", { header, watermark: wm });
      toast.success("Configurações salvas");
    } catch (e) {
      toast.error(e.response?.data?.detail || "Erro ao salvar");
    } finally { setBusy(false); }
  };

  const logo = clinic.logo_url ? resolveFileUrl(clinic.logo_url) : null;

  const wmText = useMemo(() => {
    if (wm.type === "clinic_name") return clinic.name || "Clínica";
    if (wm.type === "custom_text") return wm.text || "CONFIDENCIAL";
    return "";
  }, [wm.type, wm.text, clinic.name]);

  const renderWatermark = () => {
    if (!wm.enabled || wm.type === "none") return null;
    const base = {
      position: "absolute", pointerEvents: "none", opacity: wm.opacity,
      color: "#B76E79", fontWeight: 700, whiteSpace: "nowrap",
      fontSize: SIZE_PX[wm.size] || 44,
    };
    const nodes = [];
    const content = wm.type === "logo"
      ? (logo ? <img src={logo} alt="wm" style={{ width: (SIZE_PX[wm.size] || 44) * 2.2 }} /> : <span>LOGO</span>)
      : <span>{wmText}</span>;
    if (wm.position === "tiled") {
      for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
        nodes.push(
          <div key={`${r}-${c}`} style={{ ...base, top: `${18 + r * 32}%`, left: `${10 + c * 30}%`, transform: `translate(-50%,-50%) rotate(${wm.rotation}deg)` }}>{content}</div>
        );
      }
      return nodes;
    }
    const rot = wm.position === "diagonal" ? wm.rotation : 0;
    return (
      <div style={{ ...base, top: "50%", left: "50%", transform: `translate(-50%,-50%) rotate(${rot}deg)` }}>{content}</div>
    );
  };

  if (loading) {
    return (<div><PageHeader title="Configurações de Documentos" /><DocumentosSubNav /><div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div></div>);
  }

  return (
    <div data-testid="documentos-config-page">
      <PageHeader title="Configurações de Documentos" subtitle="Cabeçalho e marca d'água (pré-visualização)"
        actions={canEdit && (
          <Button onClick={save} disabled={busy} className="rounded-xl bg-primary text-primary-foreground" data-testid="cfg-save">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Save className="h-4 w-4 mr-1.5" /> Salvar</>}
          </Button>
        )} />
      <DocumentosSubNav />
      <div className="p-6 sm:p-8 animate-fade-up">
        <div className="mb-4 flex items-center gap-2 text-xs text-muted-foreground rounded-xl border border-border bg-muted/30 px-4 py-3">
          <Info className="h-4 w-4 shrink-0" /> Nesta fase as configurações são <strong className="mx-1">salvas e pré-visualizadas</strong>. A aplicação no PDF final será ativada na Fase 6.
        </div>
        {!canEdit && (
          <div className="mb-4 flex items-center gap-2 text-xs text-muted-foreground rounded-xl border border-border bg-muted/30 px-4 py-3">
            <ShieldAlert className="h-4 w-4" /> Somente administradores podem editar. Modo leitura.
          </div>
        )}
        <div className="grid lg:grid-cols-2 gap-6">
          {/* Controles */}
          <Tabs defaultValue="header">
            <TabsList className="bg-muted/40 rounded-xl">
              <TabsTrigger value="header" className="rounded-lg" data-testid="tab-header">Cabeçalho</TabsTrigger>
              <TabsTrigger value="watermark" className="rounded-lg" data-testid="tab-watermark">{"Marca d'água"}</TabsTrigger>
            </TabsList>

            <TabsContent value="header" className="mt-4 space-y-2.5">
              <div className="space-y-1.5 mb-2">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Layout</Label>
                <select value={header.layout} disabled={!canEdit}
                  onChange={(e) => setHeader((h) => ({ ...h, layout: e.target.value }))}
                  className="w-full h-11 rounded-xl border border-border bg-card px-3 text-sm" data-testid="cfg-layout">
                  <option value="logo_left">Logo à esquerda</option>
                  <option value="centered">Centralizado</option>
                </select>
              </div>
              <Toggle label="Exibir logo" checked={header.show_logo} onChange={(v) => setHeader((h) => ({ ...h, show_logo: v }))} testid="cfg-show-logo" />
              <Toggle label="Exibir razão social" checked={header.show_legal_name} onChange={(v) => setHeader((h) => ({ ...h, show_legal_name: v }))} testid="cfg-show-legal" />
              <Toggle label="Exibir CNPJ" checked={header.show_cnpj} onChange={(v) => setHeader((h) => ({ ...h, show_cnpj: v }))} testid="cfg-show-cnpj" />
              <Toggle label="Exibir endereço" checked={header.show_address} onChange={(v) => setHeader((h) => ({ ...h, show_address: v }))} testid="cfg-show-address" />
              <Toggle label="Exibir contatos (tel/e-mail/site)" checked={header.show_contacts} onChange={(v) => setHeader((h) => ({ ...h, show_contacts: v }))} testid="cfg-show-contacts" />
              <Toggle label="Exibir redes sociais" checked={header.show_social} onChange={(v) => setHeader((h) => ({ ...h, show_social: v }))} testid="cfg-show-social" />
            </TabsContent>

            <TabsContent value="watermark" className="mt-4 space-y-3">
              <Toggle label="Ativar marca d'água" checked={wm.enabled} onChange={(v) => setWm((w) => ({ ...w, enabled: v }))} testid="cfg-wm-enabled" />
              <div className="space-y-1.5">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Tipo</Label>
                <select value={wm.type} disabled={!canEdit || !wm.enabled}
                  onChange={(e) => setWm((w) => ({ ...w, type: e.target.value }))}
                  className="w-full h-11 rounded-xl border border-border bg-card px-3 text-sm disabled:opacity-50" data-testid="cfg-wm-type">
                  <option value="none">Nenhuma</option>
                  <option value="logo">Logo</option>
                  <option value="clinic_name">Nome da clínica</option>
                  <option value="custom_text">Texto personalizado</option>
                </select>
              </div>
              {wm.type === "custom_text" && (
                <div className="space-y-1.5">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">Texto</Label>
                  <Input value={wm.text || ""} disabled={!canEdit} onChange={(e) => setWm((w) => ({ ...w, text: e.target.value }))}
                    placeholder="Ex.: CONFIDENCIAL" className="h-11 rounded-xl" data-testid="cfg-wm-text" />
                </div>
              )}
              <div className="space-y-1.5">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Opacidade: {(wm.opacity * 100).toFixed(0)}%</Label>
                <Slider value={[wm.opacity]} min={0.02} max={0.5} step={0.01} disabled={!canEdit || !wm.enabled}
                  onValueChange={([v]) => setWm((w) => ({ ...w, opacity: v }))} data-testid="cfg-wm-opacity" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Tamanho</Label>
                <select value={wm.size} disabled={!canEdit || !wm.enabled}
                  onChange={(e) => setWm((w) => ({ ...w, size: e.target.value }))}
                  className="w-full h-11 rounded-xl border border-border bg-card px-3 text-sm disabled:opacity-50" data-testid="cfg-wm-size">
                  <option value="small">Pequeno</option>
                  <option value="medium">Médio</option>
                  <option value="large">Grande</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Rotação: {wm.rotation}°</Label>
                <Slider value={[wm.rotation]} min={-90} max={90} step={5} disabled={!canEdit || !wm.enabled}
                  onValueChange={([v]) => setWm((w) => ({ ...w, rotation: v }))} data-testid="cfg-wm-rotation" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Posição</Label>
                <select value={wm.position} disabled={!canEdit || !wm.enabled}
                  onChange={(e) => setWm((w) => ({ ...w, position: e.target.value }))}
                  className="w-full h-11 rounded-xl border border-border bg-card px-3 text-sm disabled:opacity-50" data-testid="cfg-wm-position">
                  <option value="center">Centro</option>
                  <option value="diagonal">Diagonal</option>
                  <option value="tiled">Repetida (tiled)</option>
                </select>
              </div>
            </TabsContent>
          </Tabs>

          {/* Preview */}
          <div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-2">Pré-visualização</div>
            <div className="relative rounded-2xl border border-border bg-white overflow-hidden shadow-sm" style={{ aspectRatio: "1 / 1.414" }} data-testid="cfg-preview">
              {/* Cabeçalho */}
              <div className={`px-6 pt-6 pb-4 border-b border-gray-200 flex gap-3 ${header.layout === "centered" ? "flex-col items-center text-center" : "items-center"}`}>
                {header.show_logo && (logo ? <img src={logo} alt="logo" className="h-12 w-12 rounded-lg object-cover" /> : <div className="h-12 w-12 rounded-lg bg-gray-100 flex items-center justify-center text-[10px] text-gray-400">LOGO</div>)}
                <div className="min-w-0">
                  <div className="text-gray-900 font-semibold truncate">{clinic.name || "Nome da Clínica"}</div>
                  {header.show_legal_name && clinic.legal_name && <div className="text-[11px] text-gray-500 truncate">{clinic.legal_name}</div>}
                  {header.show_cnpj && <div className="text-[11px] text-gray-500">CNPJ: {clinic.cnpj || "—"}</div>}
                  {header.show_address && <div className="text-[11px] text-gray-500 truncate">{clinic.address || "Endereço da clínica"}</div>}
                  {header.show_contacts && <div className="text-[11px] text-gray-500 truncate">{[clinic.phone, clinic.email, clinic.website].filter(Boolean).join(" · ") || "tel · e-mail · site"}</div>}
                  {header.show_social && <div className="text-[11px] text-gray-500 truncate">{clinic.instagram ? `@${String(clinic.instagram).replace(/^@/, "")}` : "@instagram"}</div>}
                </div>
              </div>
              {/* Corpo mock + marca d'água */}
              <div className="relative px-6 py-5 space-y-2">
                {renderWatermark()}
                <div className="h-3 w-1/2 bg-gray-200 rounded" />
                {Array.from({ length: 8 }).map((_, i) => (<div key={i} className="h-2 bg-gray-100 rounded" style={{ width: `${90 - (i % 3) * 12}%` }} />))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
