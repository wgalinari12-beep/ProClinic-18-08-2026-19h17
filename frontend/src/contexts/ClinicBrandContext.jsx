import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import api from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { hexToHslTriplet, getContrastForegroundTriplet, isValidHex, normalizeHex } from "@/lib/color";

const ClinicBrandContext = createContext(null);

const CACHE_KEY = "pc_brand";
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
// Cores inválidas/ausentes voltam ao padrão do tema (removeProperty).
export function applyBrandVars(brand) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  VAR_MAP.forEach(([field, varName, fgName, ringName]) => {
    const hex = normalizeHex(brand?.[field] || "");
    if (isValidHex(hex)) {
      root.style.setProperty(varName, hexToHslTriplet(hex));
      if (fgName) root.style.setProperty(fgName, getContrastForegroundTriplet(hex));
      if (ringName) root.style.setProperty(ringName, hexToHslTriplet(hex));
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

export function ClinicBrandProvider({ children }) {
  const { user } = useAuth();
  const [brand, setBrand] = useState(null);

  // Aplicação instantânea a partir do cache (evita flash ao recarregar).
  useEffect(() => {
    try {
      const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
      if (cached) {
        setBrand(cached);
        applyBrandVars(cached);
      }
    } catch { /* ignore */ }
  }, []);

  // Fonte de verdade: busca a identidade visual persistida no backend.
  const refreshBrand = useCallback(async () => {
    try {
      const { data } = await api.get("/clinic");
      const b = {};
      BRAND_FIELDS.forEach((k) => { b[k] = data?.[k] ?? null; });
      setBrand(b);
      applyBrandVars(b);
      localStorage.setItem(CACHE_KEY, JSON.stringify(b));
      return b;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    if (user) {
      refreshBrand();
    } else {
      // Logout: volta ao tema padrão do ProClinic.
      clearBrandVars();
      setBrand(null);
      localStorage.removeItem(CACHE_KEY);
    }
  }, [user, refreshBrand]);

  // Preview ao vivo na tela de configurações (sem persistir).
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
