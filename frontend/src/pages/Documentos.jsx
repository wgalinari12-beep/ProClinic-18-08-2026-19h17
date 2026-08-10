import React, { useEffect, useState } from "react";
import api from "@/lib/api";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import DocumentTemplateEditor from "@/components/DocumentTemplateEditor";
import DocumentGenerator from "@/components/DocumentGenerator";
import { Plus, FileText, Library, History, ExternalLink, Trash2, Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";

const STATUS_LABEL = {
  rascunho: { label: "Rascunho", cls: "bg-muted text-muted-foreground" },
  aguardando_paciente: { label: "Aguardando paciente", cls: "bg-amber-500/15 text-amber-600" },
  aguardando_profissional: { label: "Aguardando profissional", cls: "bg-amber-500/15 text-amber-600" },
  finalizado: { label: "Finalizado", cls: "bg-success/15 text-success" },
};

export default function Documentos() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [tab, setTab] = useState(isAdmin ? "library" : "history");
  const [templates, setTemplates] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [contDoc, setContDoc] = useState(null); // F2: {docId, patientId} — retomar documento

  const loadAll = async () => {
    setLoading(true);
    try {
      const calls = [api.get("/documents")];
      if (isAdmin) calls.push(api.get("/document-templates"));
      const res = await Promise.all(calls);
      setDocuments(res[0].data);
      if (isAdmin) setTemplates(res[1].data);
    } catch (e) {
      console.error(e);
    } finally { setLoading(false); }
  };

  useEffect(() => { loadAll(); }, []);

  const deleteTemplate = async (id) => {
    if (!window.confirm("Excluir este modelo?")) return;
    try {
      await api.delete(`/document-templates/${id}`);
      toast.success("Modelo excluído");
      loadAll();
    } catch { toast.error("Erro ao excluir"); }
  };

  return (
    <div data-testid="documentos-page">
      <PageHeader
        title="Documentos Jurídicos"
        subtitle="Modelos, contratos e consentimentos digitais"
        actions={
          isAdmin && (
            <Button onClick={() => { setEditingId(null); setEditorOpen(true); }}
              className="rounded-xl bg-primary text-primary-foreground hover:bg-primary/90"
              data-testid="new-template-btn">
              <Plus className="h-4 w-4 mr-1.5" /> Novo modelo
            </Button>
          )
        }
      />

      <div className="p-6 sm:p-8 animate-fade-up">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="bg-muted/40 rounded-xl max-w-full overflow-x-auto justify-start">
            {isAdmin && (
              <TabsTrigger value="library" data-testid="tab-library" className="rounded-lg data-[state=active]:bg-card data-[state=active]:text-primary">
                <Library className="h-4 w-4 mr-1.5" /> Biblioteca de modelos
              </TabsTrigger>
            )}
            <TabsTrigger value="history" data-testid="tab-history" className="rounded-lg data-[state=active]:bg-card data-[state=active]:text-primary">
              <History className="h-4 w-4 mr-1.5" /> Documentos assinados
            </TabsTrigger>
          </TabsList>

          {isAdmin && (
            <TabsContent value="library" className="mt-5">
              {loading ? (
                <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
              ) : templates.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border p-10 text-center">
                  <FileText className="h-10 w-10 text-muted-foreground/40 mx-auto mb-3" strokeWidth={1.5} />
                  <p className="text-sm text-muted-foreground">Nenhum modelo cadastrado ainda.</p>
                  <Button onClick={() => { setEditingId(null); setEditorOpen(true); }}
                    className="mt-4 rounded-xl bg-primary text-primary-foreground" data-testid="empty-create-template">
                    <Plus className="h-4 w-4 mr-1.5" /> Criar primeiro modelo
                  </Button>
                </div>
              ) : (
                <div className="grid sm:grid-cols-2 gap-3" data-testid="templates-grid">
                  {templates.map((t) => (
                    <div key={t.template_id} className="rounded-xl border border-border bg-card p-4 hover:border-primary/40 transition-colors group"
                      data-testid={`template-card-${t.template_id}`}>
                      <div className="flex items-start justify-between gap-2">
                        <button onClick={() => { setEditingId(t.template_id); setEditorOpen(true); }}
                          className="text-left flex-1" data-testid={`edit-template-${t.template_id}`}>
                          <div className="font-medium">{t.name}</div>
                          {t.description && <div className="text-xs text-muted-foreground mt-0.5">{t.description}</div>}
                          <div className="flex items-center gap-2 mt-2 text-[10px] text-muted-foreground">
                            <Badge variant="outline" className="uppercase tracking-wider text-[9px]">{t.category}</Badge>
                            {!t.active && <Badge variant="outline" className="text-[9px]">inativo</Badge>}
                          </div>
                        </button>
                        <Button variant="ghost" size="icon" onClick={() => deleteTemplate(t.template_id)}
                          className="h-8 w-8 rounded-lg text-destructive opacity-0 group-hover:opacity-100"
                          data-testid={`delete-template-${t.template_id}`}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>
          )}

          <TabsContent value="history" className="mt-5">
            {loading ? (
              <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
            ) : documents.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border p-10 text-center">
                <FileText className="h-10 w-10 text-muted-foreground/40 mx-auto mb-3" strokeWidth={1.5} />
                <p className="text-sm text-muted-foreground">Nenhum documento gerado.</p>
                <p className="text-xs text-muted-foreground/70 mt-1">Gere documentos durante o atendimento ou pela ficha do paciente.</p>
              </div>
            ) : (
              <div className="rounded-xl border border-border bg-card overflow-x-auto" data-testid="documents-list">
                <table className="w-full text-sm">
                  <thead className="bg-muted/30">
                    <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                      <th className="px-4 py-2">Documento</th>
                      <th className="px-4 py-2">Paciente</th>
                      <th className="px-4 py-2">Profissional</th>
                      <th className="px-4 py-2">Data</th>
                      <th className="px-4 py-2">Status</th>
                      <th className="px-4 py-2" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {documents.map((d) => (
                      <tr key={d.document_id} className="hover:bg-muted/20" data-testid={`doc-row-${d.document_id}`}>
                        <td className="px-4 py-3">{d.template_name}</td>
                        <td className="px-4 py-3">{d.patient_name}</td>
                        <td className="px-4 py-3">{d.professional_name}</td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">{format(parseISO(d.created_at), "dd/MM/yyyy HH:mm", { locale: ptBR })}</td>
                        <td className="px-4 py-3">
                          <Badge className={`${STATUS_LABEL[d.status]?.cls} border-0 text-[10px]`}>{STATUS_LABEL[d.status]?.label || d.status}</Badge>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            {d.pdf_url && (
                              <a href={`${process.env.REACT_APP_BACKEND_URL}${d.pdf_url}`} target="_blank" rel="noreferrer"
                                className="text-primary hover:underline text-xs inline-flex items-center gap-1"
                                data-testid={`doc-pdf-${d.document_id}`}>
                                PDF <ExternalLink className="h-3 w-3" />
                              </a>
                            )}
                            {d.status !== "finalizado" && (
                              <Button variant="outline" size="sm" className="h-7 rounded-lg text-[11px]"
                                onClick={() => setContDoc({ docId: d.document_id, patientId: d.patient_id })}
                                data-testid={`continue-doc-${d.document_id}`}>
                                Continuar
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>

      {/* Template editor dialog */}
      <Dialog open={editorOpen} onOpenChange={(o) => { setEditorOpen(o); if (!o) loadAll(); }}>
        <DialogContent className="max-w-5xl rounded-2xl max-h-[92vh] overflow-y-auto" data-testid="template-editor-dialog">
          <DialogHeader>
            <DialogTitle className="font-display text-xl tracking-tight">
              {editingId ? "Editar modelo" : "Novo modelo de documento"}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Use variáveis como <code className="text-primary">{`{{PACIENTE_NOME}}`}</code> — elas serão preenchidas automaticamente quando o documento for gerado.
            </DialogDescription>
          </DialogHeader>
          <DocumentTemplateEditor templateId={editingId} onSaved={() => { /* keep open for further edits */ }} />
        </DialogContent>
      </Dialog>

      {/* F2: retomar documento não finalizado */}
      <DocumentGenerator
        open={!!contDoc}
        onOpenChange={(o) => { if (!o) { setContDoc(null); loadAll(); } }}
        patientId={contDoc?.patientId}
        documentId={contDoc?.docId}
      />
    </div>
  );
}
