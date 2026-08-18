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
  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
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
