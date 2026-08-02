# FASE 5 — REESTRUTURAÇÃO ARQUITETURAL DO PROCLINIC

> **Escopo:** documento arquitetural + quick-wins de performance + preparação de arquitetura para comissões. Refatorações estruturais grandes (split de arquivos, unificação de coleções) serão executadas em ondas subsequentes com plano detalhado abaixo.
> **Regra:** NÃO alterar comportamento funcional. Zero regressões.

---

## 1. ARQUITETURA ATUAL (Fev/2026)

### 1.1 Backend
- **`/app/backend/server.py`** — arquivo único de **~4860 linhas** contendo:
  - Autenticação (JWT + bcrypt + Google Auth)
  - RBAC (`admin | financeiro | recepcao | profissional | marketing | super_admin | paciente`)
  - 12 coleções MongoDB ativas
  - ~120 endpoints em ~20 domínios lógicos
  - PDF generation (xhtml2pdf), Object Storage, Resend (emails com tracking), Asaas (pagamentos), IA (Claude 4.5)

### 1.2 Frontend
- **`AttendanceDialog.jsx`** — **~750 linhas**, 15 useState + 2 useRef, sem `useMemo`/`useCallback`, orquestra 5 abas + IA + assinaturas + orçamento + finalize.
- **`Financeiro.jsx`, `Agenda.jsx`, `PatientDetail.jsx`, `SuperAdmin.jsx`** — todas com mais de 300 linhas.

### 1.3 Coleções Ativas
`users, patients, clinics, appointments, attendance_sessions, medical_records, anamnesis, anamnesis_modules, procedures, budgets, financial_entries, receipt_counters, session_counters, files, ai_messages, ai_generations, plans, subscriptions, payments, invoices, coupons, webhook_events, email_logs, mobile_upload_tokens, documents, document_templates, messages, notifications`

### 1.4 Débitos Técnicos Identificados nas Auditorias Anteriores
| # | Débito | Severidade | Impacto |
| --- | --- | --- | --- |
| 1 | `server.py` monolítico (~4860 linhas) | 🟠 Alta | Difícil de navegar, testar isoladamente, colaborar em paralelo |
| 2 | `AttendanceDialog` com 15 useState em um componente | 🟠 Alta | Re-renders em cascata, difícil de testar UI isoladamente |
| 3 | `anamnesis` vs `anamnesis_modules` — dois sistemas paralelos | 🟠 Alta | Confusão semântica, duplicação de esforço |
| 4 | Sem `useMemo`/`useCallback` em componentes pesados | 🟡 Média | Re-renders desnecessários em `FichaForm`, `BudgetEditor` |
| 5 | Finalize sem transação MongoDB atômica | 🟡 Média | Já mitigado por lock `finalizing`, mas falha parcial pode inconsistir |
| 6 | Sem locks para concorrência entre profissionais | 🟢 Baixa | 2 profissionais podem editar mesma sessão (raro na prática) |
| 7 | Sem WebSocket — status "em_atendimento" só via reload | 🟢 Baixa | UX degradada, mas funcional |
| 8 | Sem módulo de comissões | 🟢 Baixa | Feature ausente, dados já disponíveis (professional_id em financial_entries) |
| 9 | Rate-limit ausente em `/ai/generate` | 🟠 Alta (financeiro) | Consumo malicioso da EMERGENT_LLM_KEY |

---

## 2. ARQUITETURA PROPOSTA

### 2.1 Backend — Modularização em Routers
```
/app/backend/
  server.py                    # apenas init FastAPI + include_router + startup/shutdown
  config.py                    # env vars centralizadas
  db.py                        # motor client + get_db + índices
  security.py                  # JWT, bcrypt, get_current_user, RBAC helpers
  models/
    __init__.py
    users.py                   # UserIn/Out, LoginIn, RegisterIn
    patients.py
    appointments.py
    attendance.py
    finance.py
    budgets.py
    ai.py
    subscriptions.py
    documents.py
    ...
  routers/
    auth.py                    # /auth/*
    patients.py                # /patients/*
    appointments.py            # /appointments/*
    attendance.py              # /attendance/* + /attendance/{sid}/sign + /finalize
    medical_records.py         # /medical-records/* + /patients/{id}/timeline
    finance.py                 # /finance/* + /finance/entries/{id}/receipt/*
    budgets.py                 # /budgets/* + /public/budgets/*
    ai.py                      # /ai/generate + /ai/chat + /ai/generations
    subscriptions.py           # /plans + /checkout + /subscriptions + /webhooks/asaas
    documents.py               # /documents + /document-templates
    files.py                   # /uploads + /files + /mobile-upload
    super_admin.py             # /super-admin/* + /admin/*
    dashboard.py               # /dashboard/stats
    messages.py                # /messages
    notifications.py           # /notifications
    email_tracking.py          # /email-tracking/*
  services/
    receipts.py                # _build_receipt_pdf, _next_receipt_number, _generate_receipt_for_entry
    finance.py                 # helper de gerar entries + parcelas + finalize
    ai_context.py              # _build_patient_ai_context
    email.py                   # send_email, _email_shell, tracking
    storage.py                 # put_object, get_object, make_file_signature
    pdf.py                     # helpers de geração PDF (invoice, receipt, document)
  tests/
    (existente)
```

### 2.2 Frontend — Split do `AttendanceDialog`
```
/app/frontend/src/components/
  AttendanceDialog.jsx              # ~180 linhas — orquestrador (loading/completion/inProgress) + contexto
  attendance/
    AttendanceContext.jsx           # Provider com session, patient, autosave, callAi (memoizados)
    AttendanceSmartHeader.jsx       # ~100 linhas — Smart Header + Progress + Alerts (React.memo)
    AttendanceFooter.jsx            # ~60 linhas — botões + financial preview
    tabs/
      TabFicha.jsx                  # wrapper de FichaForm + module selector
      TabEvolucao.jsx               # observations + evolution + IA toolbar + fotos
      TabPrescricao.jsx             # prescriptions textarea
      TabOrcamento.jsx              # embed BudgetEditor
      TabAssinatura.jsx             # 2 SignaturePads com captureSignature
    ai/
      AiToolbar.jsx                 # botões IA + mode selector + banner contraindicações
    hooks/
      useAttendanceSession.js       # session state + autosave com AbortController + opId
      useAttendanceProgress.js      # cálculo memoizado de progresso e alertas
```

### 2.3 Coleções — Unificação `anamnesis` + `anamnesis_modules`
**Proposta:** manter `anamnesis_modules` (schema mais rico) como fonte de verdade; deprecar `anamnesis` legado.

Etapas:
1. Adicionar campo `template_name` em `anamnesis_modules` (aditivo).
2. Adicionar campo `signature` + `signed` em `anamnesis_modules` (aditivo).
3. Backend: `POST /api/anamnesis` (endpoint legado) grava também em `anamnesis_modules` (double-write).
4. Executar migração idempotente: `for doc in anamnesis: upsert em anamnesis_modules`.
5. Após validação em produção, marcar `anamnesis` como read-only.
6. Fase futura: remover endpoint legado após 90 dias sem uso.

### 2.4 Transações e Locks

**Onde aplicar transação atômica:**
- `finalize_attendance` — MongoDB session/transaction cobrindo: `medical_records.insert` + `attendance_sessions.update` + `appointments.update` + N × `financial_entries.insert` + budget update.
- Requer replica set (Cloud MongoDB Atlas já é replica set — OK).

**Lock de concorrência:**
- Coleção nova `session_locks {session_id, user_id, expires_at, heartbeat}` com TTL index.
- Frontend: heartbeat a cada 20s enquanto o AttendanceDialog está aberto.
- Backend: `POST /attendance/{sid}/heartbeat` renova; `GET /attendance/{sid}/lock` retorna lock atual.
- Se outro user tenta abrir uma session em lock, recebe `409 Conflict` com metadata do dono atual.

### 2.5 WebSocket (Preparação de Infra)

**Propósito:** notificar em tempo real quando sessions mudam status, appointments são criados/movidos, ou receitas são pagas.

**Arquitetura mínima proposta:**
- Endpoint `/ws?token=<jwt>` — canal por `clinic_id`.
- Eventos: `attendance.started`, `attendance.finalized`, `appointment.created`, `financial.paid`, `notification.new`.
- Consumo: `Agenda.jsx` re-fetch parcial; `Dashboard.jsx` atualiza KPIs sem reload; ícone de notificação global.
- Fallback: polling a cada 60s se WS desconectado.
- Backend: FastAPI já suporta `WebSocket` nativo (não requer lib extra).

### 2.6 Comissões — Preparação de Arquitetura

**Aditivo (sem regras ativas):**
- `procedures.commission_percent: float = 0` (aditivo, opcional).
- `users.default_commission_percent: float = 0` (aditivo, opcional).
- `financial_entries.commission_amount: float = None` (aditivo, opcional).
- `financial_entries.commission_status: Optional[Literal["pendente", "paga", "cancelada"]] = None`.
- Nova coleção prevista: `commission_payouts` — pagamentos consolidados por profissional/mês.

**Não implementar ainda:** cálculo automático, UI de config, relatórios.

**Vantagem:** quando o módulo for ativado, todos os `financial_entries` já contêm `professional_id` (Fase 2.5D) e `session_id` (Fase 2.5E) — cálculo retroativo é possível.

### 2.7 Performance — Memoização

**AttendanceDialog** — aplicar:
- `useCallback` em: `autosave`, `setSessionField`, `captureSignature`, `callAi`, `generateEvolution`, `suggestProtocol`, `checkContraindications`, `generateSessionSummary`, `finalize`, `confirmFinalize`, `savePatient`, `applyAiResult`.
- `useMemo` em: `progressSteps`, `progressPct`, `alerts`, `patientAge`, `financialPreviewTotal`.
- `React.memo` em: `PatientFinanceTab`, `PatientClinicalTimeline`, `SmartHeader` (a extrair).

**Ganho estimado:** 30-50% menos re-renders em interações de digitação (autosave dispara setSession → cada child recebe nova ref de handler → re-render).

---

## 3. PLANO DE MIGRAÇÃO (5 ONDAS)

| Onda | Escopo | Risco | Rollback |
| --- | --- | --- | --- |
| **A** | Memoização do frontend + preparação schema comissões (aditivo) | 🟢 Baixo | Reverter commits — schemas são opcionais |
| **B** | Split do AttendanceDialog em sub-componentes com Provider | 🟡 Médio | Manter branch feature/ separado, cutover atômico |
| **C** | Split do server.py em routers (paralelo, arquivo por arquivo) | 🟠 Alto | Manter `server.py` original como fallback via git tag `v2.4-monolith` |
| **D** | Transações MongoDB no finalize + locks de sessão | 🟠 Alto | Feature flag `ATOMIC_FINALIZE=false` desativa |
| **E** | Unificação anamnesis (double-write + migration) + WebSocket + comissões | 🟠 Alto | Double-write permite reverter para leitura legada |

Cada onda com **testing_agent** obrigatório antes de mergear.

---

## 4. PLANO DE ROLLBACK

### 4.1 Estratégia Geral
1. **Git tag por onda** — antes de cada onda, criar tag `pre-fase-5-onda-{X}`.
2. **Feature flags** — no `.env`, `FASE5_ATOMIC=true|false`, `FASE5_LOCKS=true|false`, `FASE5_WS=true|false`.
3. **Double-write** em migrações de coleção — o código antigo continua escrevendo enquanto o novo lê/escreve o novo formato. Rollback = desligar feature flag.
4. **Índices sparse** em campos novos — permite queries antigas continuarem funcionando.

### 4.2 Cenário de Rollback por Onda
- **Onda A:** commit revert ou toggle memoização (não afeta dados).
- **Onda B:** cutover atômico — se falhar, reverter para `AttendanceDialog.jsx` monolítico via git.
- **Onda C:** cada router extraído é opt-in — remover include_router do server.py restaura tudo.
- **Onda D:** feature flag desliga transações; lock TTL expira naturalmente.
- **Onda E:** double-write mantém dados válidos em ambas as coleções → basta ler da antiga.

### 4.3 Testes de Regressão Obrigatórios
- `iteration_12/13/14/15/16/17.json` — todos os 250+ testes existentes devem continuar verdes após cada onda.
- Novos testes por onda: mínimo 15 casos + smoke test frontend com screenshot.

---

## 5. QUICK-WINS EXECUTADOS NESTA FASE (Onda A)

Implementados nesta sessão sem alteração de comportamento:

### 5.1 Memoização no `AttendanceDialog`
- `useCallback` em todos os handlers principais.
- `useMemo` em `progressSteps`, `progressPct`, `alerts`, `patientAge`, `financialPreviewTotal`.
- Redução esperada de re-renders em ~40%.

### 5.2 Preparação de Comissões (aditivo, sem regras)
- `ProcedureIn.commission_percent: Optional[float] = 0` — porcentagem padrão do procedimento.
- `UserIn.default_commission_percent: Optional[float] = 0` — % base do profissional.
- `FinancialEntryIn.commission_amount: Optional[float] = None`
- `FinancialEntryIn.commission_status: Optional[Literal["pendente","paga","cancelada"]] = None`
- Nenhum cálculo ativo — apenas schema.

### 5.3 Documento arquitetural completo
- Este próprio arquivo: `/app/memory/REFATORACAO_FASE_5.md`

---

## 6. ARQUIVOS AFETADOS NESTA ONDA (Onda A)

| Arquivo | Alteração | Tipo |
| --- | --- | --- |
| `/app/memory/REFATORACAO_FASE_5.md` | Criado | Docs |
| `/app/frontend/src/components/AttendanceDialog.jsx` | Memoização adicionada | Perf |
| `/app/backend/server.py` | Campos opcionais adicionados em ProcedureIn/UserIn/FinancialEntryIn | Aditivo |
| `/app/memory/PRD.md` | Atualização com Fase 5 Onda A | Docs |

---

## 7. RISCOS REMANESCENTES (após Onda A)

1. Modularização do backend (Onda C) ainda pendente — server.py continua monolítico.
2. Split do AttendanceDialog (Onda B) pendente — componente ainda tem 750 linhas.
3. Transações atômicas (Onda D) pendentes.
4. WebSocket infra (Onda E) pendente.
5. Regras de cálculo de comissão pendentes (apenas schema pronto).

**Todas as pendências têm plano definido nas seções 2 e 3.**

---

**Fim do documento — Fase 5 Onda A — Fev/2026.**
