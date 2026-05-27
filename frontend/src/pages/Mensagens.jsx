import React, { useEffect, useState } from "react";
import api from "@/lib/api";
import PageHeader from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MessageSquare, Send, Clock, CheckCheck, XCircle, AlertCircle } from "lucide-react";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";

const STATUS_META = {
  queued: { icon: Clock, color: "text-muted-foreground", label: "Na fila" },
  sent: { icon: CheckCheck, color: "text-success", label: "Enviado" },
  failed: { icon: XCircle, color: "text-destructive", label: "Falhou" },
};

export default function Mensagens() {
  const [messages, setMessages] = useState([]);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get("/messages");
        setMessages(data);
      } catch { /* ignore */ }
    })();
  }, []);

  return (
    <div data-testid="messages-page">
      <PageHeader
        title="Central de Mensagens"
        subtitle={`${messages.length} mensagens · WhatsApp será ativado em breve`}
      />
      <div className="p-6 sm:p-8 animate-fade-up">
        <div className="mb-6 p-4 rounded-xl border border-primary/30 bg-primary/5 flex items-start gap-3">
          <AlertCircle className="h-4 w-4 text-primary shrink-0 mt-0.5" />
          <div className="text-sm">
            <div className="font-medium">Integração Evolution API pendente</div>
            <p className="text-xs text-muted-foreground mt-0.5">
              As mensagens estão sendo enfileiradas no banco. Tão logo a credencial Evolution API
              for fornecida, todas as mensagens "Na fila" serão entregues automaticamente.
            </p>
          </div>
        </div>

        {messages.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground border border-dashed border-border rounded-2xl">
            Nenhuma mensagem ainda. Envie a primeira via Agenda → Detalhes → WhatsApp.
          </div>
        ) : (
          <div className="rounded-2xl border border-border bg-card overflow-hidden">
            <div className="divide-y divide-border">
              {messages.map((m) => {
                const meta = STATUS_META[m.status] || STATUS_META.queued;
                const Icon = meta.icon;
                return (
                  <div key={m.message_id} data-testid={`msg-${m.message_id}`} className="px-5 py-4 flex items-start gap-4">
                    <div className="h-9 w-9 shrink-0 rounded-xl bg-primary/10 ring-1 ring-primary/30 flex items-center justify-center">
                      <MessageSquare className="h-4 w-4 text-primary" strokeWidth={1.5} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">{m.patient_name}</span>
                        <span className="text-xs text-muted-foreground">{m.destination}</span>
                      </div>
                      <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{m.body}</p>
                      <div className="flex items-center gap-3 mt-2 text-[11px] text-muted-foreground">
                        <span>{format(parseISO(m.created_at), "dd/MM HH:mm", { locale: ptBR })}</span>
                        {m.template && <Badge variant="outline" className="text-[10px] font-normal h-4">{m.template}</Badge>}
                      </div>
                    </div>
                    <div className={`flex items-center gap-1.5 text-xs ${meta.color}`}>
                      <Icon className="h-3.5 w-3.5" />
                      {meta.label}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
