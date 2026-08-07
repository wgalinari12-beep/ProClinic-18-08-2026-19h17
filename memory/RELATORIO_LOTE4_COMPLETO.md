# RELATÓRIO CONSOLIDADO — LOTE 4

> MODO AUDITORIA — nenhum arquivo de código foi alterado, nenhum teste automático executado, nenhuma migração realizada.
> Consolida as Etapas 1 a 5 + plano de implementação por fases. Deliverável da ETAPA 6.
> Data: Ago/2026

---

## 1) RESPONSIVIDADE (resumo — detalhe em `AUDITORIA_RESPONSIVIDADE_LOTE4.md`)

| ID | Problema | Arquivos | Prioridade | Impacto | Risco correção |
|----|----------|----------|------------|---------|----------------|
| R2 | 7 abas sem scroll horizontal | `PatientDetail.jsx` | Alta | Estouro em 1366 | Baixo (CSS) |
| R4 | Grade semanal Agenda sem scroll/adaptação | `Agenda.jsx` | Alta | Inutilizável <1200px | Médio |
| R1 | Sem sidebar/drawer mobile | `Layout.jsx`, `Sidebar.jsx` | Média-Alta | Mobile/tablet | Médio |
| R3 | Tabelas cruas sem scroll; `overflow-hidden` corta | 9 arquivos | Média | Perda de colunas | Baixo (CSS) |
| R5 | `grid-cols-2` fixo (não colapsa) | ~35 ocorrências | Baixa-Média | Campos apertados | Baixo (CSS) |
| R6 | Outros `TabsList` sem scroll | 4 arquivos | Baixa | Telas pequenas | Baixo (CSS) |
| R7 | Sidebar não auto-recolhe | `Sidebar.jsx` | Baixa | UX | Baixo |

**Resoluções mais afetadas:** 1366×768 (R2, R4) e <1200px (R4, R1). Em 1920/2560 o sistema é confortável (apenas espaço lateral ocioso, aceitável).

---

## 2) MENUS — Prontuário e Anamnese (global)

### Análise
- **`pages/Prontuario.jsx` (menu global):** CRUD global de `medical-records` com entrada **manual de URLs de foto** (separadas por vírgula) e profissional **hardcoded** ("Dra. Bella Castro"). É um módulo **legado**, anterior ao fluxo por sessão.
- **`pages/Anamnese.jsx` (menu global):** formulário com **8 perguntas fixas hardcoded** (`TEMPLATE_QUESTIONS`). Também **legado**.
- **Fluxo moderno já existente:**
  - `AttendanceDialog` (Ficha · Evolução · Prescrição · Orçamento · Assinatura) cria **sessões** completas.
  - `PatientClinicalTimeline` (aba "Clínica") = histórico clínico rico.
  - `PatientAnamneseTab` = anamnese **modular** (geral, facial, injetáveis, corporal, capilar, epilação) com PDF, IA e comparação — e ainda absorve os registros legados (`legacyAnamnesis`).

### Respostas
1. **Agregam valor real?** Baixo. Servem hoje mais como listagem global. O valor clínico real está no fluxo por paciente/sessão.
2. **São redundantes com a tela do paciente?** **Sim** — duplicam Prontuário (aba/Clínica) e Anamnese (PatientAnamneseTab) com versões inferiores (URL manual, perguntas fixas).
3. **Melhor A/B/C/D?** → **Recomendação: D) Consolidar** (com fallback C).

### Recomendação técnica
- **Consolidar** o fluxo na tela do paciente: **ocultar** "Prontuário" e "Anamnese" do menu lateral (via flag de config), mantendo as **rotas e endpoints ativos** (retrocompatível/reversível). Opcional: transformar o menu "Prontuário" numa **listagem de leitura** (read-only) que faz deep-link para a Timeline Clínica do paciente.
- **Risco:** baixo se apenas ocultarmos do menu (nada é removido). Médio se refatorarmos para read-only.

---

## 3) TELA DO PACIENTE (`PatientDetail.jsx`)

### Problemas de UX
- **Três visões sobrepostas do histórico:** aba **Timeline** (lista simples de agendamentos), aba **Prontuário** (lista de `medical-records`) e aba **Clínica** (`PatientClinicalTimeline`, rica). Confuso qual é a "oficial".
- **Excesso de abas (7)** → problema de responsividade (R2) e de foco.
- **Aba "Timeline" é rasa** comparada à "Clínica" (que tem evolução, ficha snapshot, fotos, assinaturas forenses, financeiro, recibos, documentos e auditoria de reabertura).
- **Tabela de Documentos** dentro de `overflow-hidden` (corta em telas estreitas).

### Melhorias possíveis
- Tornar **"Clínica/Histórico" a aba principal** (default) e **absorver** Timeline+Prontuário nela.
- Reduzir para ~4-5 abas: **Histórico · Anamnese · Orçamentos · Documentos · Financeiro**.
- Card de perfil (`lg:col-span-1`) já é responsivo (vira 1 coluna) — manter.

### O que pode quebrar
- `data-testid` de abas (`tab-timeline`, `tab-prontuario`) são usados em testes → remoção quebraria testes. **Mitigação:** manter testids/rotas por retrocompatibilidade ou atualizar testes na mesma PR.
- Navegação `openOriginalSession` (Anamnese → aba "clinica") depende do valor `"clinica"` — preservar.

---

## 4) TIMELINE (`PatientClinicalTimeline.jsx`)

### Situação atual
- **Já é a fonte oficial do histórico clínico.** Consome `/patients/{id}/timeline` e mostra por sessão: evolução/observações/protocolo/prescrição, ficha snapshot, fotos antes/depois, assinaturas com metadados forenses (IP, timezone, SHA-256), financeiro + recibos, documentos assinados e **auditoria de reaberturas**. Inclui `legacy_records`.
- Tem export **PDF (Ficha Premium)** e cards de contagem (sessões/concluídas/em andamento/legado).

### O que ainda falta
- **Filtros/busca** (por período, profissional, tipo de evento, status).
- **Paginação / lazy loading** para pacientes com muitas sessões (hoje carrega tudo).
- **Absorver** a aba "Timeline" simples e a aba "Prontuário".

### O que está duplicado / pode ser removido
- Aba **Timeline** (agendamentos) e aba **Prontuário** (medical-records) → duplicam informação já presente aqui.

### O que deve permanecer
- Estrutura por sessão, auditoria de reabertura, metadados forenses de assinatura e o export PDF.

---

## 5) EXPORTAÇÃO

### Situação atual (o que já existe)
| Área | Export existente |
|------|------------------|
| Ficha do paciente | **PDF** (`GET /patients/{id}/ficha-pdf`) |
| Anamnese | **PDF** (`PatientAnamneseTab.downloadPDF`) |
| Documentos | **PDF** (gerados via DocumentGenerator) |
| Financeiro (recibo) / Assinatura (fatura) | **PDF** (anexos por e-mail) |

### O que falta
| Área | Formato ausente |
|------|-----------------|
| **Pacientes** (lista) | CSV / XLSX |
| **Financeiro** (entries + summary/fluxo de caixa) | CSV / XLSX / PDF |
| **Dashboard** (KPIs / gráfico) | CSV / PDF |
| **Prontuário consolidado** | PDF único por paciente |

### Formatos possíveis e impacto técnico
- **CSV:** baixo custo, 100% aditivo (endpoint novo + botão). Backend não tem `openpyxl` ainda mas CSV é nativo.
- **XLSX:** médio (adicionar `openpyxl` ao `requirements.txt`).
- **PDF:** infra já existe (`xhtml2pdf` + `reportlab`), baixo-médio.

---

## PLANO DE IMPLEMENTAÇÃO (por fases)

### FASE A — BAIXO RISCO (aditivo, CSS-only + endpoints novos) · ~10–14h
- A1. `overflow-x-auto` nos `TabsList` (PatientDetail, Documentos, SuperAdmin, DocumentGenerator) — R2/R6. *(1–2h)*
- A2. Wrapper `overflow-x-auto` em todas as tabelas cruas (trocar `overflow-hidden`) — R3. *(1–2h)*
- A3. Tornar `grid-cols-2` responsivos em formulários (`grid-cols-1 sm:grid-cols-2`) — R5. *(1–2h)*
- A4. Auto-collapse do sidebar abaixo de ~1280px — R7. *(1h)*
- A5. **Export CSV** de Pacientes e Financeiro (endpoints novos `/export/...` + botão). *(4–5h)*
- A6. **Ocultar do menu** "Prontuário" e "Anamnese" globais via flag (rotas mantidas). *(1h)*

### FASE B — MÉDIO RISCO (estrutural, requer validação visual) · ~16–22h
- B1. **Agenda responsiva** (R4): `overflow-x-auto` + `min-width` na grade + view "dia" em telas pequenas. *(4–6h)*
- B2. **Sidebar mobile drawer** (R1): hambúrguer + overlay < 1024px. *(4–5h)*
- B3. **Consolidar abas** do paciente: Histórico (unifica Timeline+Prontuário) como principal; reduzir para ~5 abas (mantendo testids/rotas). *(4–6h)*
- B4. **Export XLSX** (add `openpyxl`) e **PDF** de Financeiro/Dashboard. *(4–5h)*

### FASE C — ALTO RISCO (migração de fluxo) · ~16–24h
- C1. **Depreciar/consolidar** os módulos globais Prontuário/Anamnese: transformar em leitura + deep-link, migrar criação para o fluxo por sessão. *(6–8h)*
- C2. **Filtros + paginação/lazy** na Timeline Clínica. *(6–8h)*
- C3. **PDF consolidado de prontuário** por paciente (todas as sessões). *(4–8h)*

---

## GARANTIAS (regra de segurança do Lote 4)
- Todas as correções propostas são **aditivas, retrocompatíveis e reversíveis**.
- Nenhuma proposta remove endpoints, altera schema do MongoDB ou dados existentes na Fase A/B. A Fase C envolve mudança de fluxo e será tratada com aprovação e rollback dedicados.
- Módulos em produção (Agenda, Pacientes, Prontuários, Anamneses, Atendimentos, Financeiro, Timeline, Fichas, Importação, Assinaturas QR, Upload, Dashboard, IA, Comissões, Documentos, Orçamentos, Receitas, Prescrições, Relatórios, RBAC, Auth) **não sofrem regressão** nas Fases A/B.

---

**STATUS: AGUARDANDO SUA APROVAÇÃO. Nenhuma implementação, teste automático (Playwright/testing agent), migração ou alteração de schema será executada sem sua autorização explícita — fase a fase.**

---

## STATUS DE EXECUÇÃO

### ✅ FASE A — CONCLUÍDA (aprovada e implementada)
- A1 scroll horizontal nos TabsList · A2 tabelas roláveis · A3 formulários responsivos · A4 auto-collapse do sidebar (<1280px) · A5 export CSV (Pacientes/Financeiro) · A6 Prontuário/Anamnese ocultos do menu (rotas mantidas).

### ✅ FASE B — CONCLUÍDA (aprovada e implementada)
- B1 Agenda responsiva (scroll horizontal + largura mínima nas duas visões).
- B2 Drawer mobile do sidebar (<1024px) com hambúrguer + overlay.
- B3 Abas do paciente consolidadas: "Histórico" (timeline clínica) é a principal; abas redundantes "Timeline" e "Prontuário" removidas para usuários clínicos (recepção mantém Timeline de agendamentos). Rotas/testids preservados.
- B4 Export XLSX + PDF (Financeiro) e XLSX (Pacientes) com menu de formato (CSV/Excel/PDF).

Verificação: backend validado via curl (200/content-type corretos); frontend validado via screenshots (desktop + mobile). Testing agent NÃO executado (conforme instrução do usuário).

### ⏳ FASE C — PENDENTE DE APROVAÇÃO
- C1 depreciar/consolidar módulos globais Prontuário/Anamnese · C2 filtros + paginação/lazy na Timeline · C3 PDF consolidado de prontuário.
