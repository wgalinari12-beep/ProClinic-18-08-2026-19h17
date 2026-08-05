// Anthropometric calculations — pure functions.
// Reused by FichaForm ComputedCards, AI context, PDF export.
//
// Sources:
//  - OMS 2000: IMC categorization
//  - Petroski (1995): 4 skinfolds — brazilian population
//  - Siri (1961): body composition from density
//  - RCQ: WHO 2008 cut-offs

// ── IMC (Body Mass Index) ─────────────────────────────────────────────────────
export function computeIMC({ peso, altura }) {
  const p = parseFloat(peso);
  const a = parseFloat(altura);
  if (!p || !a || a <= 0) return null;
  const aM = a > 3 ? a / 100 : a; // accept cm or m
  const value = p / (aM * aM);
  return {
    value,
    formatted: value.toFixed(2),
    ...classifyIMC(value),
  };
}

function classifyIMC(v) {
  if (v < 18.5) return { classification: "Abaixo do peso",       risk: "medio", who: "Magreza"           };
  if (v < 25)   return { classification: "Peso normal",          risk: "baixo", who: "Eutrófico"          };
  if (v < 30)   return { classification: "Sobrepeso",            risk: "medio", who: "Pré-obesidade"      };
  if (v < 35)   return { classification: "Obesidade Grau I",     risk: "alto",  who: "Obesidade I"        };
  if (v < 40)   return { classification: "Obesidade Grau II",    risk: "alto",  who: "Obesidade II"       };
  return          { classification: "Obesidade Grau III",   risk: "alto",  who: "Obesidade III (mórbida)" };
}

// ── RCQ (Waist-to-Hip Ratio) ──────────────────────────────────────────────────
export function computeRCQ({ cintura, quadril, sexo }) {
  const c = parseFloat(cintura);
  const q = parseFloat(quadril);
  if (!c || !q || q <= 0) return null;
  const value = c / q;
  return {
    value,
    formatted: value.toFixed(2),
    ...classifyRCQ(value, sexo),
  };
}

function classifyRCQ(v, sexo) {
  // WHO cut-offs (M: 0.90 / 0.95 · F: 0.80 / 0.85 · 1.00)
  const isM = (sexo || "").toLowerCase().startsWith("m");
  if (isM) {
    if (v < 0.90) return { classification: "Baixo",       risk: "baixo" };
    if (v < 0.95) return { classification: "Moderado",    risk: "medio" };
    if (v < 1.00) return { classification: "Alto",        risk: "alto"  };
    return          { classification: "Muito alto",  risk: "alto"  };
  }
  if (v < 0.80) return { classification: "Baixo",         risk: "baixo" };
  if (v < 0.85) return { classification: "Moderado",      risk: "medio" };
  if (v < 0.90) return { classification: "Alto",          risk: "alto"  };
  return          { classification: "Muito alto",    risk: "alto"  };
}

// ── Petroski (1995) — 4 skinfolds ────────────────────────────────────────────
// Men (18–66): SC + TR + AM + PM (subscapular, tricipital, axilar-média, panturrilha-medial)
// Women (18–51): AM + SI + CX + PM (axilar-média, suprailíaca, coxa, panturrilha)
// Fallback: uses whatever pregas are provided that match the classic protocol.
export function computePetroski({ sexo, idade, peso, altura,
                                  tricipital, subescapular, axilar_media,
                                  suprailiaca, coxa, panturrilha,
                                  peitoral, abdominal }) {
  const isM = (sexo || "").toLowerCase().startsWith("m");
  const p = num(peso), a = num(altura), I = num(idade);
  if (!I) return null;

  let X;
  if (isM) {
    const sc = num(subescapular), tr = num(tricipital), am = num(axilar_media), pm = num(panturrilha);
    if (!(sc && tr && am && pm)) return null;
    X = sc + tr + am + pm;
    const DC = 1.10726863 - 0.00081201 * X + 0.00000212 * X * X - 0.00041761 * I;
    return finish(DC, X, { peso: p, altura: a, sexo: "M", idade: I });
  }
  // Women
  const am = num(axilar_media), si = num(suprailiaca), cx = num(coxa), pm = num(panturrilha);
  if (!(am && si && cx && pm)) return null;
  X = am + si + cx + pm;
  const aCm = a && a < 3 ? a * 100 : a;
  const DC = 1.02902361 - 0.00067159 * X + 0.00000242 * X * X - 0.00026073 * I
           - 0.00056009 * (p || 0) + 0.00054579 * (aCm || 0);
  return finish(DC, X, { peso: p, altura: a, sexo: "F", idade: I });
}

function finish(DC, X, ctx) {
  if (!DC || DC <= 0) return null;
  const percentGordura = ((4.95 / DC) - 4.50) * 100; // Siri
  const peso = ctx.peso || 0;
  const massaGorda = peso ? peso * (percentGordura / 100) : null;
  const massaMagra = peso ? peso - massaGorda : null;

  // Katch approximate body composition breakdown (based on massa magra)
  // pesoOsseo ~ 15% do peso corporal; pesoResidual ~ 21% (H) / 24% (M)
  const isM = ctx.sexo === "M";
  const pesoOsseo    = peso ? peso * 0.15 : null;
  const pesoResidual = peso ? peso * (isM ? 0.209 : 0.241) : null;
  const pesoMuscular = massaMagra != null && pesoOsseo != null && pesoResidual != null
    ? massaMagra - pesoOsseo - pesoResidual : null;

  return {
    somatorioPregas: X,
    densidadeCorporal: round(DC, 4),
    percentGordura: round(percentGordura, 2),
    massaGorda: round(massaGorda, 2),
    massaMagra: round(massaMagra, 2),
    pesoOsseo: round(pesoOsseo, 2),
    pesoResidual: round(pesoResidual, 2),
    pesoMuscular: round(pesoMuscular, 2),
    ...classifyBodyFat(percentGordura, isM),
  };
}

function classifyBodyFat(pct, isM) {
  if (isM) {
    if (pct < 6)  return { classification: "Essencial",   risk: "medio" };
    if (pct < 14) return { classification: "Atlético",    risk: "baixo" };
    if (pct < 18) return { classification: "Bom",         risk: "baixo" };
    if (pct < 25) return { classification: "Aceitável",   risk: "medio" };
    return           { classification: "Obesidade",  risk: "alto"  };
  }
  if (pct < 14) return { classification: "Essencial",     risk: "medio" };
  if (pct < 21) return { classification: "Atlético",      risk: "baixo" };
  if (pct < 25) return { classification: "Bom",           risk: "baixo" };
  if (pct < 32) return { classification: "Aceitável",     risk: "medio" };
  return           { classification: "Obesidade",    risk: "alto"  };
}

// ── Perimetric summary ───────────────────────────────────────────────────────
// Detects asymmetry between left/right members.
export function computePerimetriaSummary(a) {
  const pairs = [
    ["Braço",       a.perim_braco_dir,       a.perim_braco_esq],
    ["Antebraço",   a.perim_antebraco_dir,   a.perim_antebraco_esq],
    ["Coxa",        a.perim_coxa_dir,        a.perim_coxa_esq],
    ["Panturrilha", a.perim_panturrilha_dir, a.perim_panturrilha_esq],
  ];
  const diffs = pairs
    .map(([label, d, e]) => ({ label, d: num(d), e: num(e), diff: num(d) && num(e) ? Math.abs(num(d) - num(e)) : null }))
    .filter((p) => p.diff != null);
  if (!diffs.length) return null;
  const max = diffs.reduce((m, x) => (x.diff > (m?.diff ?? -1) ? x : m), null);
  return {
    assimetriaMax: max ? { label: max.label, diff: round(max.diff, 1) } : null,
    detalhes: diffs,
  };
}

// ── helpers ──────────────────────────────────────────────────────────────────
function num(v) { const n = parseFloat(v); return isNaN(n) ? 0 : n; }
function round(v, d) { if (v == null || isNaN(v)) return null; const p = 10 ** d; return Math.round(v * p) / p; }
