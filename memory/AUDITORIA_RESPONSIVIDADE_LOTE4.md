# AUDITORIA DE RESPONSIVIDADE — LOTE 4

> MODO AUDITORIA — nenhum arquivo de código foi alterado. Documento gerado apenas para análise e aprovação.
> Data: Ago/2026 · Escopo: ETAPA 1 do Lote 4

## Metodologia
- Mapeamento estático de todo `frontend/src` (páginas + componentes).
- Busca por padrões de risco: larguras fixas em px, `grid-cols-*` sem prefixo responsivo, tabelas cruas sem scroll, `TabsList` sem scroll, containers `overflow-hidden`, ausência de drawer mobile.
- Cálculo de largura útil por resolução considerando o sidebar fixo (expandido `248px`, recolhido `72px`).

### Largura útil de conteúdo (viewport − sidebar expandido 248px)
| Resolução | Útil (expandido) | Útil (recolhido 72px) |
|-----------|------------------|------------------------|
| 1366×768  | ~1118px          | ~1294px |
| 1440×900  | ~1192px          | ~1368px |
| 1600×900  | ~1352px          | ~1528px |
| 1920×1080 | ~1672px          | ~1848px |
| 2560×1440 | ~2312px          | ~2488px |

---

## Problemas encontrados

### R1 — Layout sem sidebar responsivo (sem drawer mobile) · Severidade: MÉDIA-ALTA
- **Arquivo:** `components/Layout.jsx`, `components/Sidebar.jsx`
- O `Layout` renderiza `<Sidebar>` inline num `flex`. O sidebar tem largura fixa (`w-[248px]` / `w-[72px]`), `h-screen sticky`. Não há hambúrguer/overlay/drawer para telas pequenas.
- **Impacto:** abaixo de ~1024px o sidebar consome largura demais; em mobile a área de conteúdo fica espremida. O recolher é **manual** (não há auto-collapse por breakpoint).
- **Resoluções afetadas:** <1280px (tablet retrato / mobile). Em 1366+ é utilizável, porém sem otimização.

### R2 — TabsList da tela do paciente sem scroll horizontal · Severidade: ALTA (em 1366)
- **Arquivo:** `pages/PatientDetail.jsx` (linha ~165)
- Até **7 abas** com ícone+texto: Timeline · Prontuário · Clínica · Anamnese · Orçamentos · Documentos · Financeiro. O `TabsList` (shadcn `inline-flex`) **não** tem `overflow-x-auto`.
- **Impacto:** em 1366×768 (útil ~1118px) as abas estouram/comprimem e podem ser cortadas. Em 1440+ melhora, mas continua apertado.
- **Resoluções afetadas:** 1366×768 (crítico), 1440×900 (apertado).

### R3 — Tabelas cruas sem wrapper de scroll horizontal · Severidade: MÉDIA
- **Arquivos:** `pages/Equipe.jsx`, `pages/MinhaAssinatura.jsx`, `pages/Documentos.jsx`, `pages/PatientDetail.jsx` (Documentos), `pages/SuperAdmin.jsx` (3 tabelas), `components/PatientFinanceTab.jsx`, `components/PatientClinicalTimeline.jsx`.
- Todas usam `<table className="w-full text-sm">`. Várias dentro de container `overflow-hidden` (ex.: PatientDetail Documentos com 6 colunas) → em telas estreitas o conteúdo é **cortado**, não rolável.
- **Impacto:** perda de colunas/informação em <1280px.

### R4 — Grade da Agenda (semana) sem scroll e sem adaptação · Severidade: ALTA
- **Arquivo:** `pages/Agenda.jsx` (linha ~474-491)
- Grade `grid-cols-[60px_repeat(7,1fr)]` (8 colunas) dentro de `rounded-2xl ... overflow-hidden`. Sem `overflow-x-auto` e sem redução de dias em telas pequenas.
- **Impacto:** em <1200px as 7 colunas de dia ficam muito estreitas para os cards de agendamento; em mobile é praticamente inutilizável. É a tela mais complexa do sistema.
- **Resoluções afetadas:** 1366×768 (apertado), qualquer coisa <1200px (crítico).

### R5 — `grid-cols-2` fixo sem colapso responsivo · Severidade: BAIXA-MÉDIA
- **Ocorrências:** `grid-cols-2` aparece ~35× sem prefixo responsivo (não vira 1 coluna em <640px).
- **Exemplos de formulários:** `pages/Financeiro.jsx` (entry-form `grid grid-cols-2`), `pages/Prontuario.jsx` (record-form `grid grid-cols-2`), grids de fotos antes/depois.
- **Impacto:** campos de formulário e miniaturas ficam apertados em telas pequenas/modais estreitos.

### R6 — Outros `TabsList` sem scroll · Severidade: BAIXA-MÉDIA
- **Arquivos:** `components/DocumentGenerator.jsx`, `pages/Documentos.jsx`, `pages/SuperAdmin.jsx`, `components/AttendanceDialog.jsx` (5 abas — ok em desktop, risco só em telas pequenas).

### R7 — Sidebar não auto-recolhe por breakpoint · Severidade: BAIXA
- Poderia recolher automaticamente abaixo de ~1280px para liberar largura (hoje é só manual).

---

## Componentes que extrapolam viewport / cortam conteúdo
| Item | Local | Sintoma |
|------|-------|---------|
| Abas do paciente (7) | PatientDetail | estouro horizontal em 1366 |
| Grade semanal (8 col) | Agenda | colunas espremidas / corte |
| Tabela Documentos (6 col) | PatientDetail | `overflow-hidden` corta colunas |
| Tabelas SuperAdmin | SuperAdmin | corte em telas estreitas |
| Formulários `grid-cols-2` | Prontuario/Financeiro | campos apertados em modal |

## Modais
- Maioria com `max-w-*` + `max-h-[90vh] overflow-y-auto` (bom): Equipe, Anamnese, Documentos (`max-w-5xl`), DocumentGenerator, AttendanceDialog (`max-w-6xl w-[97vw]`).
- Modais pequenos sem `max-h`/scroll: `Procedimentos`, `Financeiro`, `Agenda` (create) — usam largura padrão; risco baixo (formulários curtos).

## Larguras fixas em px encontradas (baixo risco)
- `Sidebar` `w-[248px]`/`w-[72px]` (esperado), `ui/toast` `max-w-[420px]`, `ui/drawer` `w-[100px]`, `MedicationTable` `min-w-[140/160px]` (dentro de tabela com scroll próprio).

---

## Riscos identificados (para a futura correção)
- Ajustes de `overflow-x-auto` e `grid-cols` responsivos são **CSS-only** e de baixo risco de regressão.
- Sidebar mobile (drawer) e Agenda responsiva mexem em estrutura → risco médio, exigem validação visual.
- Nenhuma correção proposta toca em API, schema ou dados.

## Impacto esperado das correções
- Eliminação de estouro horizontal em 1366×768 (PatientDetail, Agenda).
- Tabelas roláveis sem perda de colunas.
- Formulários legíveis em telas menores.

## Estratégia de rollback
- Todas as mudanças de responsividade são aditivas em `className` → rollback = reverter as classes (git revert por arquivo). Sem migração/estado persistente.

## Estimativa de esforço (somente Etapa 1 — responsividade)
| Item | Esforço |
|------|---------|
| R2/R3/R6 (overflow-x-auto + wrappers) | 2–3h |
| R5 (grid responsivo em formulários) | 1–2h |
| R4 (Agenda scroll + view mobile) | 4–6h |
| R1/R7 (sidebar drawer + auto-collapse) | 4–5h |
| **Total** | **11–16h** |

---

**STATUS: AGUARDANDO APROVAÇÃO. Nenhuma alteração será feita sem autorização explícita.**
