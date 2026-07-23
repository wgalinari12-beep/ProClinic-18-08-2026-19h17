import React, { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CheckCircle2, Loader2, Wallet } from "lucide-react";

const moneyBR = (n) => (Number(n) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/**
 * CompletePaymentDialog — asked when concluding an attendance.
 * Captures: payment_status (pago | parcial | nao_pago), amount, method, due date.
 *
 * Props:
 *  open, onOpenChange
 *  defaultTotal: number
 *  budgetTotal?: number (if a budget is linked)
 *  budgetId?: string
 *  onConfirm: (payload) => Promise<void>
 */
export default function CompletePaymentDialog({ open, onOpenChange, defaultTotal = 0, budgetTotal, budgetId, onConfirm }) {
  const [status, setStatus] = useState("pago");
  const [total, setTotal] = useState(0);
  const [paid, setPaid] = useState(0);
  const [method, setMethod] = useState("pix");
  const [dueDate, setDueDate] = useState("");
  const [installments, setInstallments] = useState(1);
  const [intervalDays, setIntervalDays] = useState(30);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      const t = budgetTotal != null ? Number(budgetTotal) : Number(defaultTotal) || 0;
      setTotal(t);
      setPaid(t);
      setStatus("pago");
      setMethod("pix");
      setDueDate("");
      setInstallments(1);
      setIntervalDays(30);
    }
  }, [open, defaultTotal, budgetTotal]);

  const submit = async () => {
    setBusy(true);
    try {
      await onConfirm({
        payment_status: status,
        amount_total: Number(total),
        amount_paid: status === "parcial" ? Number(paid) : null,
        payment_method: method,
        due_date: dueDate || null,
        budget_id: budgetId || null,
        installments: Number(installments) || 1,
        installment_interval_days: Number(intervalDays) || 30,
      });
    } finally { setBusy(false); }
  };

  const balance = Math.max(0, Number(total) - (status === "parcial" ? Number(paid) : 0));
  const perInstallment = installments > 0
    ? (status === "parcial" ? balance : Number(total)) / Number(installments)
    : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-2xl max-w-md" data-testid="complete-payment-dialog">
        <DialogHeader>
          <div className="h-12 w-12 rounded-xl bg-primary/10 ring-1 ring-primary/30 flex items-center justify-center mx-auto mb-2">
            <Wallet className="h-5 w-5 text-primary" strokeWidth={1.5} />
          </div>
          <DialogTitle className="font-display text-xl tracking-tight text-center">Concluir atendimento</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground text-center">
            Como ficou o pagamento? Um lançamento será criado no Financeiro automaticamente.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-2">
            {[
              { v: "pago", label: "Pago" },
              { v: "parcial", label: "Parcial" },
              { v: "nao_pago", label: "Não pago" },
            ].map((opt) => (
              <button key={opt.v} type="button"
                onClick={() => setStatus(opt.v)}
                data-testid={`pay-status-${opt.v}`}
                className={`h-10 rounded-xl border text-sm transition-colors ${
                  status === opt.v ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:text-foreground"
                }`}>
                {opt.label}
              </button>
            ))}
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Valor total</Label>
            <Input type="number" min="0" step="0.01" value={total}
              onChange={(e) => setTotal(e.target.value)} className="h-11 rounded-xl"
              data-testid="pay-total" />
          </div>

          {status === "parcial" && (
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Valor pago agora</Label>
              <Input type="number" min="0" step="0.01" value={paid}
                onChange={(e) => setPaid(e.target.value)} className="h-11 rounded-xl"
                data-testid="pay-paid-amount" />
              <p className="text-[11px] text-muted-foreground">
                Saldo restante: <span className="font-mono">{moneyBR(Math.max(0, Number(total) - Number(paid)))}</span>
              </p>
            </div>
          )}

          {status !== "pago" && (
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                {status === "parcial" ? "Vencimento do saldo" : "Vencimento"}
              </Label>
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)}
                className="h-11 rounded-xl" data-testid="pay-due-date" />
            </div>
          )}

          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Forma de pagamento</Label>
            <select value={method} onChange={(e) => setMethod(e.target.value)}
              data-testid="pay-method"
              className="w-full h-11 rounded-xl border border-border bg-card px-3 text-sm">
              <option value="pix">PIX</option>
              <option value="cartão">Cartão</option>
              <option value="dinheiro">Dinheiro</option>
              <option value="boleto">Boleto</option>
              <option value="parcelado">Parcelado</option>
            </select>
          </div>

          {status !== "pago" && (
            <div className="grid grid-cols-2 gap-3 rounded-xl border border-border bg-muted/30 p-3" data-testid="installments-block">
              <div className="space-y-1.5">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Parcelas</Label>
                <Input type="number" min="1" max="48" value={installments}
                  onChange={(e) => setInstallments(e.target.value)}
                  className="h-11 rounded-xl" data-testid="pay-installments" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Intervalo (dias)</Label>
                <Input type="number" min="1" max="120" value={intervalDays}
                  onChange={(e) => setIntervalDays(e.target.value)}
                  className="h-11 rounded-xl" data-testid="pay-interval-days" />
              </div>
              {installments > 1 && (
                <div className="col-span-2 text-[11px] text-muted-foreground">
                  {Number(installments)}x de <span className="font-mono">{moneyBR(perInstallment)}</span> a cada {intervalDays} dias
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="grid grid-cols-2 gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="rounded-xl" data-testid="pay-cancel">
            Cancelar
          </Button>
          <Button onClick={submit} disabled={busy} className="rounded-xl bg-primary text-primary-foreground hover:bg-primary/90" data-testid="pay-confirm">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <><CheckCircle2 className="h-4 w-4 mr-1.5" /> Confirmar</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
