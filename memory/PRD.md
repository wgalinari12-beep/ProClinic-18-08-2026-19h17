# ProClinic — PRD

## Visão geral
**ProClinic** — SaaS multi-tenant para clínicas de estética e clínicas médicas, design "Luxury Medical Minimalism".

## Stack
- **Frontend:** React 19, React Router 7, Tailwind, Shadcn UI, Recharts, lucide-react, @dnd-kit, react-signature-canvas, qrcode.react
- **Backend:** FastAPI + Motor (MongoDB async), Emergent Object Storage (signed URLs), xhtml2pdf, markdown, httpx
- **IA:** Claude Sonnet 4.5 (Emergent LLM Key)
- **Pagamentos:** Asaas (PIX + Boleto + Cartão + Subscriptions recorrentes + Webhooks)
- **Auth:** JWT (email OU CPF) + Google OAuth + RBAC (admin/profissional/recepcao/financeiro/marketing)

## What's been implemented

### Fase 1 — MVP
Auth, Dashboard, Pacientes, Agenda v1, Prontuário, Anamnese, Financeiro, IA, Sidebar, tema light/dark.

### Fase 2
Agenda drag-drop, Atendimento clínico + cronômetro, 4 Fichas premium, Object Storage, Assinatura touch, IA clínica, Mensagens.

### Fase 2.1
Auto-IMC, fotos por ficha, QR mobile capture, Procedimentos CRUD, portal público confirmação, Minha Clínica.

### Fase 2.2A — RBAC + Photo Bug fix
Signed URLs (?sig=), Login email OU CPF, RBAC, Segregação de prontuário, CRUD Equipe, ChangePasswordModal forçado, Agenda colorida, Lightbox premium.

### Fase 2.2B — Orçamento + Financeiro auto + Visão por Profissional
Módulo Orçamento com link público `/orcamento/:token`, financeiro auto na conclusão do atendimento (pago/parcial/não), agenda toggle Por profissional.

### Fase 2.3A — Documentos Jurídicos
Biblioteca de modelos com 16 variáveis dinâmicas, editor markdown + preview, dupla assinatura (canvas + QR mobile), PDF via xhtml2pdf com QR de validação, sigilo profissional, auditoria completa, rotas públicas.

### Fase 2.4A — Assinaturas & Pagamentos (Jul/2026)
- ✅ Integração Asaas sandbox: customer + subscription (PIX/Boleto/Cartão) + webhooks.
- ✅ 3 planos com 20% off no anual, trial 7d + read-only 3d, feature gating.
- ✅ Endpoints checkout/cancel/change-plan/payments; webhooks idempotentes.
- ✅ Frontend: /planos, /checkout, /minha-assinatura, TrialBanner global.
- ✅ Backend tests: 20/20.

### Fase 2.4B — Super-admin + Cupons + Faturas + Emails (Jul/2026)
- ✅ **Role `super_admin`** com dashboard `/super-admin` (MRR/ARR/churn/inadimplência + lista de clínicas + KPIs cross-tenant).
- ✅ **Cupons de desconto** — CRUD por super-admin, campo `coupon_code` no /checkout, validador `/coupons/validate/{code}?plan_key=`, aplicação 1º pagamento (via Asaas `discount` block) ou recorrente (valor reduzido).
- ✅ **Fatura em PDF** gerada automaticamente no webhook PAYMENT_CONFIRMED (xhtml2pdf), armazenada em Object Storage com signed URL, disponível em /minha-assinatura + endpoint `/api/invoices`.
- ✅ **Integração Resend** com idempotência (`email_logs`) + 4 emails automáticos.
- ✅ **Route guards**, `Field(ge=0)` + validator para percent≤100; webhook exige `event.id`; unique index em coupons/webhook_events/email_logs.
- ✅ **Backend tests**: 24/24.

### Fase 2.4C — Templates premium + Onboarding + Tracking (Jul/2026)
- ✅ **Template HTML premium** para todos os emails — usa `clinic.logo_url` + `clinic.primary_color`, tipografia Georgia, botão pill, suporte a dark mode via `@media (prefers-color-scheme)`.
- ✅ **Sequência de onboarding** 4 emails ao longo dos 7 dias de trial (welcome D1, features D3, social proof D5, expiring D6). Cron `trial_check_loop` roda 1h e dispara nos milestones.
- ✅ **Tracking de abertura** via pixel GIF 1x1 (`/api/email-tracking/open/{email_id}.png`) — incrementa `opened_at` + `open_count`.
- ✅ **Tracking de cliques** via wrapper redirect (`/api/email-tracking/click/{email_id}?u=...`) com safety (só http/https).
- ✅ **Aba "Emails" no /super-admin** com tabela de logs (data, para, assunto, status, abertura, cliques) — endpoint `/api/super-admin/email-logs`.
- ✅ **Cor primária configurável** na página /minha-clinica (input type=color) + persistência em `clinics.primary_color` com validação `pattern=^#[0-9a-fA-F]{6}$`.
- ✅ **Backend tests**: 42/42 (18 novos 2.4C + 24 regressão 2.4B, 1 skipped).
- ✅ **Polimento pós-teste**: hex validation em `primary_color`, `FRONTEND_URL` alinhado ao host público.

### Fase 2.5A+B — Ecossistema Financeiro: Fundação + Parcelamento (Fev/2026)
- ✅ **Auditoria completa** salva em `/app/memory/AUDITORIA_FINANCEIRO.md` (endpoint por endpoint + schemas + fluxos + RBAC + gaps).
- ✅ **RBAC no backend** — helpers `require_finance_read` (admin/financeiro/recepcao/super_admin) e `require_finance_write` (admin/financeiro) aplicados em GET/POST/PUT/DELETE `/api/finance/*`. Profissional/marketing agora bloqueados (403).
- ✅ **PUT não-destrutivo** — `FinancialEntryPatch` com `exclude_unset=True` + `$set` seletivo; `paid_at` gerenciado automaticamente (preenchido quando `paid→true`, limpo quando `paid→false`).
- ✅ **Schema `FinancialEntryIn` estendido** aditivamente: `procedure_id`, `professional_id`, `cost_center`, `notes`, `installment_group_id`, `installment_number`, `installment_total`. Defaults preservam legacy docs.
- ✅ **Filtros avançados** em GET `/api/finance/entries`: `?type=`, `?paid=`, `?patient_id=`, `?date_from=`, `?date_to=`, `?installment_group_id=`, `?search=`, `?limit=`.
- ✅ **Parcelamento inteligente** em `POST /api/attendance/{sid}/finalize` — aceita `installments` (1..48) + `installment_interval_days`; gera N entries com mesmo `installment_group_id`, `installment_number` (1..N), vencimentos escalonados, valor dividido com centavo residual na última parcela.
- ✅ **Enrichment automático** — `procedure_id` e `professional_id` copiados do appointment/session no finalize.
- ✅ **Fluxo orçamento público** — `sign_public_budget` agora marca `pending_charge_generation=true` (clínica revisa antes de gerar cobranças) e **não** cria financial_entries automaticamente.
- ✅ **Novo endpoint** `POST /api/budgets/{budget_id}/generate-charges` — gera N parcelas do orçamento aprovado, idempotente por `budget_id`.
- ✅ **Índices MongoDB** em `financial_entries`: `entry_id` unique, `(clinic_id, due_date)`, `(clinic_id, patient_id)`, `(clinic_id, paid, type)`, `(clinic_id, installment_group_id)`, `(clinic_id, budget_id)`.
- ✅ **Frontend `CompletePaymentDialog`** — bloco de parcelas com nº parcelas + intervalo (dias) + preview "6x de R$ 200,00 a cada 30 dias".
- ✅ **Frontend `Financeiro.jsx`** — `togglePaid` agora envia apenas `{paid}` (não destrói campos internos).
- ✅ **Backend tests**: 23/23 novos, 0 regressões. Cobertura RBAC + PATCH + filtros + parcelamento (pago/parcial/nao_pago) + generate-charges idempotente.

### Fase 2.5C — Aba Financeiro Paciente + Recibos PDF Sequenciais (Fev/2026)
- ✅ **Endpoint `/api/finance/patient/{patient_id}/summary`** — retorna KPIs (`total_pago`, `total_pendente`, `total_vencido`, `proximo_vencimento`) + entries ordenadas.
- ✅ **Recibos PDF sequenciais** `REC-YYYY-####` — numeração atômica por (clinic_id, year) via `find_one_and_update` + `ReturnDocument.AFTER`. Coleção `receipt_counters` com índice unique.
- ✅ **Auto-geração de recibo** em 3 pontos: POST `/finance/entries` (create com `paid=true`+`receita`), PUT `/finance/entries/{id}` (transição `paid=false→true`), `POST /attendance/{sid}/finalize` (para entries pagas criadas no finalize).
- ✅ **Idempotência** — recibo só gerado uma vez; endpoint `POST /finance/entries/{id}/receipt` retorna existente sem duplicar; `?force=true` regenera.
- ✅ **Endpoint email** `POST /finance/entries/{id}/receipt/email` — usa email do paciente por default, aceita `{email}` no body para custom; anexa PDF via base64; idempotente via Resend + `email_logs`.
- ✅ **Endpoint WhatsApp** `GET /finance/entries/{id}/receipt/whatsapp-link` — retorna `wa.me/{phone}?text=...` com mensagem pronta + URL do PDF. Prefixa `55` automaticamente em números BR sem código do país. Sem depender de Evolution API.
- ✅ **PDF de recibo** — layout premium com brand primary color, dados do paciente, descrição, forma de pagamento, valor destacado, "✓ Pagamento confirmado", rodapé com CNPJ e endereço da clínica.
- ✅ **Frontend `PatientFinanceTab.jsx`** — novo componente (306 linhas) com 4 KPI cards, tabela responsiva, ações inline (Marcar pago / Recibo / Email / WhatsApp), row destacada quando vencida, dialog de custom email.
- ✅ **`PatientDetail.jsx`** — nova aba "Financeiro" (visível para admin/financeiro/recepcao).
- ✅ **Índices adicionais**: `(clinic_id, receipt_number)` sparse, `receipt_counters(clinic_id, year)` unique.
- ✅ **Backend tests**: 26/26 pass (auto-gen, sequência atômica, idempotência, email default+custom, WhatsApp BR prefix, RBAC, patient summary, regressão dashboard/summary/filters/PUT não-destrutivo).

### Fase 2.5D — Correção Estrutural do Módulo de Atendimento (Fev/2026)
Correção de 4 riscos críticos identificados na auditoria. Todas as mudanças **aditivas**, sem quebrar nada.

- ✅ **P1 Idempotência do `finalize_attendance`** — segundo POST no mesmo `session_id` retorna o resultado cacheado em `attendance_sessions.finalized_result` sem duplicar prontuários/entries/recibos. Lock via campo `finalizing` bloqueia requisições paralelas. Try/except libera lock em caso de erro.
- ✅ **P2 Status `em_atendimento`** — `/attendance/start` agora seta `appointment.status="em_atendimento"` + `attendance_started_at` + `attendance_started_by`. `/finalize` completa com `finished_at` + `finished_by` + `duration_minutes`.
- ✅ **P3 `session_id` + `session_number`** — `medical_records` agora carrega: `session_id` (FK à sessão), `session_number` no formato `ATT-YYYY-######` (contador atômico `session_counters` por clínica+ano, sequencial), `appointment_id`, `professional_id`, `procedure_id` e `consent_signature` (que antes era perdido).
- ✅ **P4 `procedure_id` no appointment** — `Agenda.jsx` passa `procedure_id` do dropdown de procedures ao criar novo appointment. Legacy sem `procedure_id` continua funcionando.
- ✅ **Frontend `AttendanceDialog`** — `confirmFinalize` com trap `if (busy) return` contra double-click.
- ✅ **Índices adicionais** — `session_counters(clinic_id, year)` unique, `attendance_sessions.session_id` unique, `medical_records(clinic_id, session_id)` sparse, `medical_records(clinic_id, patient_id)`.
- ✅ **Backend tests**: 21/21 novos (test_phase2_5d_attendance.py) + 49/49 regressão fases 2.5A/B/C.

### Fase 2.5E — Hardening e Integridade Operacional (Fev/2026)
Correções 4-7 do plano de hardening (correções 1-3 já validadas na 2.5D). Todas aditivas.

- ✅ **C3+ `session_id` também em `financial_entries`** — entries geradas no finalize (incluindo todas as parcelas do mesmo grupo) carregam `session_id` + `session_number` para rastreabilidade completa. Novo índice `financial_entries(clinic_id, session_id)` sparse.
- ✅ **C4/C5 — Metadados forenses de assinatura** — novo endpoint `POST /api/attendance/{sid}/sign` com payload `{type: 'consent'|'evolution', signature, timezone}`. Persiste em `consent_signature_meta` / `evolution_signature_meta`: `signed_at` (server-side UTC), `signed_by`, `signed_by_name`, `timezone` (client-side), `ip` (X-Forwarded-For → fallback request.client.host), `session_id`, `appointment_id`, `patient_id`, `sha256` do base64 da assinatura. Validação: 400 em type/signature inválidos, 404 em session inexistente, 403 para recepção.
- ✅ **C4 — TCLE preservado no prontuário** — no `finalize`, `consent_signature` + `consent_signature_meta` + `evolution_signature_meta` copiados para `medical_records`. Antes o TCLE era descartado.
- ✅ **C6 — Código morto removido** — bloco `stage="done"` do `AttendanceDialog.jsx` deletado + imports órfãos (`Save`, `X` do lucide-react).
- ✅ **C7 — Autosave sem race conditions** — `AbortController` cancela requisição em vôo antes de disparar nova; `client_op_id` guard descarta respostas fora de ordem que sobrescreveriam estado mais novo; identity fields (`appointment_id`, `patient_id`) são imutáveis no PUT (pop server-side).
- ✅ **Frontend `AttendanceDialog`** — `captureSignature(type, base64)` usa o novo endpoint `/sign` para persistir com metadata; fallback para autosave em caso de falha.
- ✅ **Backend tests**: 32/32 novos (test_phase2_5e_sign.py) + 21/21 regressão 2.5D. Total: 53/53 verdes.

### Fase 2 — Integridade Clínica e Prontuário (Fev/2026)
- ✅ **`ficha_snapshot` no `medical_records`** — no `finalize_attendance`, snapshot dos `anamnesis_modules` (geral/facial/corporal/capilar) do paciente é copiado para o prontuário com `answers`, `photos`, `captured_at`. Filtro `created_by=user_id` para `role=profissional` (isolamento entre profissionais); admin/financeiro captam todos. Snapshot vazio = `{}`.
- ✅ **Novo endpoint** `GET /api/patients/{patient_id}/timeline` — timeline clínica consolidada retornando: `{patient, sessions[], legacy_records[], counts}`. Cada sessão traz: `session_id`, `session_number ATT-YYYY-######`, `appointment`, `medical_record`, `ficha_snapshot`, `budget`, `financial_entries[]`, `receipts[]`, `signed_documents[]`, `signatures{consent, evolution, consent_meta, evolution_meta}`. RBAC: profissional só vê sessões próprias (`started_by=user_id`); admin vê todas; recepção 403 (dados clínicos).
- ✅ **Sessões em vôo** (`status=rascunho`) aparecem na timeline com `medical_record=null` e `ficha_snapshot` puxado dos `anamnesis_modules` atuais (não do record).
- ✅ **Legacy records** (medical_records sem session_id, criados manualmente ou antes da Fase 2.5D) agrupados em `legacy_records[]` separado.
- ✅ **Frontend `PatientClinicalTimeline.jsx`** — nova aba "Clínica" em `PatientDetail.jsx`. UI premium com 4 KPIs (sessões/concluídas/em andamento/legado), timeline vertical com dot indicators, sessões expansíveis mostrando: evolução clínica, snapshot da ficha por módulo, fotos antes/depois em grid, assinaturas com metadata forense completa (SHA256, IP, timezone), tabela de parcelas com badges de status, documentos assinados linkados.
- ✅ **Backend tests**: 18/18 novos (test_phase2_integridade_clinica.py) + 53/53 regressão (2.5D + 2.5E) = **71/71 pass**.

### Fase 3 — Experiência Premium de Atendimento (Fev/2026)
UX/UI puro no `AttendanceDialog` — zero mudança em backend/APIs/regras clínicas/persistência.

- ✅ **Smart Header** — banner abaixo do title com avatar do paciente (ou inicial), nome + idade calculada + gender, último atendimento (via `/timeline`), status financeiro (pendente + vencido em atraso destacado), chips vermelhos de "Alergia" (com tooltip do texto) e chips azuis de "Medicações" (com tooltip).
- ✅ **Barra de progresso 6 etapas** — Ficha / Fotos / Evolução / Assinatura / Orçamento / Finalização — pills com checkmarks quando concluídos + barra de gradient primary→success mostrando % de conclusão.
- ✅ **Alertas contextuais** — banner de chips destacando o que precisa atenção: alergia, medicações, assinatura ausente, foto ausente, cobranças vencidas do paciente (níveis danger/warn/info com cores distintas).
- ✅ **Financial Preview inline** — mini-card no footer ao lado do botão Concluir mostrando **Total a lançar R$ X.XXX** + chip com nº de parcelas se aplicável — visível antes de abrir o CompletePaymentDialog.
- ✅ **Preview de Recibo pós-finalize** — toast com action button "Abrir" que abre o PDF do primeiro recibo gerado em nova aba.
- ✅ **Responsividade** — dialog agora `max-w-5xl w-[95vw]` (antes max-w-4xl), aproveitando melhor telas desktop/ultrawide sem quebrar em mobile.
- ✅ **Fetches novos aditivos** — `GET /finance/patient/{id}/summary` e `GET /patients/{id}/timeline` chamados no load do dialog (já existiam desde 2.5C e Fase 2).

**Testado visualmente** com screenshot: header renderiza "Wellynghton · 37 anos · ⚠ Alergia" + progresso 0% + 3 alertas contextuais + footer com "TOTAL A LANÇAR R$ 800,00". Nenhum lint error.

## P0 backlog — Próximas fases
- **Modularizar `server.py`** (~4748 linhas) em routers por domínio.
- **Cash flow 30/60/90/180 dias** + DRE simplificado.
- **Módulo de comissões** por profissional (dados já persistidos em financial_entries).
- **Dossiê PDF único** por sessão consolidando TCLE + evolução + recibo + orçamento.
- **Paginação** no endpoint `/timeline`.

## P0 backlog — Fase 2.3B / paralelo
- Import DOCX + PDF como modelos.
- Relatórios de auditoria com filtros.
- Feedback realtime QR sign.

## P0 backlog — Fase 2.2C / paralelo
- WhatsApp Evolution API real (aguardando credenciais).
- Refactor `server.py` (~3900 linhas) em routers por domínio.

## P1 backlog
- DOC_PUBLIC_SECRET separado do JWT_SECRET.
- Sanitização do markdown de templates.
- Validação pública com iniciais (LGPD).
- PLAN_FEATURES lido do banco.
- Fallback de retry Asaas com backoff.
- Resize de duração na agenda.
- Drawer mobile AttendanceDialog.

## P2 backlog
- ICP Brasil + carimbo de tempo.
- 2FA + biometria mobile.
- White label multi-clínica.
- PWA / mobile nativo.
- Cleanup TEST_ data acumulado.

## Credenciais teste
Ver `/app/memory/test_credentials.md`
