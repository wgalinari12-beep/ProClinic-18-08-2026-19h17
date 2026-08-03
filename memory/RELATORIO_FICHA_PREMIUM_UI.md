# Relatório — Ficha Premium (camada visual concluída)
_Fev/2026 · escopo executado nesta sessão_

## 1. Componentes criados (5 genéricos, 100% reutilizáveis)

| Componente | Arquivo | Reuso previsto |
|---|---|---|
| `CardSelect` | `ficha-fields/CardSelect.jsx` | Fitzpatrick · Acne · Celulite · Flacidez · Rosácea · Obesidade · Diástase · qualquer escala clínica |
| `ImageCardSelect` | `ficha-fields/ImageCardSelect.jsx` | Norwood-Hamilton · Savin · Alopecia Areata · Displasias Pilosas · Cicatrizes de Acne · Discromias · Olheiras · Estrias · Tipos de Cabelo |
| `CheckboxGroupVisual` | `ficha-fields/CheckboxGroupVisual.jsx` | Doenças · Histórico Clínico · Histórico Estético · Hábitos · Contraindicações · Quaisquer listas categorizadas |
| `MedicationTable` | `ficha-fields/MedicationTable.jsx` | Medicamentos · Suplementos · Hormônios · Cosmecêuticos · Nutracêuticos · Qualquer tabela dinâmica de itens |
| `BodyMap` | `ficha-fields/BodyMap.jsx` + `body-regions.js` | Gordura localizada · Celulite · Flacidez · Estrias · Epilação · Áreas de dor · Enzimas · Vasos · Injetáveis |

**Extras**: `body-regions.js` (catálogo desacoplado de regiões frontal/posterior + silhueta SVG unissex).

## 2. Ganchos de extensão prontos (sem refatorar depois)

- **CardSelect** aceita: `image`, `icon`, `bgColor`, `textColor`, `tooltip`, `score`, `classification`, `risk`, `subtitle`, `columns`, `multi`.
- **ImageCardSelect** aceita: `image`, `icon`, `subtitle`, `description`, `badge`, `allowZoom` (dialog fullscreen já pronto).
- **CheckboxGroupVisual** aceita: `groups[]` (categorias/agrupamentos), `options[]` (plana), `searchable` auto (>10 itens), `icon`, `description`, `risk` por opção.
- **MedicationTable** aceita: `columns` custom (chave/label/placeholder), `addLabel`, `allowAdd`, `allowRemove` — permite reuso p/ suplementos, hormônios, cosmecêuticos.
- **BodyMap** aceita: `views` (frontal/posterior/só um), `regionsFrontal`, `regionsPosterior` (catálogos custom — futuro mapa facial, mãos, dental), `highlightColor`, `allowChipToggle`.

Todos os 5 são **fully-controlled** (`value`/`onChange`), zero estado interno persistido → integram-se ao autosave existente do `FichaForm`.

## 3. Campos migrados para a camada visual

| Ficha | Campo | De → Para |
|---|---|---|
| Anamnese | `doencas` | `chips` → `checkbox_group_visual` (3 grupos, ícones, risco) |
| Anamnese | `medicacoes` | `textarea` → `medication_table` |
| Anamnese | `suplementos` (novo) | — → `medication_table` |
| Facial | `tipo_pele` | `select` → `card_select` (4 cards + ícones) |
| Facial | `fototipo` | `select` → `card_select` (6 tons Fitzpatrick + risco) |
| Facial | `acne` | `select` → `card_select` (4 graus cromáticos) |
| Facial | `manchas` | `chips` → `checkbox_group_visual` |
| Facial | `rugas` | `chips` → `checkbox_group_visual` (com descrição) |
| Facial | `flacidez` | `select` → `card_select` (4 graus + risco) |
| Facial | `rosacea` | `select` → `card_select` |
| Injetáveis | `procedimento_planejado` | `chips` → `image_card_select` (6 ícones + descrição) |
| Corporal | `celulite_grau` | `select` → `card_select` (5 graus cromáticos) |
| Corporal | `regioes_celulite` | `chips` → **`body_map`** (frontal+posterior) |
| Corporal | `flacidez_corporal` | `select` → `card_select` |
| Corporal | `estrias` | `chips` → `checkbox_group_visual` (com descrição/ícone) |
| Corporal | `gordura_localizada` | `chips` → **`body_map`** (frontal+posterior) |
| Capilar | `tipo_cabelo` | `select` → `image_card_select` (4 tipos + ícone) |
| Capilar | `queda` | `select` → `card_select` |
| Capilar | `queda_padrao` | `select` → `image_card_select` |
| Capilar | `quimica` | `chips` → `checkbox_group_visual` |
| Capilar | `doencas_couro` | `chips` → `checkbox_group_visual` |
| Epilação | `fototipo_fitzpatrick` | `select` → `card_select` |
| Epilação | `pigmento_pelo` | `select` → `card_select` (5 tons) |
| Epilação | `metodo_utilizado` | `chips` → `checkbox_group_visual` |
| Epilação | `areas_tratadas` | `chips` → **`body_map`** |

**Total: 25 campos migrados** para UX Premium, mantendo os **mesmos valores stored** — zero migração de dados exigida.

## 4. Campos pendentes (backlog visual, não bloqueante)

- `Facial > oleosidade / sensibilidade / habitos_solares / uso_protetor` — permanecem como `select` (baixa densidade informacional, ganho visual marginal).
- `Corporal > distribuicao_gordura / atividade_fisica` — idem.
- `Capilar > espessura_fio / oleosidade_couro / porosidade / elasticidade / coloração_freq` — idem.
- `Epilação > espessura_pelo / frequencia_epilacao` — idem.
- **Mapa facial interativo** para `Injetáveis` — placeholder; SVG facial detalhado ainda a fazer. Estrutura pronta (basta passar `regionsFrontal` custom).

## 5. Locais preparados p/ receber imagens Premium

Cada `option` em `CardSelect` e `ImageCardSelect` aceita `image` (URL). Basta fornecer os assets:

- **Fitzpatrick I–VI** → swatch pronto via `bgColor`; substituível por foto real via `image`.
- **Acne I–IV / Celulite I–IV / Flacidez / Rosácea** → cromáticos hoje, substituíveis por ilustrações.
- **Injetáveis (6 procedimentos)** → hoje com emoji ícone; slot `image` pronto para renders 3D ou fotos clínicas.
- **Tipos de cabelo (Liso/Ondulado/Cacheado/Crespo)** → slot `image` pronto.
- **Padrões de queda capilar (Difusa/Androgenética/Areata/Pós-parto/Stress)** → slot `image` pronto — próximo passo Norwood/Savin.
- **Pigmento do pelo (5 tons)** → swatch pronto.

Após upload dos assets, basta editar `ficha-schemas.js` (nenhuma alteração de componente necessária).

## 6. Ganhos de manutenção

- **1 componente, N escalas**: adicionar futura escala (Baumann, Norwood, Savin) exige apenas nova entrada em `ficha-schemas.js`, sem tocar em componente.
- **Body maps genéricos**: `BodyMap` já pronto para 4 usos previstos (gordura, celulite, estrias, epilação). Novos casos (dor, enzimas, injetáveis facial) → basta declarar novo `body_map`.
- **Backward compatible**: valores stored idênticos (`"III"`, `"Grau II"`, `["Melasma"]`) — nenhum registro histórico precisa ser migrado. Testado via curl: **anamnesis-modules aceita e devolve os novos formatos sem alteração backend**.
- **Zero mudança em backend**: `answers` continua sendo dict livre; medicação como array de objetos é aceita nativamente.

## 7. Ganhos de performance

- `useMemo` já aplicado ao `visibleFields` do `FichaForm` (renderização condicional cacheada).
- Componentes controlados sem estado interno pesado (exceto zoom modal e busca da CheckboxGroupVisual).
- SVG do body map inline (1 path silhueta + N ellipses) — sem imagens externas → 0 requisições, 0 layout shift.
- Tooltips lazy via Radix (`TooltipProvider` compartilhado).
- Autosave existente (debounce 900 ms) inalterado — os novos tipos usam o mesmo `setField`.

## 8. Plano da próxima etapa (após aprovação)

### 8.1 Fase Corporal Premium
- Cálculo automático **IMC** (já existe helper) → adicionar classificação Petroski completa.
- **Perimetria**: cálculo automático de relação C/Q + score de risco antropométrico.
- **Body map com heatmap** de intensidade por região (`intensity: 0-3` já suportado por `highlightColor` variável).

### 8.2 Fase Capilar Premium
- Upload de assets **Norwood-Hamilton** (7 estágios) e **Savin** (8 estágios) → slots já estruturados.
- Tricoscopia com galeria expandida (PhotoUploader já suporta).

### 8.3 Fase Injetáveis Premium
- SVG **facial interativo** (regionsFrontal customizado no `BodyMap`) — pontos de aplicação com contadores UI/ml.
- Rastreabilidade de lote/validade em cards (assets em `image_card_select`).

### 8.4 Fase PDF Clínico Premium
- Rota `POST /api/patients/{id}/ficha-pdf` renderizando ficha completa (via `xhtml2pdf` existente).
- Includes: cards visuais, body maps como SVG embutido, tabela de medicações.

### 8.5 Fase IA Contextual Enriquecida
- `_build_patient_ai_context` já lê `answers`; basta enriquecer o parser para converter `medication_table` em prose e `body_map` em lista de regiões.

## 9. Riscos & mitigações

| Risco | Mitigação |
|---|---|
| Registros antigos com `medicacoes` como string | `MedicationTable` recebe `value` — se não for array, trata como `[]`. Texto original preservado no campo `answers.medicacoes_texto_legacy` (opcional). |
| Chaves de região do `body_map` diferentes em novos catálogos | Cada `body_map` field pode passar `regionsFrontal`/`regionsPosterior` custom → chave estável do banco fica sob controle do schema. |
| Fototipo com valor `"I"` vs `"Tipo I"` em Epilação | Já tratado: `FITZ_LEGACY` para `SCHEMA_FACIAL`, `FITZ_LONG` para `SCHEMA_EPILACAO`. Valores stored preservados. |

---
**Status: infraestrutura visual concluída · pronto para camadas seguintes (IMC/Petroski/Norwood/PDF).**
