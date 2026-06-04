import React, { useEffect, useMemo, useState } from "react";
import api from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, Loader2, Link as LinkIcon, Copy, Save, FileText } from "lucide-react";
import { toast } from "sonner";

const STATUS_LABEL = {
  rascunho: { label: "Rascunho", cls: "bg-muted text-muted-foreground" },
  enviado: { label: "Enviado", cls: "bg-primary/10 text-primary" },
  aprovado: { label: "Aprovado", cls: "bg-success/15 text-success" },
  recusado: { label: "Recusado", cls: "bg-destructive/15 text-destructive" },
  expirado: { label: "Expirado", cls: "bg-muted text-muted-foreground" },
};

const moneyBR = (n) =>
  (Number(n) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const EMPTY_ITEM = {
  procedure_id: null, name: "", quantity: 1, unit_price: 0,
  discount_percent: 0, discount_value: 0,
};

/**
 * BudgetEditor — create/edit a budget for a patient.
 *
 * Props:
 *  patientId: string (required)
 *  appointmentId?: string
 *  budgetId?: string (load existing)
 *  onSaved?: (budget) => void
 */
export default function BudgetEditor({ patientId, appointmentId, budgetId, onSaved }) {
  const [procedures, setProcedures] = useState([]);
  const [items, setItems] = useState([{ ...EMPTY_ITEM }]);
  const [notes, setNotes] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("pix");
  const [installments, setInstallments] = useState(1);
  const [validUntil, setValidUntil] = useState("");
  const [status, setStatus] = useState("rascunho");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(null); // saved budget object

  // load procedures + budget if editing
  useEffect(() => {
    (async () => {
      try {
        const { data: procs } = await api.get("/procedures", { params: { active_only: true } });
        setProcedures(procs);
      } catch { /* ignore */ }
      if (budgetId) {
        try {
          const { data } = await api.get(`/budgets/${budgetId}`);
          hydrate(data);
        } catch { /* ignore */ }
      }
    })();
    // eslint-disable-next-line
  }, [budgetId]);

  const hydrate = (b) => {
    setLoaded(b);
    setItems(b.items?.length ? b.items : [{ ...EMPTY_ITEM }]);
    setNotes(b.notes || "");
    setPaymentMethod(b.payment_method || "pix");
    setInstallments(b.installments || 1);
    setValidUntil(b.valid_until || "");
    setStatus(b.status || "rascunho");
  };

  const totals = useMemo(() => {
    let subtotal = 0, discount = 0;
    items.forEach((it) => {
      const gross = (Number(it.quantity) || 0) * (Number(it.unit_price) || 0);
      const pct = Number(it.discount_percent) || 0;
      const val = Number(it.discount_value) || 0;
      const d = Math.min(gross, gross * pct / 100 + val);
      subtotal += gross;
      discount += d;
    });
    return { subtotal, discount, total: Math.max(0, subtotal - discount) };
  }, [items]);

  const updateItem = (idx, patch) => {
    setItems((arr) => arr.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  };
  const addItem = () => setItems((arr) => [...arr, { ...EMPTY_ITEM }]);
  const removeItem = (idx) => setItems((arr) => arr.length === 1 ? [{ ...EMPTY_ITEM }] : arr.filter((_, i) => i !== idx));

  const onPickProcedure = (idx, procId) => {
    const p = procedures.find((x) => x.procedure_id === procId);
    if (!p) { updateItem(idx, { procedure_id: null }); return; }
    updateItem(idx, { procedure_id: p.procedure_id, name: p.name, unit_price: p.price });
  };

  const save = async (nextStatus) => {
    if (!patientId) { toast.error("Paciente requerido"); return; }
    setBusy(true);
    try {
      const payload = {
        patient_id: patientId,
        appointment_id: appointmentId || null,
        items: items.map((it) => ({
          procedure_id: it.procedure_id || null,
          name: it.name,
          quantity: Number(it.quantity) || 0,
          unit_price: Number(it.unit_price) || 0,
          discount_percent: Number(it.discount_percent) || 0,
          discount_value: Number(it.discount_value) || 0,
        })),
        notes,
        payment_method: paymentMethod,
        installments: Number(installments) || 1,
        valid_until: validUntil || null,
        status: nextStatus || status,
      };
      const { data } = loaded?.budget_id
        ? await api.put(`/budgets/${loaded.budget_id}`, payload)
        : await api.post(`/budgets`, payload);
      hydrate(data);
      toast.success(loaded ? "Orçamento atualizado" : "Orçamento criado");
      onSaved?.(data);
      return data;
    } catch (e) {
      toast.error("Erro ao salvar orçamento");
      return null;
    } finally { setBusy(false); }
  };

  const copyPublicLink = async () => {
    if (!loaded?.budget_id) {
      const saved = await save("enviado");
      if (!saved) return;
    }
    try {
      const { data } = await api.get(`/budgets/${loaded?.budget_id || (await save("enviado"))?.budget_id}/public-link`);
      const url = `${window.location.origin}/orcamento/${data.token}`;
      await navigator.clipboard.writeText(url);
      toast.success("Link copiado para a área de transferência");
    } catch { toast.error("Erro ao gerar link"); }
  };

  return (
    <div className="space-y-5" data-testid="budget-editor">
      {/* Header summary */}
      <div className="flex items-center justify-between">
        <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Orçamento</div>
        <Badge className={`${STATUS_LABEL[status]?.cls} border-0 text-[10px]`} data-testid="budget-status">
          {STATUS_LABEL[status]?.label || status}
        </Badge>
      </div>

      {/* Items */}
      <div className="rounded-2xl border border-border bg-card overflow-hidden">
        <div className="grid grid-cols-[1fr_80px_120px_90px_120px_40px] gap-2 px-4 py-2 bg-muted/30 text-[10px] uppercase tracking-wider text-muted-foreground">
          <div>Item</div>
          <div className="text-right">Qtd</div>
          <div className="text-right">Valor unit.</div>
          <div className="text-right">Desc %</div>
          <div className="text-right">Desc R$</div>
          <div />
        </div>
        <div className="divide-y divide-border">
          {items.map((it, idx) => (
            <div key={idx} className="grid grid-cols-[1fr_80px_120px_90px_120px_40px] gap-2 px-4 py-2 items-center" data-testid={`budget-item-${idx}`}>
              <div className="space-y-1">
                <select
                  value={it.procedure_id || ""}
                  onChange={(e) => onPickProcedure(idx, e.target.value)}
                  className="w-full h-9 rounded-lg border border-border bg-card px-2 text-xs"
                  data-testid={`budget-proc-select-${idx}`}
                >
                  <option value="">— manual —</option>
                  {procedures.map((p) => (
                    <option key={p.procedure_id} value={p.procedure_id}>{p.name}</option>
                  ))}
                </select>
                <Input
                  value={it.name}
                  onChange={(e) => updateItem(idx, { name: e.target.value })}
                  placeholder="Descrição do item"
                  className="h-9 rounded-lg text-sm"
                  data-testid={`budget-item-name-${idx}`}
                />
              </div>
              <Input type="number" min="0" step="1" value={it.quantity}
                onChange={(e) => updateItem(idx, { quantity: e.target.value })}
                className="h-9 rounded-lg text-sm text-right" data-testid={`budget-item-qty-${idx}`} />
              <Input type="number" min="0" step="0.01" value={it.unit_price}
                onChange={(e) => updateItem(idx, { unit_price: e.target.value })}
                className="h-9 rounded-lg text-sm text-right" data-testid={`budget-item-price-${idx}`} />
              <Input type="number" min="0" max="100" step="0.01" value={it.discount_percent}
                onChange={(e) => updateItem(idx, { discount_percent: e.target.value })}
                className="h-9 rounded-lg text-sm text-right" data-testid={`budget-item-discpct-${idx}`} />
              <Input type="number" min="0" step="0.01" value={it.discount_value}
                onChange={(e) => updateItem(idx, { discount_value: e.target.value })}
                className="h-9 rounded-lg text-sm text-right" data-testid={`budget-item-discval-${idx}`} />
              <Button type="button" size="icon" variant="ghost"
                onClick={() => removeItem(idx)}
                className="h-8 w-8 rounded-lg text-destructive"
                data-testid={`budget-item-remove-${idx}`}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
        <div className="px-4 py-2 border-t border-border">
          <Button type="button" variant="ghost" size="sm" onClick={addItem} className="rounded-lg h-8 text-xs" data-testid="budget-add-item">
            <Plus className="h-3.5 w-3.5 mr-1" /> Adicionar item
          </Button>
        </div>
      </div>

      {/* Payment & validity */}
      <div className="grid grid-cols-3 gap-4">
        <div className="space-y-1.5">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">Pagamento</Label>
          <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}
            data-testid="budget-payment-method"
            className="w-full h-11 rounded-xl border border-border bg-card px-3 text-sm">
            <option value="pix">PIX</option>
            <option value="cartão">Cartão</option>
            <option value="dinheiro">Dinheiro</option>
            <option value="boleto">Boleto</option>
            <option value="parcelado">Parcelado</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">Parcelas</Label>
          <Input type="number" min="1" max="24" value={installments}
            onChange={(e) => setInstallments(e.target.value)}
            className="h-11 rounded-xl" data-testid="budget-installments" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">Validade</Label>
          <Input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)}
            className="h-11 rounded-xl" data-testid="budget-valid-until" />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs uppercase tracking-wider text-muted-foreground">Observações</Label>
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)}
          placeholder="Condições, garantias, observações..." rows={2} className="rounded-xl" data-testid="budget-notes" />
      </div>

      {/* Totals */}
      <div className="rounded-2xl border border-border bg-muted/30 p-4 space-y-1 text-sm" data-testid="budget-totals">
        <div className="flex justify-between text-muted-foreground">
          <span>Subtotal</span><span className="font-mono">{moneyBR(totals.subtotal)}</span>
        </div>
        <div className="flex justify-between text-muted-foreground">
          <span>Descontos</span><span className="font-mono">- {moneyBR(totals.discount)}</span>
        </div>
        <div className="flex justify-between font-display text-lg font-semibold pt-1 border-t border-border">
          <span>Total</span><span className="font-mono" data-testid="budget-total">{moneyBR(totals.total)}</span>
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
        <div className="text-[11px] text-muted-foreground">
          {loaded ? `Salvo em ${new Date(loaded.updated_at || loaded.created_at).toLocaleString("pt-BR")}` : "Não salvo"}
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" className="rounded-xl" onClick={() => save("rascunho")} disabled={busy} data-testid="budget-save-draft">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Save className="h-3.5 w-3.5 mr-1.5" /> Salvar rascunho</>}
          </Button>
          <Button type="button" variant="outline" className="rounded-xl" onClick={copyPublicLink} disabled={busy} data-testid="budget-public-link">
            <LinkIcon className="h-3.5 w-3.5 mr-1.5" /> Copiar link público
          </Button>
          <Button type="button" className="rounded-xl bg-primary text-primary-foreground hover:bg-primary/90"
            onClick={() => save("enviado")} disabled={busy} data-testid="budget-send">
            <FileText className="h-3.5 w-3.5 mr-1.5" /> Salvar e enviar
          </Button>
        </div>
      </div>
    </div>
  );
}
