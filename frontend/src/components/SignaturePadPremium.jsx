import React, { useRef, useEffect, useState, useCallback } from "react";
import SignatureCanvas from "react-signature-canvas";
import { Eraser, Undo2, Check, AlertTriangle, PenLine } from "lucide-react";

/**
 * SignaturePadPremium — versão premium EXCLUSIVA do fluxo público (QR do paciente).
 * NÃO substitui o SignaturePad interno (Atendimento/DocumentGenerator permanecem intactos).
 *
 * Props:
 *   onChange?: (dataUrl|null) => void   -> dispara a assinatura confirmada (ou null ao limpar/editar)
 *   brand?: string (hex)                -> cor do traço (rose gold da clínica)
 *   testid?: string
 */
export default function SignaturePadPremium({ onChange, brand = "#B76E79", testid = "sig-premium" }) {
  const ref = useRef(null);
  const wrapperRef = useRef(null);
  const [size, setSize] = useState({ width: 600, height: 240 });
  const [dirty, setDirty] = useState(false); // há traço no canvas
  const [confirmed, setConfirmed] = useState(false); // assinatura capturada e válida

  // Redimensiona o canvas para a largura do container (altura confortável, min 240px)
  useEffect(() => {
    const update = () => {
      if (!wrapperRef.current) return;
      const w = wrapperRef.current.clientWidth || 600;
      const h = Math.max(240, Math.round(w * 0.42));
      setSize({ width: w, height: Math.min(h, 320) });
    };
    update();
    const ro = new ResizeObserver(update);
    if (wrapperRef.current) ro.observe(wrapperRef.current);
    return () => ro.disconnect();
  }, []);

  const invalidate = useCallback(() => {
    // Qualquer novo traço invalida a confirmação anterior
    if (confirmed) {
      setConfirmed(false);
      onChange?.(null);
    }
  }, [confirmed, onChange]);

  const handleBegin = () => {
    invalidate();
  };

  const handleEnd = () => {
    setDirty(ref.current && !ref.current.isEmpty());
  };

  const clear = () => {
    ref.current?.clear();
    setDirty(false);
    setConfirmed(false);
    onChange?.(null);
  };

  const undo = () => {
    if (!ref.current) return;
    const data = ref.current.toData();
    if (data && data.length) {
      data.pop();
      ref.current.fromData(data);
      const stillHasInk = data.length > 0;
      setDirty(stillHasInk);
      if (confirmed) { setConfirmed(false); onChange?.(null); }
    }
  };

  const confirm = () => {
    if (!ref.current || ref.current.isEmpty()) return;
    const dataUrl = ref.current.getTrimmedCanvas
      ? (() => { try { return ref.current.getTrimmedCanvas().toDataURL("image/png"); } catch { return ref.current.toDataURL("image/png"); } })()
      : ref.current.toDataURL("image/png");
    setConfirmed(true);
    onChange?.(dataUrl);
  };

  return (
    <div data-testid={testid}>
      {/* Área de desenho */}
      <div
        ref={wrapperRef}
        className="relative rounded-2xl border-2 border-dashed transition-colors overflow-hidden bg-white"
        style={{ borderColor: confirmed ? "#16a34a" : dirty ? brand : "#e5e7eb" }}
      >
        {/* linha-guia e placeholder */}
        {!dirty && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center select-none">
            <PenLine className="h-7 w-7 mb-2" style={{ color: brand, opacity: 0.5 }} strokeWidth={1.5} />
            <span className="text-sm text-gray-400">Assine aqui</span>
          </div>
        )}
        <div className="pointer-events-none absolute left-6 right-6 bottom-9 border-b border-gray-200" />
        <SignatureCanvas
          ref={ref}
          penColor={brand}
          minWidth={1.1}
          maxWidth={2.6}
          velocityFilterWeight={0.6}
          canvasProps={{
            width: size.width,
            height: size.height,
            className: "block w-full touch-none",
            style: { touchAction: "none" },
            "data-testid": `${testid}-canvas`,
          }}
          onBegin={handleBegin}
          onEnd={handleEnd}
        />
      </div>

      {/* Status em tempo real */}
      <div className="mt-3 min-h-[24px]" aria-live="polite">
        {confirmed ? (
          <div className="flex items-center gap-2 text-sm font-medium" style={{ color: "#16a34a" }} data-testid={`${testid}-status-ok`}>
            <Check className="h-4 w-4" strokeWidth={2.2} /> Assinatura capturada com sucesso
          </div>
        ) : (
          <div className="flex items-center gap-2 text-sm font-medium text-amber-600" data-testid={`${testid}-status-pending`}>
            <AlertTriangle className="h-4 w-4" strokeWidth={2} /> Assinatura pendente
          </div>
        )}
      </div>

      {/* Botões grandes (alvo de toque >= 44px) */}
      <div className="mt-3 grid grid-cols-3 gap-2">
        <button
          type="button"
          onClick={clear}
          disabled={!dirty && !confirmed}
          data-testid={`${testid}-clear`}
          className="h-12 rounded-xl border border-gray-200 bg-white text-gray-700 text-sm font-medium flex items-center justify-center gap-1.5 active:scale-[0.98] transition disabled:opacity-40"
        >
          <Eraser className="h-4 w-4" /> Limpar
        </button>
        <button
          type="button"
          onClick={undo}
          disabled={!dirty}
          data-testid={`${testid}-undo`}
          className="h-12 rounded-xl border border-gray-200 bg-white text-gray-700 text-sm font-medium flex items-center justify-center gap-1.5 active:scale-[0.98] transition disabled:opacity-40"
        >
          <Undo2 className="h-4 w-4" /> Refazer
        </button>
        <button
          type="button"
          onClick={confirm}
          disabled={!dirty || confirmed}
          data-testid={`${testid}-confirm`}
          className="h-12 rounded-xl text-sm font-semibold flex items-center justify-center gap-1.5 active:scale-[0.98] transition disabled:opacity-40 text-white"
          style={{ backgroundColor: confirmed ? "#16a34a" : brand }}
        >
          <Check className="h-4 w-4" /> {confirmed ? "Confirmada" : "Confirmar"}
        </button>
      </div>
    </div>
  );
}
