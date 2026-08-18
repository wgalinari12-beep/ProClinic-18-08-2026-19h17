import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import api from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import {
  hexToHslTriplet, getContrastForegroundTriplet, isValidHex, normalizeHex, toLegibleHex,
} from "@/lib/color";

const ClinicBrandContext = createContext(null);

// Cache ESCOPADO POR CLÍNICA: nunca aplicar branding de uma clínica em outra.
const CACHE_PREFIX = "pc_brand_";
const cacheKey = (clinicId) => (clinicId ? `${CACHE_PREFIX}${clinicId}` : null);
const BRAND_FIELDS = ["primary_color", "secondary_color", "accent_color", "logo_url"];

// Mapa: campo da clínica -> [var da cor, var do texto (contraste), var extra (ring)]
const VAR_MAP = [
  ["primary_color", "--primary", "--primary-foreground", "--ring"],
  ["secondary_color", "--secondary", "--secondary-foreground", null],
  ["accent_color", "--accent", "--accent-foreground", null],
];

const ALL_VARS = [
  "--primary", "--primary-foreground", "--ring",
  "--secondary", "--secondary-foreground",
  "--accent", "--accent-foreground",
];

// Aplica as cores da clínica sobrescrevendo as CSS variables no <html>.
// A cor é normalizada para uma versão legível (toLegibleHex) para não permitir
// que uma escolha muito clara torne textos/ícones (text-primary, text-secondary)
// ilegíveis. O foreground (texto sobre a cor) é derivado da MESMA cor ajustada.
// Cores inválidas/ausentes voltam ao padrão do tema (removeProperty).
export function applyBrandVars(brand) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  VAR_MAP.forEach(([field, varName, fgName, ringName]) => {
    const hex = normalizeHex(brand?.[field] || "");
    if (isValidHex(hex)) {
      const safe = toLegibleHex(hex);
      root.style.setProperty(varName, hexToHslTriplet(safe));
      if (fgName) root.style.setProperty(fgName, getContrastForegroundTriplet(safe));
      if (ringName) root.style.setProperty(ringName, hexToHslTriplet(safe));
    } else {
      root.style.removeProperty(varName);
      if (fgName) root.style.removeProperty(fgName);
      if (ringName) root.style.removeProperty(ringName);
    }
  });
}

export function clearBrandVars() {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  ALL_VARS.forEach((v) => root.style.removeProperty(v));
}

function readCache(clinicId) {
  const key = cacheKey(clinicId);
  if (!key) return null;
  try { return JSON.parse(localStorage.getItem(key) || "null"); } catch { return null; }
}

function writeCache(clinicId, brand) {
  const key = cacheKey(clinicId);
  if (!key) return;
  try { localStorage.setItem(key, JSON.stringify(brand)); } catch { /* ignore */ }
}

export function ClinicBrandProvider({ children }) {
  const { user } = useAuth();
  const [brand, setBrand] = useState(null);
  const clinicId = user?.clinic_id || null;
  // Guarda a clínica ativa: evita que uma resposta tardia de refreshBrand de
  // uma clínica anterior seja aplicada após a troca de conta (race condition).
  const activeClinicRef = useRef(null);

  // Fonte de verdade: identidade visual persistida no backend (isolada por
  // clinic_id via JWT — o frontend nunca informa qual clínica carregar).
  const refreshBrand = useCallback(async () => {
    if (!clinicId) return null;
    try {
      const { data } = await api.get("/clinic");
      // Descarta se a clínica ativa mudou durante o fetch.
      if (activeClinicRef.current !== clinicId) return null;
      const b = {};
      BRAND_FIELDS.forEach((k) => { b[k] = data?.[k] ?? null; });
      setBrand(b);
      applyBrandVars(b);
      writeCache(clinicId, b);
      return b;
    } catch {
      return null;
    }
  }, [clinicId]);

  useEffect(() => {
    activeClinicRef.current = clinicId;
    if (clinicId) {
      // 1) Aplica imediatamente o cache DESTA clínica (reduz flash, sem risco
      //    cross-tenant pois a chave é pc_brand_<clinic_id>).
      const cached = readCache(clinicId);
      if (cached) {
        setBrand(cached);
        applyBrandVars(cached);
      } else {
        // Sem cache desta clínica: garante que nenhum tema residual permaneça.
        clearBrandVars();
        setBrand(null);
      }
      // 2) Reconciliação com o backend (fonte de verdade).
      refreshBrand();
    } else {
      // Logout / sem usuário: volta ao tema padrão do ProClinic e limpa o estado
      // do contexto. Os caches individuais por clínica são preservados (seguros,
      // pois só são aplicados quando o clinic_id correspondente estiver logado).
      clearBrandVars();
      setBrand(null);
    }
  }, [clinicId, refreshBrand]);

  // Preview ao vivo (opcional) para telas de configuração.
  const applyPreview = useCallback((b) => applyBrandVars(b), []);
  const clearPreview = useCallback(() => applyBrandVars(brand), [brand]);

  return (
    <ClinicBrandContext.Provider
      value={{ brand, logoUrl: brand?.logo_url || null, refreshBrand, applyPreview, clearPreview }}
    >
      {children}
    </ClinicBrandContext.Provider>
  );
}

export const useClinicBrand = () => useContext(ClinicBrandContext) || {};
