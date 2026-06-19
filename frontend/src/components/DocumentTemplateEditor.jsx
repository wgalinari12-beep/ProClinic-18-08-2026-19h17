import React, { useEffect, useMemo, useState } from "react";
import api from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Save, Loader2, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";

const CATEGORIES = [
  { value: "consentimento", label: "Consentimento" },
  { value: "contrato", label: "Contrato" },
  { value: "termo", label: "Termo" },
  { value: "outro", label: "Outro" },
];

/**
 * DocumentTemplateEditor — markdown source + variable insertion + live HTML preview.
 *
 * Props:
 *  templateId?: string (if editing)
 *  onSaved?: (template) => void
 */
export default function DocumentTemplateEditor({ templateId, onSaved }) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState("consentimento");
  const [description, setDescription] = useState("");
  const [contentMd, setContentMd] = useState(EMPTY_MD);
  const [active, setActive] = useState(true);
  const [variables, setVariables] = useState([]);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(null);
  const [showPreview, setShowPreview] = useState(true);
  const textareaRef = React.useRef(null);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get("/document-templates/variables");
        setVariables(data.variables || []);
      } catch { /* ignore */ }
      if (templateId) {
        try {
          const { data } = await api.get(`/document-templates`);
          const t = (data || []).find((x) => x.template_id === templateId);
          if (t) hydrate(t);
        } catch { /* ignore */ }
      }
    })();
    // eslint-disable-next-line
  }, [templateId]);

  const hydrate = (t) => {
    setLoaded(t);
    setName(t.name);
    setCategory(t.category || "outro");
    setDescription(t.description || "");
    setContentMd(t.content_md || "");
    setActive(t.active !== false);
  };

  const insertVar = (v) => {
    const tag = `{{${v}}}`;
    const el = textareaRef.current;
    if (!el) { setContentMd((c) => (c ? c + " " + tag : tag)); return; }
    const hadFocus = document.activeElement === el;
    // If never focused yet, append at the end (don't prepend).
    const start = hadFocus ? (el.selectionStart ?? el.value.length) : el.value.length;
    const end = hadFocus ? (el.selectionEnd ?? el.value.length) : el.value.length;
    setContentMd((c) => c.slice(0, start) + tag + c.slice(end));
    setTimeout(() => {
      el.focus();
      const pos = start + tag.length;
      el.setSelectionRange(pos, pos);
    }, 0);
  };

  const previewHtml = useMemo(() => simpleMarkdownToHtml(contentMd), [contentMd]);

  const save = async () => {
    if (!name.trim()) { toast.error("Nome do modelo é obrigatório"); return; }
    if (!contentMd.trim()) { toast.error("Conteúdo é obrigatório"); return; }
    setBusy(true);
    try {
      const payload = { name, category, description, content_md: contentMd, active };
      const { data } = loaded
        ? await api.put(`/document-templates/${loaded.template_id}`, payload)
        : await api.post(`/document-templates`, payload);
      hydrate(data);
      toast.success("Modelo salvo");
      onSaved?.(data);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Erro ao salvar modelo");
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4" data-testid="document-template-editor">
      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-2 space-y-1.5">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">Nome do modelo</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)}
            placeholder="Ex.: Consentimento Aplicação de Botox" className="h-11 rounded-xl"
            data-testid="tpl-name" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">Categoria</Label>
          <select value={category} onChange={(e) => setCategory(e.target.value)}
            data-testid="tpl-category"
            className="w-full h-11 rounded-xl border border-border bg-card px-3 text-sm">
            {CATEGORIES.map((c) => (<option key={c.value} value={c.value}>{c.label}</option>))}
          </select>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs uppercase tracking-wider text-muted-foreground">Descrição (opcional)</Label>
        <Input value={description} onChange={(e) => setDescription(e.target.value)}
          placeholder="Para que serve este modelo..." className="h-11 rounded-xl"
          data-testid="tpl-description" />
      </div>

      {/* Variables palette */}
      <div>
        <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-2">
          Inserir variável (clique para inserir na posição do cursor)
        </div>
        <div className="flex flex-wrap gap-1.5" data-testid="tpl-variables-palette">
          {variables.map((v) => (
            <Button key={v} type="button" variant="outline" size="sm"
              onClick={() => insertVar(v)}
              data-testid={`tpl-var-${v}`}
              className="h-7 px-2 text-[10px] font-mono rounded-lg">
              {`{{${v}}}`}
            </Button>
          ))}
        </div>
      </div>

      {/* Editor + Preview */}
      <div className="flex items-center justify-between">
        <Label className="text-xs uppercase tracking-wider text-muted-foreground">Conteúdo (Markdown)</Label>
        <Button type="button" variant="ghost" size="sm" onClick={() => setShowPreview((s) => !s)}
          data-testid="tpl-toggle-preview" className="h-7 text-[11px]">
          {showPreview ? <EyeOff className="h-3 w-3 mr-1" /> : <Eye className="h-3 w-3 mr-1" />}
          {showPreview ? "Ocultar preview" : "Mostrar preview"}
        </Button>
      </div>

      <div className={`grid gap-3 ${showPreview ? "grid-cols-2" : "grid-cols-1"}`}>
        <Textarea ref={textareaRef} value={contentMd} onChange={(e) => setContentMd(e.target.value)}
          rows={18} className="font-mono text-[12px] rounded-xl"
          placeholder="Escreva o documento usando Markdown.&#10;&#10;**negrito**, _itálico_, # Título, ## Subtítulo, - lista&#10;&#10;Insira variáveis como {{PACIENTE_NOME}} clicando acima."
          data-testid="tpl-content" />
        {showPreview && (
          <div className="rounded-xl border border-border bg-card p-4 prose prose-sm max-w-none overflow-auto"
            style={{ minHeight: 380, maxHeight: 500 }}
            data-testid="tpl-preview"
            dangerouslySetInnerHTML={{ __html: previewHtml }} />
        )}
      </div>

      <div className="flex items-center justify-between pt-2">
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)}
            data-testid="tpl-active" />
          Modelo ativo
        </label>
        <div className="flex items-center gap-2">
          {loaded && <Badge variant="outline" className="text-[10px]">Editando · v{(loaded.updated_at || "").slice(0, 10)}</Badge>}
          <Button onClick={save} disabled={busy} className="rounded-xl bg-primary text-primary-foreground hover:bg-primary/90"
            data-testid="tpl-save">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Save className="h-4 w-4 mr-1.5" /> Salvar modelo</>}
          </Button>
        </div>
      </div>
    </div>
  );
}

const EMPTY_MD = `## Termo de Consentimento

Eu, **{{PACIENTE_NOME}}**, CPF {{PACIENTE_CPF}}, declaro estar ciente do procedimento **{{PROCEDIMENTO}}** a ser realizado pelo(a) profissional **{{PROFISSIONAL_NOME}}**.

- Clínica: {{CLINICA_NOME}}
- Data: {{DATA_ATUAL}}
- Valor: {{VALOR_PROCEDIMENTO}}

Declaro que fui devidamente informado(a) sobre os riscos, benefícios e cuidados pós-procedimento.
`;

// Minimal in-browser markdown renderer for preview.
function simpleMarkdownToHtml(src) {
  if (!src) return "<p class='text-muted-foreground'>O preview aparece aqui...</p>";
  let html = src
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\{\{([A-Z_]+)\}\}/g, '<span class="px-1 py-0.5 rounded bg-primary/10 text-primary text-[11px] font-mono">{{$1}}</span>')
    .replace(/^### (.*)$/gm, "<h3>$1</h3>")
    .replace(/^## (.*)$/gm, "<h2>$1</h2>")
    .replace(/^# (.*)$/gm, "<h1>$1</h1>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/_(.+?)_/g, "<em>$1</em>")
    .replace(/^- (.+)$/gm, "<li>$1</li>")
    .replace(/(<li>[\s\S]+?<\/li>)/g, "<ul>$1</ul>")
    .split(/\n{2,}/)
    .map((para) => /^<(h\d|ul|ol|table)/.test(para) ? para : `<p>${para.replace(/\n/g, "<br/>")}</p>`)
    .join("\n");
  return html;
}
