// ⭐ Fase 2 — Sistema ÚNICO de cores de status (harmonizado ao tema premium,
// porém com matizes bem distintas para leitura rápida em Agenda, Timeline,
// Histórico, Cards, Tooltips, Legendas e Dashboard).
//
// Cada status expõe:
//   - label: rótulo em pt-BR
//   - color: cor sólida (borda/ponto/texto forte)
//   - tint:  fundo suave translúcido (funciona em light/dark)
//   - text:  cor de texto legível sobre o tint

export const STATUS_META = {
  agendado: {
    label: "Agendado",
    color: "#2563EB", // azul profissional
    tint: "rgba(37, 99, 235, 0.12)",
    text: "#1D4ED8",
  },
  confirmado: {
    label: "Confirmado",
    color: "#059669", // verde esmeralda
    tint: "rgba(5, 150, 105, 0.14)",
    text: "#047857",
  },
  encaixe: {
    label: "Encaixe",
    color: "#EA580C", // laranja
    tint: "rgba(234, 88, 12, 0.14)",
    text: "#C2410C",
  },
  em_atendimento: {
    label: "Em atendimento",
    color: "#CA8A04", // ouro / âmbar profundo
    tint: "rgba(202, 138, 4, 0.18)",
    text: "#A16207",
  },
  concluido: {
    label: "Concluído",
    color: "#7C3AED", // roxo
    tint: "rgba(124, 58, 237, 0.13)",
    text: "#6D28D9",
  },
  cancelado: {
    label: "Cancelado",
    color: "#DC2626", // vermelho
    tint: "rgba(220, 38, 38, 0.12)",
    text: "#B91C1C",
  },
  falta: {
    label: "Falta",
    color: "#64748B", // cinza ardósia
    tint: "rgba(100, 116, 139, 0.16)",
    text: "#475569",
  },
};

// aliases legados / variações de nomenclatura
const ALIASES = {
  no_show: "falta",
  faltou: "falta",
  ausente: "falta",
  atendimento: "em_atendimento",
  "em atendimento": "em_atendimento",
  finalizado: "concluido",
  concluída: "concluido",
  concluida: "concluido",
};

export function getStatusMeta(status) {
  if (!status) return STATUS_META.agendado;
  const key = ALIASES[status] || status;
  return STATUS_META[key] || STATUS_META.agendado;
}

// Ordem canônica para legendas
export const STATUS_ORDER = [
  "agendado",
  "confirmado",
  "encaixe",
  "em_atendimento",
  "concluido",
  "cancelado",
  "falta",
];
