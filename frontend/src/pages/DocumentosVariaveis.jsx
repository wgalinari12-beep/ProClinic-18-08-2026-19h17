import React, { useEffect, useState } from "react";
import api from "@/lib/api";
import PageHeader from "@/components/PageHeader";
import DocumentosSubNav from "@/components/DocumentosSubNav";
import { Loader2, Copy, Check } from "lucide-react";
import { toast } from "sonner";

export default function DocumentosVariaveis() {
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get("/document-templates/variables");
        setGroups(data.groups || []);
      } catch {
        toast.error("Erro ao carregar variáveis");
      } finally { setLoading(false); }
    })();
  }, []);

  const copy = async (token) => {
    const tag = `{{${token}}}`;
    try {
      await navigator.clipboard.writeText(tag);
      setCopied(token);
      toast.success(`Copiado: ${tag}`);
      setTimeout(() => setCopied((c) => (c === token ? null : c)), 1500);
    } catch { toast.error("Não foi possível copiar"); }
  };

  return (
    <div data-testid="documentos-variaveis-page">
      <PageHeader title="Variáveis" subtitle="Tokens dinâmicos disponíveis nos modelos — clique para copiar" />
      <DocumentosSubNav />
      <div className="p-6 sm:p-8 animate-fade-up">
        {loading ? (
          <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
        ) : (
          <div className="space-y-6">
            <p className="text-sm text-muted-foreground">
              Cada variável funciona em <strong>dois formatos</strong>: o clássico em maiúsculas (PT) e o novo em minúsculas (EN). Ambos produzem o mesmo resultado.
            </p>
            {groups.map((g) => (
              <section key={g.group} className="rounded-2xl border border-border bg-card overflow-hidden" data-testid={`var-group-${g.group}`}>
                <div className="px-5 py-3 border-b border-border bg-muted/30">
                  <h2 className="font-display text-base font-semibold tracking-tight">{g.group}</h2>
                </div>
                <div className="divide-y divide-border">
                  {g.vars.map((v) => (
                    <div key={v.token} className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 px-5 py-3">
                      <div className="sm:w-48 shrink-0">
                        <div className="text-sm font-medium">{v.label}</div>
                        <div className="text-[11px] text-muted-foreground">Ex.: {v.example}</div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {[{ t: v.token, tag: "PT" }, { t: v.token_en, tag: "EN" }].map(({ t, tag }) => (
                          <button key={t} onClick={() => copy(t)}
                            data-testid={`copy-var-${t}`}
                            className="group inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 py-1.5 font-mono text-[11px] hover:border-primary/50 transition-colors">
                            <span className="text-[9px] not-italic font-sans uppercase tracking-wide text-muted-foreground">{tag}</span>
                            <span>{`{{${t}}}`}</span>
                            {copied === t ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3 text-muted-foreground group-hover:text-primary" />}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
