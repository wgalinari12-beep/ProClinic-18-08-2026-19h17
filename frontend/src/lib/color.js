// Utilitários de cor para a Identidade Visual da clínica.
// Convertem HEX -> HSL (triplet compatível com as CSS variables do tema),
// validam HEX e determinam a cor de texto (contraste) automaticamente.

export function isValidHex(hex) {
  return typeof hex === "string" && /^#[0-9a-fA-F]{6}$/.test(hex.trim());
}

export function normalizeHex(hex) {
  if (typeof hex !== "string") return "";
  let h = hex.trim();
  if (h && !h.startsWith("#")) h = `#${h}`;
  // expande #abc -> #aabbcc
  if (/^#[0-9a-fA-F]{3}$/.test(h)) {
    h = `#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}`;
  }
  return h.toLowerCase();
}

export function hexToRgb(hex) {
  const h = normalizeHex(hex).replace("#", "");
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

// Retorna "H S% L%" (formato usado pelas CSS variables --primary etc.)
export function hexToHslTriplet(hex) {
  const o = hexToHsl(hex);
  if (!o) return null;
  return `${o.h} ${o.s}% ${o.l}%`;
}

// Conversão HEX -> HSL numérico ({ h: 0..360, s: 0..100, l: 0..100 }).
export function hexToHsl(hex) {
  if (!isValidHex(normalizeHex(hex))) return null;
  const { r, g, b } = hexToRgb(hex);
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  const d = max - min;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rn: h = (gn - bn) / d + (gn < bn ? 6 : 0); break;
      case gn: h = (bn - rn) / d + 2; break;
      default: h = (rn - gn) / d + 4;
    }
    h /= 6;
  }
  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}

// Conversão HSL numérico -> HEX.
export function hslToHex(h, s, l) {
  const sn = Math.min(100, Math.max(0, s)) / 100;
  const ln = Math.min(100, Math.max(0, l)) / 100;
  const c = (1 - Math.abs(2 * ln - 1)) * sn;
  const hp = ((h % 360) + 360) % 360 / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0, g = 0, b = 0;
  if (hp >= 0 && hp < 1) { r = c; g = x; }
  else if (hp < 2) { r = x; g = c; }
  else if (hp < 3) { g = c; b = x; }
  else if (hp < 4) { g = x; b = c; }
  else if (hp < 5) { r = x; b = c; }
  else { r = c; b = x; }
  const m = ln - c / 2;
  const to2 = (v) => Math.round((v + m) * 255).toString(16).padStart(2, "0");
  return `#${to2(r)}${to2(g)}${to2(b)}`;
}

// Luminância relativa (WCAG) para decidir texto claro/escuro sobre a cor.
export function relativeLuminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  const toLin = (c) => {
    const cs = c / 255;
    return cs <= 0.03928 ? cs / 12.92 : Math.pow((cs + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * toLin(r) + 0.7152 * toLin(g) + 0.0722 * toLin(b);
}

// Triplet HSL da cor de texto ideal (branco ou quase-preto) sobre a cor dada.
export function getContrastForegroundTriplet(hex) {
  if (!isValidHex(normalizeHex(hex))) return null;
  return relativeLuminance(hex) > 0.45 ? "0 0% 13%" : "0 0% 100%";
}

// Versão HEX da cor de contraste (para preview com inline styles).
export function getContrastHex(hex) {
  if (!isValidHex(normalizeHex(hex))) return "#222222";
  return relativeLuminance(hex) > 0.45 ? "#222222" : "#ffffff";
}

// Razão de contraste WCAG entre duas cores HEX (>= 1). Ex.: 4.5, 3.0.
export function contrastRatio(hexA, hexB) {
  const la = relativeLuminance(hexA);
  const lb = relativeLuminance(hexB);
  const hi = Math.max(la, lb) + 0.05;
  const lo = Math.min(la, lb) + 0.05;
  return hi / lo;
}

// toLegibleHex — Ajusta a LUMINOSIDADE da cor da marca (preservando matiz e
// saturação) para garantir legibilidade quando usada como TEXTO/ÍCONE sobre
// fundo claro, sem torná-la escura demais para o tema escuro.
//   - Mantém a cor dentro de uma faixa de luminosidade segura [minL, maxL];
//   - Se o contraste (WCAG) contra o fundo de referência (branco) ficar abaixo
//     de `target`, reduz a luminosidade em passos até atingir o alvo ou minL.
// Cores já legíveis (incluindo os tons padrão do ProClinic) permanecem
// praticamente inalteradas.
export function toLegibleHex(hex, opts = {}) {
  const { bg = "#ffffff", target = 3.0, minL = 30, maxL = 62 } = opts;
  const hsl = hexToHsl(hex);
  if (!hsl) return normalizeHex(hex);
  let { h, s, l } = hsl;
  l = Math.min(maxL, Math.max(minL, l));
  let guard = 0;
  while (guard++ < 80) {
    const cand = hslToHex(h, s, l);
    if (contrastRatio(cand, bg) >= target || l <= minL) return cand;
    l -= 1;
  }
  return hslToHex(h, s, l);
}
