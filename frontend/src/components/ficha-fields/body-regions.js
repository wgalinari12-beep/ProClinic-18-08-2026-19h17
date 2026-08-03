// Region catalog shared by BodyMap.
// Keep everything data-driven so future maps (face, hands, dental) can be added
// without touching the component.

export const REGIONS_FRONTAL_FULL = [
  { id: "cabeca_face", label: "Face", cx: 50, cy: 8, rx: 6, ry: 7 },
  { id: "pescoco", label: "Pescoço", cx: 50, cy: 16, rx: 3.5, ry: 2.5 },
  { id: "peitoral", label: "Peitoral", cx: 50, cy: 24, rx: 10, ry: 5 },
  { id: "braco_esq", label: "Braço esq.", cx: 34, cy: 27, rx: 3, ry: 7 },
  { id: "braco_dir", label: "Braço dir.", cx: 66, cy: 27, rx: 3, ry: 7 },
  { id: "antebraco_esq", label: "Antebraço esq.", cx: 30, cy: 40, rx: 3, ry: 6 },
  { id: "antebraco_dir", label: "Antebraço dir.", cx: 70, cy: 40, rx: 3, ry: 6 },
  { id: "abdomen", label: "Abdômen", cx: 50, cy: 36, rx: 8, ry: 5 },
  { id: "flancos", label: "Flancos", cx: 50, cy: 42, rx: 10, ry: 3 },
  { id: "cintura", label: "Cintura", cx: 50, cy: 48, rx: 8, ry: 2.5 },
  { id: "quadril", label: "Quadril", cx: 50, cy: 54, rx: 9, ry: 3.5 },
  { id: "coxa_esq_frontal", label: "Coxa esq.", cx: 44, cy: 66, rx: 4, ry: 8 },
  { id: "coxa_dir_frontal", label: "Coxa dir.", cx: 56, cy: 66, rx: 4, ry: 8 },
  { id: "joelho_esq", label: "Joelho esq.", cx: 44, cy: 78, rx: 3, ry: 2 },
  { id: "joelho_dir", label: "Joelho dir.", cx: 56, cy: 78, rx: 3, ry: 2 },
  { id: "canela_esq", label: "Canela esq.", cx: 44, cy: 88, rx: 3, ry: 7 },
  { id: "canela_dir", label: "Canela dir.", cx: 56, cy: 88, rx: 3, ry: 7 },
  { id: "virilha", label: "Virilha", cx: 50, cy: 58, rx: 4, ry: 2 },
  { id: "buco", label: "Buço", cx: 50, cy: 10, rx: 1.8, ry: 0.8 },
  { id: "queixo", label: "Queixo", cx: 50, cy: 13, rx: 2, ry: 1 },
  { id: "axila_esq", label: "Axila esq.", cx: 40, cy: 21, rx: 2, ry: 1.5 },
  { id: "axila_dir", label: "Axila dir.", cx: 60, cy: 21, rx: 2, ry: 1.5 },
];

export const REGIONS_POSTERIOR_FULL = [
  { id: "nuca", label: "Nuca", cx: 50, cy: 14, rx: 4, ry: 2.5 },
  { id: "costas_alta", label: "Costas (alta)", cx: 50, cy: 24, rx: 10, ry: 4 },
  { id: "costas_baixa", label: "Costas (baixa)", cx: 50, cy: 34, rx: 10, ry: 4 },
  { id: "lombar", label: "Lombar", cx: 50, cy: 43, rx: 8, ry: 3 },
  { id: "gluteos", label: "Glúteos", cx: 50, cy: 54, rx: 10, ry: 5 },
  { id: "coxa_esq_post", label: "Coxa post. esq.", cx: 44, cy: 68, rx: 4, ry: 8 },
  { id: "coxa_dir_post", label: "Coxa post. dir.", cx: 56, cy: 68, rx: 4, ry: 8 },
  { id: "panturrilha_esq", label: "Panturrilha esq.", cx: 44, cy: 86, rx: 3, ry: 7 },
  { id: "panturrilha_dir", label: "Panturrilha dir.", cx: 56, cy: 86, rx: 3, ry: 7 },
  { id: "braco_post_esq", label: "Braço post. esq.", cx: 34, cy: 28, rx: 3, ry: 7 },
  { id: "braco_post_dir", label: "Braço post. dir.", cx: 66, cy: 28, rx: 3, ry: 7 },
];

// A simplified stylized human silhouette (unisex) — used both frontal & posterior.
// SVG path uses viewBox 0 0 100 100.
export const SILHOUETTE_PATH =
  "M50 2 C 55 2 58 6 58 11 C 58 14 57 16 55 17 C 60 18 62 21 63 24 L 66 30 L 70 34 L 72 42 L 71 46 L 68 46 L 66 42 L 64 38 L 62 42 L 62 55 L 60 60 L 58 74 L 56 88 L 55 95 L 52 96 L 51 90 L 51 74 L 50 66 L 49 74 L 49 90 L 48 96 L 45 95 L 44 88 L 42 74 L 40 60 L 38 55 L 38 42 L 36 38 L 34 42 L 32 46 L 29 46 L 28 42 L 30 34 L 34 30 L 37 24 C 38 21 40 18 45 17 C 43 16 42 14 42 11 C 42 6 45 2 50 2 Z";
