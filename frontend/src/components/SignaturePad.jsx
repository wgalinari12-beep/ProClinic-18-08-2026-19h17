import React, { useRef, useEffect, useState } from "react";
import SignatureCanvas from "react-signature-canvas";
import { Button } from "@/components/ui/button";
import { Eraser, Check } from "lucide-react";

/**
 * SignaturePad
 * Props:
 *   value?: string (data URL)
 *   onChange?: (dataUrl|null) => void
 *   label?: string
 *   testid?: string
 */
export default function SignaturePad({ value, onChange, label = "Assinatura", testid }) {
  const ref = useRef(null);
  const wrapperRef = useRef(null);
  const [hasInk, setHasInk] = useState(!!value);
  const [size, setSize] = useState({ width: 600, height: 180 });

  // Resize canvas to wrapper width
  useEffect(() => {
    const update = () => {
      if (!wrapperRef.current) return;
      const w = wrapperRef.current.clientWidth || 600;
      setSize({ width: w, height: 180 });
    };
    update();
    const ro = new ResizeObserver(update);
    if (wrapperRef.current) ro.observe(wrapperRef.current);
    return () => ro.disconnect();
  }, []);

  // Restore existing
  useEffect(() => {
    if (value && ref.current && !hasInk) {
      try { ref.current.fromDataURL(value); setHasInk(true); } catch { /* ignore */ }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, size]);

  const clear = () => {
    ref.current?.clear();
    setHasInk(false);
    onChange?.(null);
  };

  const save = () => {
    if (!ref.current || ref.current.isEmpty()) return;
    const dataUrl = ref.current.toDataURL("image/png");
    onChange?.(dataUrl);
  };

  return (
    <div data-testid={testid}>
      {label && (
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">{label}</div>
      )}
      <div ref={wrapperRef} className="rounded-xl border border-border bg-card overflow-hidden">
        <SignatureCanvas
          ref={ref}
          penColor="hsl(var(--foreground))"
          canvasProps={{
            width: size.width,
            height: size.height,
            className: "block w-full bg-card",
            "data-testid": `${testid}-canvas`,
          }}
          onEnd={() => { setHasInk(true); save(); }}
        />
      </div>
      <div className="mt-2 flex items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={clear} data-testid={`${testid}-clear-btn`} className="rounded-lg h-8 text-xs">
          <Eraser className="h-3 w-3 mr-1" /> Limpar
        </Button>
        {hasInk && (
          <span className="text-[11px] text-success flex items-center gap-1">
            <Check className="h-3 w-3" /> Assinatura capturada
          </span>
        )}
      </div>
    </div>
  );
}
