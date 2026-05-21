import React, { useEffect, useRef, useState } from "react";
import api from "@/lib/api";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Sparkles, Send, Loader2, User as UserIcon } from "lucide-react";
import { toast } from "sonner";
import { formatApiErrorDetail } from "@/lib/api";

const SUGGESTIONS = [
  "Sugira um protocolo de 3 sessões para flacidez facial leve em paciente de 45 anos.",
  "Quais cuidados pós-procedimento devo orientar após preenchimento labial?",
  "Resuma os principais cuidados pré e pós Ultraformer.",
  "Quais contraindicações principais para botox?",
];

export default function AIAssistant() {
  const [sessionId] = useState(() => `sess_${Date.now()}`);
  const [messages, setMessages] = useState([
    { role: "assistant", content: "Olá! Sou a assistente clínica do ProClinic. Posso ajudar com protocolos, resumos clínicos, dúvidas administrativas e muito mais. Em que posso ser útil hoje?" },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const send = async (text) => {
    const msg = (text ?? input).trim();
    if (!msg || busy) return;
    setMessages((m) => [...m, { role: "user", content: msg }]);
    setInput("");
    setBusy(true);
    try {
      const { data } = await api.post("/ai/chat", { message: msg, session_id: sessionId });
      setMessages((m) => [...m, { role: "assistant", content: data.reply }]);
    } catch (err) {
      toast.error(formatApiErrorDetail(err.response?.data?.detail) || err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-testid="ai-page">
      <PageHeader
        title="Assistente IA"
        subtitle="Powered by Claude · sugestões de protocolos, resumos clínicos e organização"
      />

      <div className="p-6 sm:p-8 max-w-4xl mx-auto animate-fade-up">
        <div className="rounded-2xl border border-border bg-card overflow-hidden flex flex-col" style={{ height: "calc(100vh - 240px)" }}>
          <div className="flex-1 overflow-y-auto px-6 py-6 space-y-5">
            {messages.map((m, i) => (
              <div key={i} data-testid={`ai-msg-${i}`} className={`flex gap-3 ${m.role === "user" ? "flex-row-reverse" : ""}`}>
                <div className={`h-9 w-9 shrink-0 rounded-xl flex items-center justify-center ${m.role === "user" ? "bg-secondary/15 ring-1 ring-secondary/30" : "bg-primary/10 ring-1 ring-primary/30"}`}>
                  {m.role === "user" ? <UserIcon className="h-4 w-4 text-secondary" strokeWidth={1.5} /> : <Sparkles className="h-4 w-4 text-primary" strokeWidth={1.5} />}
                </div>
                <div className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${m.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted/40"}`}>
                  {m.content}
                </div>
              </div>
            ))}
            {busy && (
              <div className="flex gap-3">
                <div className="h-9 w-9 rounded-xl bg-primary/10 ring-1 ring-primary/30 flex items-center justify-center">
                  <Sparkles className="h-4 w-4 text-primary" strokeWidth={1.5} />
                </div>
                <div className="bg-muted/40 rounded-2xl px-4 py-3 text-sm">
                  <Loader2 className="h-4 w-4 animate-spin" />
                </div>
              </div>
            )}
            <div ref={endRef} />
          </div>

          {/* Suggestions */}
          {messages.length === 1 && (
            <div className="px-6 pb-3 flex flex-wrap gap-2">
              {SUGGESTIONS.map((s, i) => (
                <button
                  key={i}
                  data-testid={`ai-suggest-${i}`}
                  onClick={() => send(s)}
                  className="text-xs text-muted-foreground px-3 py-1.5 rounded-full border border-border hover:border-primary/40 hover:text-foreground transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          )}

          <div className="border-t border-border p-4">
            <div className="flex items-end gap-2">
              <Textarea
                data-testid="ai-input"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
                placeholder="Pergunte algo... Ex: 'Sugira um protocolo para melasma'"
                rows={2}
                className="rounded-xl resize-none"
              />
              <Button onClick={() => send()} disabled={busy || !input.trim()} className="rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 h-11" data-testid="ai-send-btn">
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
