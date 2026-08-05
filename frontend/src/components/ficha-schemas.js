// Schemas for premium clinical anamnesis modules
// Field types:
//   text | number | textarea | select | chips | date | imc
//   card_select | image_card_select | checkbox_group_visual | medication_table | body_map
//
// For visual field types, options are objects (see below).
// Values chosen for card_select/image_card_select match the legacy string values
// so historical records remain compatible.

// ─────────────────────────────── Fitzpatrick shared ───────────────────────────
const FITZ_LEGACY = [
  { value: "I",   label: "Tipo I",   subtitle: "Muito clara",         bgColor: "#F7E1CB", textColor: "#3b2313", classification: "Queima facilmente",  risk: "alto",  tooltip: "Pele muito clara — nunca bronzeia, sempre queima. Alto risco a laser e sol." },
  { value: "II",  label: "Tipo II",  subtitle: "Clara",               bgColor: "#EFCBA8", textColor: "#3b2313", classification: "Bronzeia pouco",    risk: "alto",  tooltip: "Pele clara — geralmente queima, bronzeia levemente." },
  { value: "III", label: "Tipo III", subtitle: "Morena clara",        bgColor: "#DBA47C", textColor: "#fff",    classification: "Bronzeia gradual",  risk: "medio", tooltip: "Pele mediterrânea — bronzeia progressivamente." },
  { value: "IV",  label: "Tipo IV",  subtitle: "Morena moderada",     bgColor: "#B67F53", textColor: "#fff",    classification: "Bronzeia fácil",    risk: "medio", tooltip: "Pele morena — raramente queima, bronzeia com facilidade." },
  { value: "V",   label: "Tipo V",   subtitle: "Morena escura",       bgColor: "#7E4E2A", textColor: "#fff",    classification: "Muito pigmentada",  risk: "medio", tooltip: "Pele muito pigmentada — quase nunca queima." },
  { value: "VI",  label: "Tipo VI",  subtitle: "Negra",               bgColor: "#4A2914", textColor: "#fff",    classification: "Sempre pigmentada", risk: "baixo", tooltip: "Pele negra — nunca queima, sempre pigmentada." },
];

// Same Fitzpatrick set, but with the "Tipo X" values used by SCHEMA_EPILACAO
const FITZ_LONG = FITZ_LEGACY.map((f) => ({ ...f, value: `Tipo ${f.value}` }));

// ─────────────────────────────── SCHEMA_GERAL (Anamnese) ──────────────────────
export const SCHEMA_GERAL = [
  { key: "queixa_principal", label: "Queixa principal", type: "textarea", full: true },
  { key: "historico_clinico", label: "Histórico clínico", type: "textarea", full: true },
  { key: "tratamentos_anteriores", label: "Tratamentos estéticos anteriores", type: "textarea", full: true },

  {
    key: "doencas", label: "Doenças preexistentes", type: "checkbox_group_visual", full: true,
    groups: [
      {
        label: "Metabólicas & endócrinas",
        options: [
          { value: "Diabetes",              label: "Diabetes",              icon: "🩸", description: "Cicatrização reduzida", risk: "alto"  },
          { value: "Hipotireoidismo",       label: "Hipotireoidismo",       icon: "🦋", risk: "medio" },
          { value: "Distúrbios hormonais",  label: "Distúrbios hormonais",  icon: "⚖️", risk: "medio" },
        ],
      },
      {
        label: "Cardiovasculares & sanguíneas",
        options: [
          { value: "Hipertensão", label: "Hipertensão",  icon: "❤️", risk: "alto" },
          { value: "Cardiopatias",label: "Cardiopatias", icon: "💓", risk: "alto" },
          { value: "Anemia",      label: "Anemia",       icon: "🩸", risk: "medio" },
        ],
      },
      {
        label: "Autoimune & oncológicas",
        options: [
          { value: "Câncer", label: "Câncer / oncológico", icon: "🎗️", description: "Requer atestado", risk: "alto" },
          { value: "Lúpus",  label: "Lúpus",              icon: "🦋", risk: "alto" },
        ],
      },
    ],
  },
  { key: "doencas_descricao", label: "Descreva as doenças preexistentes", type: "textarea", full: true,
    when: (a) => Array.isArray(a.doencas) && a.doencas.length > 0 },

  { key: "alergias", label: "Possui alergias?", type: "select", options: ["Não", "Sim"] },
  { key: "alergias_descricao", label: "Descreva as alergias", type: "text", full: true,
    when: (a) => a.alergias === "Sim" },

  {
    key: "medicacoes", label: "Medicações contínuas", type: "medication_table", full: true,
    addLabel: "Adicionar medicação",
  },
  {
    key: "suplementos", label: "Suplementos & nutracêuticos", type: "medication_table", full: true,
    addLabel: "Adicionar suplemento",
  },

  { key: "cirurgias", label: "Cirurgias anteriores", type: "textarea", full: true },
  { key: "gestante", label: "Gestante / amamentando?", type: "select",
    options: ["Não", "Sim - gestante", "Sim - amamentando"] },
  { key: "tabagismo", label: "Tabagismo", type: "select", options: ["Não", "Sim"] },
  { key: "alcool", label: "Consumo de álcool", type: "select",
    options: ["Não", "Social", "Frequente"] },
  { key: "historico_familiar", label: "Histórico familiar relevante", type: "textarea", full: true },
  { key: "observacoes_clinicas", label: "Observações clínicas", type: "textarea", full: true },
];

// ─────────────────────────────── SCHEMA_FACIAL ────────────────────────────────
export const SCHEMA_FACIAL = [
  {
    key: "tipo_pele", label: "Tipo de pele", type: "card_select", full: true, columns: 4,
    options: [
      { value: "Seca",    label: "Seca",    subtitle: "Ressecamento, descamação",       icon: "🌵" },
      { value: "Normal",  label: "Normal",  subtitle: "Equilíbrio hidro-lipídico",      icon: "✨" },
      { value: "Mista",   label: "Mista",   subtitle: "Zona T oleosa, laterais secas",  icon: "🎭" },
      { value: "Oleosa",  label: "Oleosa",  subtitle: "Brilho, poros dilatados",        icon: "💧" },
    ],
  },

  {
    key: "fototipo", label: "Fototipo (Fitzpatrick)", type: "card_select", full: true, columns: 6,
    options: FITZ_LEGACY,
  },

  { key: "oleosidade", label: "Oleosidade", type: "select", options: ["Baixa", "Média", "Alta"] },

  {
    key: "acne", label: "Grau de acne", type: "card_select", full: true, columns: 4,
    options: [
      { value: "Ausente",  label: "Ausente",  subtitle: "Sem lesões",              bgColor: "#E8F5E9", classification: "Grau 0", risk: "baixo" },
      { value: "Leve",     label: "Leve",     subtitle: "Comedões + pápulas",      bgColor: "#FFF9C4", classification: "Grau I", risk: "baixo" },
      { value: "Moderada", label: "Moderada", subtitle: "Pápulas + pústulas",      bgColor: "#FFCC80", classification: "Grau II/III", risk: "medio" },
      { value: "Severa",   label: "Severa",   subtitle: "Nódulos, cistos, cicatriz",bgColor: "#EF9A9A", classification: "Grau IV", risk: "alto" },
    ],
  },

  {
    key: "manchas", label: "Manchas / discromias", type: "checkbox_group_visual", full: true,
    options: [
      { value: "Melasma",                      label: "Melasma",                      icon: "🟤" },
      { value: "Hipercromia pós-inflamatória", label: "Hipercromia pós-inflamatória", icon: "🔸" },
      { value: "Sardas",                       label: "Sardas",                       icon: "🟠" },
      { value: "Hipocromia",                   label: "Hipocromia",                   icon: "⚪" },
    ],
  },

  {
    key: "rugas", label: "Rugas", type: "checkbox_group_visual", full: true,
    options: [
      { value: "Testa",           label: "Testa" },
      { value: "Glabela",         label: "Glabela",         description: "Entre as sobrancelhas" },
      { value: "Pés de galinha",  label: "Pés de galinha",  description: "Periorbitais" },
      { value: "Bigode chinês",   label: "Bigode chinês",   description: "Sulco nasogeniano" },
      { value: "Marionete",       label: "Marionete",       description: "Comissura labial" },
      { value: "Código de barras",label: "Código de barras",description: "Perioral" },
    ],
  },

  {
    key: "flacidez", label: "Flacidez facial", type: "card_select", full: true, columns: 4,
    options: [
      { value: "Ausente",   label: "Ausente",   bgColor: "#E8F5E9", risk: "baixo", classification: "Firme" },
      { value: "Leve",      label: "Leve",      bgColor: "#FFF9C4", risk: "baixo", classification: "Sutil" },
      { value: "Moderada",  label: "Moderada",  bgColor: "#FFCC80", risk: "medio", classification: "Sulcos visíveis" },
      { value: "Acentuada", label: "Acentuada", bgColor: "#EF9A9A", risk: "alto",  classification: "Ptose evidente" },
    ],
  },

  { key: "sensibilidade", label: "Sensibilidade", type: "select", options: ["Baixa", "Média", "Alta"] },

  {
    key: "rosacea", label: "Rosácea", type: "card_select", full: true, columns: 4,
    options: [
      { value: "Não", label: "Não",           bgColor: "#F5F5F5", classification: "Ausente", risk: "baixo" },
      { value: "Sim", label: "Sim (eritematotelangiectásica)", bgColor: "#FFEBEE", classification: "Presente", risk: "medio", tooltip: "Vermelhidão persistente + telangiectasias" },
    ],
  },

  { key: "habitos_solares", label: "Exposição solar", type: "select",
    options: ["Não", "Ocasional", "Frequente", "Diária"] },
  { key: "uso_protetor", label: "Uso de protetor solar?", type: "select",
    options: ["Não", "Esporádico", "Diário"] },
  { key: "skincare_atual", label: "Rotina de skincare atual", type: "textarea", full: true },
  { key: "tratamentos_anteriores_face", label: "Tratamentos faciais anteriores", type: "textarea", full: true },
];

// ─────────────────────────────── SCHEMA_INJETAVEIS ────────────────────────────
// Onda 3 · Injetáveis Premium — harmonização facial
import {
  FACIAL_SILHOUETTE_FRONTAL, FACIAL_SILHOUETTE_LATERAL,
  FACIAL_REGIONS_FRONTAL, FACIAL_REGIONS_LATERAL_D, FACIAL_REGIONS_LATERAL_E,
} from "./ficha-fields/body-regions";

const FACIAL_VIEWS_CONFIG = [
  { id: "frontal_face", label: "Frontal",      silhouette: FACIAL_SILHOUETTE_FRONTAL, regions: FACIAL_REGIONS_FRONTAL },
  { id: "lateral_d",    label: "Perfil D",     silhouette: FACIAL_SILHOUETTE_LATERAL, regions: FACIAL_REGIONS_LATERAL_D },
  { id: "lateral_e",    label: "Perfil E",     silhouette: FACIAL_SILHOUETTE_LATERAL, regions: FACIAL_REGIONS_LATERAL_E },
];

function computeInjetaveisSummary(a) {
  const rows = Array.isArray(a.aplicacoes) ? a.aplicacoes : [];
  const totalUI = rows.reduce((s, r) => s + (parseFloat(r.qty_ui) || 0), 0);
  const totalMl = rows.reduce((s, r) => s + (parseFloat(r.qty_ml) || 0), 0);
  const porProduto = {};
  const porRegiao  = {};
  rows.forEach((r) => {
    const p = (r.produto || "—").trim() || "—";
    const g = (r.regiao  || "—").trim() || "—";
    const ui = parseFloat(r.qty_ui) || 0;
    const ml = parseFloat(r.qty_ml) || 0;
    porProduto[p] = (porProduto[p] || 0) + ui + ml;
    porRegiao[g]  = (porRegiao[g]  || 0) + ui + ml;
  });
  return { totalUI, totalMl, porProduto, porRegiao, count: rows.length };
}

export const SCHEMA_INJETAVEIS = [
  // ── Procedimento planejado ─────────────────────────────────────────────
  {
    key: "procedimento_planejado", label: "Procedimento planejado",
    type: "image_card_select", full: true, multi: true, columns: 3,
    options: [
      { value: "Toxina Botulínica", label: "Toxina Botulínica", icon: "💉", subtitle: "Rugas dinâmicas", description: "Bloqueio neuromuscular temporário" },
      { value: "Ácido Hialurônico", label: "Ácido Hialurônico", icon: "💧", subtitle: "Volume & hidratação", description: "Preenchimento tecidual" },
      { value: "Fio PDO",           label: "Fio PDO",           icon: "🧵", subtitle: "Lifting não-cirúrgico", description: "Sustentação com fios absorvíveis" },
      { value: "Bioestimulador",    label: "Bioestimulador",    icon: "⚡", subtitle: "Colágeno endógeno", description: "PLLA / hidroxiapatita" },
      { value: "Skinbooster",       label: "Skinbooster",       icon: "✨", subtitle: "Hidratação profunda", description: "HA reticulado disperso" },
      { value: "Mesoterapia",       label: "Mesoterapia",       icon: "🧪", subtitle: "Microinjeções", description: "Ativos intradérmicos" },
    ],
  },

  // ── Mapa facial interativo (frontal + 2 perfis) ────────────────────────
  {
    key: "regioes_selecionadas", label: "Mapa facial — regiões marcadas",
    type: "body_map", full: true,
    viewsConfig: FACIAL_VIEWS_CONFIG,
    highlightColor: "hsl(340 65% 55%)",
  },

  // ── Tabela dinâmica de aplicações ──────────────────────────────────────
  {
    key: "aplicacoes", label: "Aplicações registradas (produto · região · quantidade)",
    type: "medication_table", full: true, addLabel: "Adicionar aplicação",
    columns: [
      { key: "produto",   label: "Produto",   placeholder: "HA / Botox / PLLA...",  w: "flex-1 min-w-[140px]" },
      { key: "marca",     label: "Marca/Lote",placeholder: "Juvéderm · lote 1234", w: "flex-1 min-w-[140px]" },
      { key: "regiao",    label: "Região",    placeholder: "Malar / Glabela",       w: "flex-1 min-w-[120px]" },
      { key: "qty_ui",    label: "UI",        placeholder: "20",                    w: "w-20" },
      { key: "qty_ml",    label: "ml",        placeholder: "1.0",                   w: "w-20" },
      { key: "obs",       label: "Obs.",      placeholder: "profundidade, cânula/agulha", w: "flex-1 min-w-[120px]" },
    ],
  },

  // ── Somatórios automáticos ─────────────────────────────────────────────
  {
    key: "_inj_summary", label: "Somatórios da sessão", type: "computed_grid", full: true,
    compute: (a) => {
      const s = computeInjetaveisSummary(a);
      const topProduto = Object.entries(s.porProduto).sort((x, y) => y[1] - x[1])[0];
      const topRegiao  = Object.entries(s.porRegiao ).sort((x, y) => y[1] - x[1])[0];
      return [
        { key: "count",  label: "Aplicações",   value: s.count || null, subtitle: "linhas na tabela" },
        { key: "ui",     label: "Total UI",     value: s.totalUI || null, unit: "UI",
          tooltip: "Somatório automático de unidades para toxina botulínica." },
        { key: "ml",     label: "Total ml",     value: s.totalMl ? s.totalMl.toFixed(2) : null, unit: "ml",
          tooltip: "Somatório automático de mililitros (preenchedor/bioestimulador)." },
        { key: "tprod",  label: "Produto mais aplicado", value: topProduto?.[0] || null, subtitle: topProduto ? `${topProduto[1]}` : "" },
        { key: "treg",   label: "Região mais tratada",   value: topRegiao?.[0]  || null, subtitle: topRegiao  ? `${topRegiao[1]}`  : "" },
      ];
    },
  },

  // ── Rastreabilidade de produto ─────────────────────────────────────────
  { key: "produto_marca",     label: "Marca do produto principal" },
  { key: "produto_lote",      label: "Lote" },
  { key: "produto_validade",  label: "Validade", type: "date" },
  { key: "produto_fabricante",label: "Fabricante" },

  // ── Anotações por região (legado — mantido) ────────────────────────────
  { key: "regiao_frontal",     label: "Notas — região frontal",       type: "textarea", full: true },
  { key: "regiao_glabela",     label: "Notas — glabela",              type: "textarea", full: true },
  { key: "regiao_periorbital", label: "Notas — periorbital / olheira",type: "textarea", full: true },
  { key: "regiao_malar",       label: "Notas — malar / zigomático",   type: "textarea", full: true },
  { key: "regiao_labios",      label: "Notas — lábios",               type: "textarea", full: true },
  { key: "regiao_mento",       label: "Notas — mento / mandíbula",    type: "textarea", full: true },

  // ── Relatório final ────────────────────────────────────────────────────
  { key: "relatorio_final", label: "Relatório clínico dos injetáveis", type: "textarea", full: true,
    help: "Impressão clínica, orientações pós-procedimento e follow-up." },
];

// ─────────────────────────────── SCHEMA_CORPORAL ──────────────────────────────
// Onda 1 · Corporal Premium — antropometria completa (IMC, RCQ, Petroski)
import { computeIMC, computeRCQ, computePetroski, computePerimetriaSummary } from "@/lib/anthropometry";

export const SCHEMA_CORPORAL = [
  // ── Dados basais ─────────────────────────────────────────────────────────
  { key: "sexo",  label: "Sexo",  type: "card_select", columns: 2,
    options: [
      { value: "M", label: "Masculino", icon: "♂", bgColor: "#DBEAFE" },
      { value: "F", label: "Feminino",  icon: "♀", bgColor: "#FCE7F3" },
    ] },
  { key: "idade", label: "Idade (anos)", type: "number" },
  { key: "peso",  label: "Peso (kg)",   type: "number" },
  { key: "altura",label: "Altura (cm)", type: "number" },

  // ── IMC + RCQ (Antropometria básica) ────────────────────────────────────
  {
    key: "_antropo_calc", label: "Antropometria — IMC & RCQ", type: "computed_grid", full: true,
    compute: (a) => {
      const imc = computeIMC({ peso: a.peso, altura: a.altura });
      const rcq = computeRCQ({ cintura: a.perim_cintura, quadril: a.perim_quadril, sexo: a.sexo });
      return [
        { key: "imc", label: "IMC", unit: "kg/m²",
          value: imc?.formatted, classification: imc?.who, risk: imc?.risk,
          tooltip: "Índice de Massa Corporal — OMS. Requer peso e altura." },
        { key: "rcq", label: "RCQ",
          value: rcq?.formatted, classification: rcq?.classification, risk: rcq?.risk,
          tooltip: "Relação Cintura/Quadril — OMS. Requer perímetros de cintura e quadril + sexo." },
      ];
    },
  },

  // ── Perimetria (14 regiões) ───────────────────────────────────────────────
  { key: "_perim_header", label: "Perimetria (cm)", type: "computed_grid", full: true,
    compute: (a) => {
      const s = computePerimetriaSummary(a);
      return [{
        key: "assimetria", label: "Assimetria máxima",
        value: s?.assimetriaMax ? `${s.assimetriaMax.diff} cm` : null,
        subtitle: s?.assimetriaMax?.label,
        risk: s?.assimetriaMax ? (s.assimetriaMax.diff > 1.5 ? "alto" : s.assimetriaMax.diff > 0.8 ? "medio" : "baixo") : undefined,
        tooltip: "Maior diferença entre lado direito e esquerdo (braço, antebraço, coxa, panturrilha).",
      }];
    },
  },
  { key: "perim_pescoco",         label: "Pescoço (cm)",         type: "number" },
  { key: "perim_ombros",          label: "Ombros (cm)",          type: "number" },
  { key: "perim_torax",           label: "Tórax (cm)",           type: "number" },
  { key: "perim_cintura",         label: "Cintura (cm)",         type: "number" },
  { key: "perim_abdomen",         label: "Abdômen (cm)",         type: "number" },
  { key: "perim_quadril",         label: "Quadril (cm)",         type: "number" },
  { key: "perim_braco_dir",       label: "Braço direito (cm)",       type: "number" },
  { key: "perim_braco_esq",       label: "Braço esquerdo (cm)",      type: "number" },
  { key: "perim_antebraco_dir",   label: "Antebraço direito (cm)",   type: "number" },
  { key: "perim_antebraco_esq",   label: "Antebraço esquerdo (cm)",  type: "number" },
  { key: "perim_coxa_dir",        label: "Coxa direita (cm)",        type: "number" },
  { key: "perim_coxa_esq",        label: "Coxa esquerda (cm)",       type: "number" },
  { key: "perim_panturrilha_dir", label: "Panturrilha direita (cm)", type: "number" },
  { key: "perim_panturrilha_esq", label: "Panturrilha esquerda (cm)",type: "number" },

  // ── Adipometria Petroski (8 pregas) ───────────────────────────────────────
  { key: "adip_tricipital",   label: "Prega tricipital (mm)",    type: "number" },
  { key: "adip_subescapular", label: "Prega subescapular (mm)",  type: "number" },
  { key: "adip_peitoral",     label: "Prega peitoral (mm)",      type: "number" },
  { key: "adip_axilar_media", label: "Prega axilar média (mm)",  type: "number" },
  { key: "adip_suprailiaca",  label: "Prega suprailíaca (mm)",   type: "number" },
  { key: "adip_abdominal",    label: "Prega abdominal (mm)",     type: "number" },
  { key: "adip_coxa",         label: "Prega coxa (mm)",          type: "number" },
  { key: "adip_panturrilha",  label: "Prega panturrilha (mm)",   type: "number" },

  // ── Composição corporal (Petroski + Siri) ────────────────────────────────
  { key: "_composicao_calc", label: "Composição Corporal (Petroski · Siri)", type: "computed_grid", full: true,
    compute: (a) => {
      const p = computePetroski({
        sexo: a.sexo, idade: a.idade, peso: a.peso, altura: a.altura,
        tricipital: a.adip_tricipital, subescapular: a.adip_subescapular,
        peitoral: a.adip_peitoral,     axilar_media: a.adip_axilar_media,
        suprailiaca: a.adip_suprailiaca, abdominal: a.adip_abdominal,
        coxa: a.adip_coxa,               panturrilha: a.adip_panturrilha,
      });
      const val = (v) => (v == null ? null : v);
      return [
        { key: "somatorio", label: "Σ Pregas",       value: val(p?.somatorioPregas), unit: "mm" },
        { key: "densidade", label: "Densidade",      value: val(p?.densidadeCorporal), unit: "g/cm³",
          tooltip: "Densidade corporal via protocolo Petroski (1995) para adultos brasileiros." },
        { key: "gordura",   label: "% Gordura",      value: val(p?.percentGordura), unit: "%",
          classification: p?.classification, risk: p?.risk,
          tooltip: "Percentual de gordura via equação de Siri (1961)." },
        { key: "mgorda",    label: "Massa gorda",    value: val(p?.massaGorda), unit: "kg" },
        { key: "mmagra",    label: "Massa magra",    value: val(p?.massaMagra), unit: "kg" },
        { key: "posseo",    label: "Peso ósseo",     value: val(p?.pesoOsseo),  unit: "kg", tooltip: "Estimado em 15% do peso corporal." },
        { key: "presid",    label: "Peso residual",  value: val(p?.pesoResidual), unit: "kg",
          tooltip: "Órgãos, líquidos e vísceras — 20.9% (M) / 24.1% (F)." },
        { key: "pmuscul",   label: "Peso muscular",  value: val(p?.pesoMuscular),  unit: "kg" },
      ];
    },
  },

  // ── Distribuição / Diagnóstico visual ────────────────────────────────────
  { key: "distribuicao_gordura", label: "Distribuição de gordura", type: "select",
    options: ["Andróide", "Ginóide", "Mista"] },

  {
    key: "celulite_grau", label: "Grau de celulite", type: "image_card_select", full: true, columns: 4,
    options: [
      { value: "Ausente", label: "Ausente", icon: "✓",  subtitle: "Grau 0", description: "Sem alterações visíveis" },
      { value: "Grau I",  label: "Grau I",  icon: "◔",  subtitle: "Leve",   description: "Visível somente ao pinçar a pele" },
      { value: "Grau II", label: "Grau II", icon: "◑",  subtitle: "Moderada",description: "Visível de pé em repouso" },
      { value: "Grau III",label: "Grau III",icon: "◕",  subtitle: "Grave",  description: "Visível em decúbito dorsal" },
      { value: "Grau IV", label: "Grau IV", icon: "●",  subtitle: "Severa", description: "Nódulos evidentes ao toque" },
    ],
  },

  {
    key: "estrias", label: "Estrias", type: "image_card_select", full: true, multi: true, columns: 3,
    options: [
      { value: "Rubra", label: "Rubra",  icon: "🔴", subtitle: "Vermelhas",     description: "Ativas, recentes, vascularizadas" },
      { value: "Alba",  label: "Alba",   icon: "⚪", subtitle: "Brancas",        description: "Antigas, atróficas" },
      { value: "Mista", label: "Mista",  icon: "🟣", subtitle: "Intermediárias",description: "Combinação — várias fases" },
    ],
  },

  {
    key: "flacidez_corporal", label: "Flacidez corporal", type: "card_select", full: true, columns: 3,
    options: [
      { value: "Leve",     label: "Leve",     bgColor: "#FFF9C4", risk: "baixo" },
      { value: "Moderada", label: "Moderada", bgColor: "#FFCC80", risk: "medio" },
      { value: "Severa",   label: "Severa",   bgColor: "#EF9A9A", risk: "alto"  },
    ],
  },

  {
    key: "diastase", label: "Diástase abdominal", type: "image_card_select", full: true, columns: 4,
    options: [
      { value: "Ausente", label: "Ausente", icon: "✓",  subtitle: "< 2 cm",   description: "Sem separação relevante" },
      { value: "Leve",    label: "Leve",    icon: "▏",  subtitle: "2 – 3 cm", description: "Separação discreta" },
      { value: "Moderada",label: "Moderada",icon: "▎",  subtitle: "3 – 5 cm", description: "Requer fortalecimento do core" },
      { value: "Grave",   label: "Grave",   icon: "▍",  subtitle: "> 5 cm",   description: "Requer avaliação médica" },
    ],
  },

  { key: "gordura_localizada", label: "Gordura localizada — mapa corporal", type: "body_map", full: true,
    views: ["frontal", "posterior"] },
  { key: "regioes_celulite", label: "Regiões afetadas pela celulite", type: "body_map", full: true,
    views: ["frontal", "posterior"] },

  // ── Estilo de vida & Relatório ────────────────────────────────────────────
  { key: "atividade_fisica", label: "Atividade física", type: "select",
    options: ["Sedentário", "Leve", "Moderada", "Intensa"] },
  { key: "habitos_alimentares", label: "Hábitos alimentares", type: "textarea", full: true },
  { key: "relatorio_corporal", label: "Relatório clínico corporal", type: "textarea", full: true,
    help: "Síntese de achados, indicação de protocolos e evolução esperada." },
];

// ─────────────────────────────── SCHEMA_CAPILAR ───────────────────────────────
// Onda 2 · Capilar Premium — tricologia avançada
export const SCHEMA_CAPILAR = [
  // ── Classificação de fio (Andre Walker · 12 tipos) ───────────────────────
  {
    key: "tipo_cabelo_walker", label: "Tipo de cabelo (Andre Walker)",
    type: "image_card_select", full: true, columns: 4,
    options: [
      { value: "1A", label: "1A", icon: "▬",  subtitle: "Liso fino",       description: "Fio muito liso, sem volume" },
      { value: "1B", label: "1B", icon: "▬",  subtitle: "Liso médio",      description: "Liso com corpo" },
      { value: "1C", label: "1C", icon: "▬",  subtitle: "Liso grosso",     description: "Liso resistente" },
      { value: "2A", label: "2A", icon: "〰️", subtitle: "Ondulado leve",   description: "Ondas suaves" },
      { value: "2B", label: "2B", icon: "〰️", subtitle: "Ondulado médio",  description: "Ondas em S definidas" },
      { value: "2C", label: "2C", icon: "〰️", subtitle: "Ondulado grosso", description: "Ondas mais fechadas" },
      { value: "3A", label: "3A", icon: "🌀", subtitle: "Cachos abertos",  description: "Cachos largos" },
      { value: "3B", label: "3B", icon: "🌀", subtitle: "Cachos médios",   description: "Cachos apertados" },
      { value: "3C", label: "3C", icon: "🌀", subtitle: "Cachos fechados", description: "Cachos em espiral" },
      { value: "4A", label: "4A", icon: "🌪️", subtitle: "Crespo definido", description: "Crespo em S" },
      { value: "4B", label: "4B", icon: "🌪️", subtitle: "Crespo em Z",    description: "Curvatura em Z" },
      { value: "4C", label: "4C", icon: "🌪️", subtitle: "Crespo denso",   description: "Alta densidade, encolhimento" },
    ],
  },

  // ── Legacy tipo_cabelo (Liso/Ondulado/Cacheado/Crespo) — mantido p/ retrocompat
  {
    key: "tipo_cabelo", label: "Categoria geral", type: "image_card_select", full: true, columns: 4,
    options: [
      { value: "Liso",      label: "Liso",      icon: "▬",  subtitle: "Tipo 1" },
      { value: "Ondulado",  label: "Ondulado",  icon: "〰️", subtitle: "Tipo 2" },
      { value: "Cacheado",  label: "Cacheado",  icon: "🌀", subtitle: "Tipo 3" },
      { value: "Crespo",    label: "Crespo",    icon: "🌪️", subtitle: "Tipo 4" },
    ],
  },

  { key: "espessura_fio",    label: "Espessura do fio",              type: "select",
    options: ["Fino", "Médio", "Grosso"] },
  { key: "densidade_capilar",label: "Densidade capilar",             type: "select",
    options: ["Baixa (<150 fios/cm²)", "Média (150–200)", "Alta (>200)"] },
  { key: "oleosidade_couro", label: "Oleosidade do couro cabeludo",  type: "select",
    options: ["Seco", "Normal", "Oleoso"] },
  { key: "porosidade",       label: "Porosidade",                    type: "select",
    options: ["Baixa", "Média", "Alta"] },
  { key: "elasticidade",     label: "Elasticidade",                  type: "select",
    options: ["Baixa", "Média", "Alta"] },

  // ── Queda ────────────────────────────────────────────────────────────────
  {
    key: "queda", label: "Intensidade de queda", type: "card_select", full: true, columns: 4,
    options: [
      { value: "Não",       label: "Sem queda", bgColor: "#E8F5E9", risk: "baixo" },
      { value: "Leve",      label: "Leve",      bgColor: "#FFF9C4", risk: "baixo" },
      { value: "Moderada",  label: "Moderada",  bgColor: "#FFCC80", risk: "medio" },
      { value: "Acentuada", label: "Acentuada", bgColor: "#EF9A9A", risk: "alto" },
    ],
  },

  // ── Escala Norwood-Hamilton (masculina) ──────────────────────────────────
  {
    key: "escala_norwood", label: "Escala Norwood-Hamilton (androgenética masculina)",
    type: "image_card_select", full: true, columns: 4,
    when: (a) => (a.sexo || "").toLowerCase().startsWith("m") || a.queda_padrao === "Androgenética",
    options: [
      { value: "I",   label: "Grau I",   icon: "1️⃣", subtitle: "Sem recessão",    description: "Linha frontal normal" },
      { value: "II",  label: "Grau II",  icon: "2️⃣", subtitle: "Recessão leve",   description: "Pequena entrada temporal" },
      { value: "III", label: "Grau III", icon: "3️⃣", subtitle: "Entradas evidentes", description: "Recessão frontotemporal" },
      { value: "IV",  label: "Grau IV",  icon: "4️⃣", subtitle: "Coroa evidente",  description: "Rarefação em vértice" },
      { value: "V",   label: "Grau V",   icon: "5️⃣", subtitle: "Ponte estreita",  description: "Vértice + entradas mais amplas" },
      { value: "VI",  label: "Grau VI",  icon: "6️⃣", subtitle: "Sem ponte",       description: "Fusão frontal + vértice" },
      { value: "VII", label: "Grau VII", icon: "7️⃣", subtitle: "Estágio final",   description: "Apenas coroa remanescente" },
    ],
  },

  // ── Escala Savin (feminina) ──────────────────────────────────────────────
  {
    key: "escala_savin", label: "Escala Savin (androgenética feminina)",
    type: "image_card_select", full: true, columns: 4,
    when: (a) => (a.sexo || "").toLowerCase().startsWith("f") || a.queda_padrao === "Androgenética",
    options: [
      { value: "1",   label: "1",   icon: "①", subtitle: "Normal",           description: "Densidade preservada" },
      { value: "2",   label: "2",   icon: "②", subtitle: "Rarefação leve",   description: "Alargamento discreto do risco" },
      { value: "3",   label: "3",   icon: "③", subtitle: "Rarefação moderada", description: "Risco mais aberto" },
      { value: "4",   label: "4",   icon: "④", subtitle: "Central visível",  description: "Área central com couro exposto" },
      { value: "5",   label: "5",   icon: "⑤", subtitle: "Difuso central",   description: "Rarefação evidente na coroa" },
      { value: "6",   label: "6",   icon: "⑥", subtitle: "Grave",            description: "Perda ampla no topo" },
      { value: "7",   label: "7",   icon: "⑦", subtitle: "Muito grave",      description: "Máxima rarefação" },
      { value: "A",   label: "Frontal (A)",  icon: "▼", subtitle: "Christmas-tree", description: "Padrão em árvore de natal" },
    ],
  },

  // ── Padrão de queda ──────────────────────────────────────────────────────
  {
    key: "queda_padrao", label: "Padrão da queda", type: "image_card_select", full: true, columns: 3,
    when: (a) => a.queda && a.queda !== "Não",
    options: [
      { value: "Difusa",         label: "Difusa",         icon: "🌫️", description: "Perda uniforme em todo couro" },
      { value: "Androgenética",  label: "Androgenética",  icon: "🧬", description: "Norwood (M) / Ludwig-Savin (F)" },
      { value: "Areata",         label: "Areata",         icon: "⭕", description: "Placas circulares — auto-imune" },
      { value: "Pós-parto",      label: "Pós-parto",      icon: "🤱", description: "Eflúvio telógeno pós-gestacional" },
      { value: "Stress",         label: "Stress",         icon: "😰", description: "Eflúvio agudo" },
      { value: "Cicatricial",    label: "Cicatricial",    icon: "🩹", description: "Alopecia frontal fibrosante, líquen plano pilar" },
    ],
  },

  // ── Alopecia Areata (subtipos) ───────────────────────────────────────────
  {
    key: "alopecia_areata_tipo", label: "Alopecia areata — subtipo",
    type: "image_card_select", full: true, columns: 5,
    when: (a) => a.queda_padrao === "Areata",
    options: [
      { value: "Localizada",label: "Localizada",icon: "⭕", description: "Uma ou poucas placas" },
      { value: "Difusa",    label: "Difusa",    icon: "🌫️", description: "Rarefação difusa" },
      { value: "Ofiásica",  label: "Ofiásica",  icon: "🌊", description: "Faixa em couro occipital" },
      { value: "Total",     label: "Total",     icon: "🚫", description: "Perda total do couro cabeludo" },
      { value: "Universal", label: "Universal", icon: "🌐", description: "Perda de todos os pelos do corpo" },
    ],
  },

  // ── Displasias pilosas ───────────────────────────────────────────────────
  {
    key: "displasias_congenitas", label: "Displasias pilosas congênitas",
    type: "checkbox_group_visual", full: true,
    options: [
      { value: "Monilethrix",           label: "Monilethrix",           icon: "📿", description: "Colar de contas" },
      { value: "Pili torti",            label: "Pili torti",            icon: "🌀", description: "Fio torcido em 180°" },
      { value: "Pili annulati",         label: "Pili annulati",         icon: "🔗", description: "Anéis claros/escuros alternados" },
      { value: "Tricorrexe nodosa",     label: "Tricorrexe nodosa",     icon: "🧵", description: "Nós ao longo do fio" },
      { value: "Netherton",             label: "Síndrome de Netherton", icon: "🌿", description: "Fio 'bambu'" },
      { value: "Tricotiodistrofia",     label: "Tricotiodistrofia",     icon: "✂️", description: "Baixa cistina; fio quebradiço" },
    ],
  },
  {
    key: "displasias_adquiridas", label: "Displasias pilosas adquiridas",
    type: "checkbox_group_visual", full: true,
    options: [
      { value: "Tricoptilose",          label: "Tricoptilose",          icon: "🥢", description: "Pontas duplas" },
      { value: "Tricorrexe (adq.)",     label: "Tricorrexe adquirida",  icon: "💥", description: "Fratura transversa" },
      { value: "Tricoclasia",           label: "Tricoclasia",           icon: "⚡", description: "Fratura em bordas paralelas" },
      { value: "Tricoschise",           label: "Tricoschise",           icon: "✂️", description: "Corte limpo em ângulo reto" },
      { value: "Bolha piezogênica",     label: "Bolha piezogênica",     icon: "🫧" },
    ],
  },

  // ── Hábitos capilares ────────────────────────────────────────────────────
  {
    key: "habitos_capilares", label: "Hábitos capilares",
    type: "checkbox_group_visual", full: true,
    options: [
      { value: "Boné diário",          label: "Boné diário",              icon: "🧢" },
      { value: "Secador quente",       label: "Secador quente",           icon: "🌬️", risk: "medio" },
      { value: "Chapinha",             label: "Chapinha",                 icon: "🔥", risk: "medio" },
      { value: "Progressiva",          label: "Progressiva",              icon: "🧴", risk: "alto"  },
      { value: "Tintura",              label: "Tintura",                  icon: "🎨" },
      { value: "Descoloração",         label: "Descoloração",             icon: "⚡", risk: "alto"  },
      { value: "Química (relaxamento)",label: "Química (relaxamento)",    icon: "💆", risk: "medio" },
    ],
  },
  { key: "coloração_freq", label: "Frequência de coloração", type: "select",
    options: ["Nunca", "Eventual", "Mensal", "Quinzenal"] },

  // ── Avaliação clínica (tricoscopia) ──────────────────────────────────────
  { key: "aval_oleosidade",     label: "Oleosidade (couro)",   type: "select",
    options: ["Ausente", "Leve", "Moderada", "Intensa"] },
  { key: "aval_descamacao",     label: "Descamação",           type: "select",
    options: ["Ausente", "Leve", "Moderada", "Intensa"] },
  { key: "aval_prurido",        label: "Prurido",              type: "select",
    options: ["Ausente", "Leve", "Moderada", "Intenso"] },
  { key: "aval_miniaturizacao", label: "Miniaturização",       type: "select",
    options: ["Ausente", "Leve", "Moderada", "Acentuada"] },
  { key: "aval_inflamacao",     label: "Inflamação",           type: "select",
    options: ["Ausente", "Leve", "Moderada", "Intensa"] },
  { key: "aval_densidade",      label: "Densidade estimada",   type: "select",
    options: ["Alta", "Média", "Baixa", "Muito baixa"] },

  {
    key: "doencas_couro", label: "Doenças do couro cabeludo", type: "checkbox_group_visual", full: true,
    options: [
      { value: "Caspa",                 label: "Caspa",                 icon: "❄️" },
      { value: "Dermatite seborreica",  label: "Dermatite seborreica",  icon: "🔬", risk: "medio" },
      { value: "Psoríase",              label: "Psoríase",              icon: "🩹", risk: "alto" },
      { value: "Foliculite",            label: "Foliculite",            icon: "🦠", risk: "medio" },
      { value: "Líquen plano pilar",    label: "Líquen plano pilar",    icon: "🌿", risk: "alto" },
      { value: "Alopecia fibrosante frontal", label: "Alopecia fibrosante frontal", icon: "▼", risk: "alto" },
    ],
  },

  { key: "habitos_capilar", label: "Rotina capilar (produtos, frequência de lavagem)", type: "textarea", full: true },
  { key: "relatorio_capilar", label: "Relatório clínico capilar", type: "textarea", full: true,
    help: "Síntese, hipóteses diagnósticas e protocolo indicado." },
];

// ─────────────────────────────── SCHEMA_EPILACAO ──────────────────────────────
// Onda 4 · Epilação Premium
export const SCHEMA_EPILACAO = [
  {
    key: "fototipo_fitzpatrick", label: "Fototipo (Fitzpatrick)", type: "card_select", full: true, columns: 6,
    options: FITZ_LONG,
  },
  {
    key: "pigmento_pelo", label: "Pigmento do pelo", type: "card_select", full: true, columns: 5,
    options: [
      { value: "Muito claro",     label: "Muito claro",     bgColor: "#FAF3E0", classification: "Loiro claro", risk: "alto",  tooltip: "Pouca melanina — resposta reduzida ao laser" },
      { value: "Claro",           label: "Claro",           bgColor: "#E9CBA0", classification: "Loiro escuro",risk: "medio" },
      { value: "Castanho claro",  label: "Castanho claro",  bgColor: "#A47148", classification: "",            risk: "baixo",textColor: "#fff" },
      { value: "Castanho escuro", label: "Castanho escuro", bgColor: "#5C3A21", classification: "",            risk: "baixo",textColor: "#fff" },
      { value: "Preto",           label: "Preto",           bgColor: "#1F1414", classification: "Ideal p/ laser", risk: "baixo", textColor: "#fff" },
    ],
  },
  { key: "espessura_pelo", label: "Espessura do pelo", type: "select",
    options: ["Fino", "Médio", "Grosso"] },
  { key: "densidade_pelo", label: "Densidade do pelo", type: "select",
    options: ["Baixa", "Média", "Alta"] },
  { key: "frequencia_epilacao", label: "Frequência atual de epilação", type: "select",
    options: ["Semanal", "Quinzenal", "Mensal", "Bimestral", "Eventual"] },
  {
    key: "metodo_utilizado", label: "Métodos previamente utilizados", type: "checkbox_group_visual", full: true,
    options: [
      { value: "Lâmina",           label: "Lâmina",             icon: "🪒" },
      { value: "Cera",             label: "Cera",               icon: "🍯" },
      { value: "Laser",            label: "Laser",              icon: "🔦", risk: "medio" },
      { value: "Luz Intensa Pulsada", label: "Luz Intensa Pulsada", icon: "💡", risk: "medio" },
      { value: "Linha",            label: "Linha",              icon: "🧵" },
      { value: "Pinça",            label: "Pinça",              icon: "🤏" },
      { value: "Depilador elétrico",label: "Depilador elétrico",icon: "⚡" },
      { value: "Creme depilatório",label: "Creme depilatório",  icon: "🧴" },
    ],
  },
  {
    key: "areas_tratadas", label: "Áreas a tratar — mapa corporal", type: "body_map", full: true,
    views: ["frontal", "posterior"],
  },
  { key: "sensibilidade_previa", label: "Sensibilidade prévia (dor, foliculite, alergia)", type: "textarea", full: true },
  { key: "contraindicacoes_epi", label: "Contraindicações identificadas", type: "textarea", full: true },
  { key: "observacoes_epi", label: "Observações clínicas", type: "textarea", full: true },
];

export const MODULE_LABELS = {
  geral: "Anamnese",
  facial: "Facial",
  injetaveis: "Injetáveis",
  corporal: "Corporal",
  capilar: "Capilar",
  epilacao: "Epilação",
};
