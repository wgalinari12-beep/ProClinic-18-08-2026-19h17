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
export const SCHEMA_INJETAVEIS = [
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
  { key: "regiao_frontal", label: "Região frontal — pontos e produtos", type: "textarea", full: true },
  { key: "regiao_glabela", label: "Região glabelar — pontos e produtos", type: "textarea", full: true },
  { key: "regiao_periorbital", label: "Região periorbital — pontos e produtos", type: "textarea", full: true },
  { key: "regiao_malar", label: "Região malar / zigomática", type: "textarea", full: true },
  { key: "regiao_labios", label: "Lábios", type: "textarea", full: true },
  { key: "regiao_mento", label: "Mento / mandíbula", type: "textarea", full: true },
  { key: "produto_marca", label: "Marca do produto" },
  { key: "produto_lote", label: "Lote" },
  { key: "produto_validade", label: "Validade", type: "date" },
  { key: "produto_fabricante", label: "Fabricante" },
  { key: "quantidade_total", label: "Quantidade total aplicada (UI ou ml)" },
  { key: "relatorio_final", label: "Relatório final dos injetáveis", type: "textarea", full: true },
];

// ─────────────────────────────── SCHEMA_CORPORAL ──────────────────────────────
export const SCHEMA_CORPORAL = [
  { key: "altura", label: "Altura (cm)", type: "number" },
  { key: "peso", label: "Peso (kg)", type: "number" },
  { key: "imc", label: "IMC (calculado)", type: "imc", full: true,
    help: "Calculado automaticamente a partir de altura e peso." },

  { key: "distribuicao_gordura", label: "Distribuição de gordura", type: "select",
    options: ["Andróide", "Ginóide", "Mista"] },

  {
    key: "celulite_grau", label: "Grau de celulite", type: "card_select", full: true, columns: 5,
    options: [
      { value: "Ausente", label: "Ausente", bgColor: "#E8F5E9", classification: "Grau 0", risk: "baixo",  subtitle: "Sem alterações" },
      { value: "Grau I",  label: "Grau I",  bgColor: "#FFF9C4", classification: "Grau I", risk: "baixo",  subtitle: "Visível ao pinçar" },
      { value: "Grau II", label: "Grau II", bgColor: "#FFE082", classification: "Grau II", risk: "medio", subtitle: "Visível de pé" },
      { value: "Grau III",label: "Grau III",bgColor: "#FFB74D", classification: "Grau III",risk: "medio", subtitle: "Visível deitada" },
      { value: "Grau IV", label: "Grau IV", bgColor: "#EF5350", classification: "Grau IV", risk: "alto",  subtitle: "Nódulos evidentes", textColor: "#fff" },
    ],
  },

  {
    key: "regioes_celulite", label: "Regiões afetadas pela celulite", type: "body_map", full: true,
    views: ["frontal", "posterior"],
  },

  {
    key: "flacidez_corporal", label: "Flacidez corporal", type: "card_select", full: true, columns: 4,
    options: [
      { value: "Ausente",   label: "Ausente",   bgColor: "#E8F5E9", risk: "baixo" },
      { value: "Leve",      label: "Leve",      bgColor: "#FFF9C4", risk: "baixo" },
      { value: "Moderada",  label: "Moderada",  bgColor: "#FFCC80", risk: "medio" },
      { value: "Acentuada", label: "Acentuada", bgColor: "#EF9A9A", risk: "alto" },
    ],
  },

  {
    key: "estrias", label: "Estrias", type: "checkbox_group_visual", full: true,
    options: [
      { value: "Brancas",   label: "Brancas",   description: "Antigas, atróficas",     icon: "⚪" },
      { value: "Vermelhas", label: "Vermelhas", description: "Recentes, ativas",       icon: "🔴" },
      { value: "Roxas",     label: "Roxas",     description: "Intermediárias, vascular", icon: "🟣" },
    ],
  },

  {
    key: "gordura_localizada", label: "Gordura localizada — mapa corporal", type: "body_map", full: true,
    views: ["frontal", "posterior"],
  },

  { key: "perimetria_abdomen", label: "Perimetria abdômen (cm)", type: "number" },
  { key: "perimetria_quadril", label: "Perimetria quadril (cm)", type: "number" },
  { key: "perimetria_coxa", label: "Perimetria coxa (cm)", type: "number" },
  { key: "atividade_fisica", label: "Atividade física", type: "select",
    options: ["Sedentário", "Leve", "Moderada", "Intensa"] },
  { key: "habitos_alimentares", label: "Hábitos alimentares", type: "textarea", full: true },
];

// ─────────────────────────────── SCHEMA_CAPILAR ───────────────────────────────
export const SCHEMA_CAPILAR = [
  {
    key: "tipo_cabelo", label: "Tipo de cabelo", type: "image_card_select", full: true, columns: 4,
    options: [
      { value: "Liso",      label: "Liso",      icon: "▬", subtitle: "Tipo 1", description: "Fios sem curvatura" },
      { value: "Ondulado",  label: "Ondulado",  icon: "〰️", subtitle: "Tipo 2", description: "Ondas suaves em S" },
      { value: "Cacheado",  label: "Cacheado",  icon: "🌀", subtitle: "Tipo 3", description: "Cachos definidos" },
      { value: "Crespo",    label: "Crespo",    icon: "🌪️", subtitle: "Tipo 4", description: "Alta densidade de cachos" },
    ],
  },
  { key: "espessura_fio", label: "Espessura do fio", type: "select",
    options: ["Fino", "Médio", "Grosso"] },
  { key: "oleosidade_couro", label: "Oleosidade do couro cabeludo", type: "select",
    options: ["Seco", "Normal", "Oleoso"] },
  { key: "porosidade", label: "Porosidade", type: "select", options: ["Baixa", "Média", "Alta"] },
  { key: "elasticidade", label: "Elasticidade", type: "select", options: ["Baixa", "Média", "Alta"] },

  {
    key: "queda", label: "Queda capilar", type: "card_select", full: true, columns: 4,
    options: [
      { value: "Não",       label: "Sem queda", bgColor: "#E8F5E9", risk: "baixo" },
      { value: "Leve",      label: "Leve",      bgColor: "#FFF9C4", risk: "baixo" },
      { value: "Moderada",  label: "Moderada",  bgColor: "#FFCC80", risk: "medio" },
      { value: "Acentuada", label: "Acentuada", bgColor: "#EF9A9A", risk: "alto" },
    ],
  },

  {
    key: "queda_padrao", label: "Padrão da queda", type: "image_card_select", full: true, columns: 3,
    when: (a) => a.queda && a.queda !== "Não",
    options: [
      { value: "Difusa",         label: "Difusa",         icon: "🌫️", description: "Perda uniforme" },
      { value: "Androgenética",  label: "Androgenética",  icon: "🧬", description: "Norwood / Ludwig" },
      { value: "Areata",         label: "Areata",         icon: "⭕", description: "Placas circulares" },
      { value: "Pós-parto",      label: "Pós-parto",      icon: "🤱", description: "Eflúvio telógeno" },
      { value: "Stress",         label: "Stress",         icon: "😰", description: "Eflúvio agudo" },
    ],
  },

  {
    key: "quimica", label: "Possui química?", type: "checkbox_group_visual", full: true,
    options: [
      { value: "Coloração",    label: "Coloração",    icon: "🎨" },
      { value: "Descoloração", label: "Descoloração", icon: "⚡", risk: "medio" },
      { value: "Progressiva",  label: "Progressiva",  icon: "🧴", risk: "medio" },
      { value: "Relaxamento",  label: "Relaxamento",  icon: "💆" },
      { value: "Permanente",   label: "Permanente",   icon: "🌀" },
    ],
  },

  { key: "coloração_freq", label: "Frequência de coloração", type: "select",
    options: ["Nunca", "Eventual", "Mensal", "Quinzenal"] },

  {
    key: "doencas_couro", label: "Doenças do couro cabeludo", type: "checkbox_group_visual", full: true,
    options: [
      { value: "Caspa",                 label: "Caspa",                 icon: "❄️" },
      { value: "Dermatite seborreica",  label: "Dermatite seborreica",  icon: "🔬", risk: "medio" },
      { value: "Psoríase",              label: "Psoríase",              icon: "🩹", risk: "alto" },
      { value: "Foliculite",            label: "Foliculite",            icon: "🦠", risk: "medio" },
    ],
  },
  { key: "habitos_capilar", label: "Hábitos / rotina capilar", type: "textarea", full: true },
];

// ─────────────────────────────── SCHEMA_EPILACAO ──────────────────────────────
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
  { key: "frequencia_epilacao", label: "Frequência atual de epilação", type: "select",
    options: ["Semanal", "Quinzenal", "Mensal", "Bimestral", "Eventual"] },
  {
    key: "metodo_utilizado", label: "Métodos previamente utilizados", type: "checkbox_group_visual", full: true,
    options: [
      { value: "Lâmina",           label: "Lâmina",             icon: "🪒" },
      { value: "Cera",             label: "Cera",               icon: "🍯" },
      { value: "Laser",            label: "Laser",              icon: "🔦", risk: "medio" },
      { value: "Linha",            label: "Linha",              icon: "🧵" },
      { value: "Pinça",            label: "Pinça",              icon: "🤏" },
      { value: "Depilador elétrico",label: "Depilador elétrico",icon: "⚡" },
    ],
  },
  {
    key: "areas_tratadas", label: "Áreas a tratar — mapa corporal", type: "body_map", full: true,
    views: ["frontal", "posterior"],
  },
  { key: "sensibilidade_previa", label: "Sensibilidade prévia (dor, foliculite, alergia)", type: "textarea", full: true },
  { key: "contraindicacoes_epi", label: "Contraindicações identificadas", type: "textarea", full: true },
  { key: "observacoes_epi", label: "Observações", type: "textarea", full: true },
];

export const MODULE_LABELS = {
  geral: "Anamnese",
  facial: "Facial",
  injetaveis: "Injetáveis",
  corporal: "Corporal",
  capilar: "Capilar",
  epilacao: "Epilação",
};
