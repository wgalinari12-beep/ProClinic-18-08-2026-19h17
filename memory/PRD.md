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

### Fase 4 — IA Clínica Avançada (Fev/2026)
IA contextual + logs auditáveis. Backward compatível: types antigos continuam idênticos.

- ✅ **Contexto rico** — helper `_build_patient_ai_context()` injeta no prompt: nome, idade calculada, gênero, ALERGIAS (destacadas), medicações em uso, notas do cadastro, últimos 3 `medical_records` (excluindo sessão atual), ficha atual (`anamnesis_modules` com respostas top-6).
- ✅ **Novos types**: `contraindications` (análise de red flags entre allergies × procedimento planejado), `improve` (melhoria de texto mantendo significado clínico), `rewrite` (linguagem clínica formal).
- ✅ **Parâmetros novos**: `session_id` (rastreabilidade), `mode` (append/replace/improve/rewrite — hint frontend), `current_text` (para improve/rewrite).
- ✅ **Coleção `ai_generations`** — log de auditoria com `generation_id`, `clinic_id`, `user_id`, `user_name`, `type`, `mode`, `patient_id`, `session_id`, `prompt` (8000 chars), `response` (8000 chars), `model`, `created_at`. Índices em `(clinic_id, patient_id, created_at desc)` e `(clinic_id, session_id)`.
- ✅ **Novo endpoint** `GET /api/ai/generations?patient_id=&session_id=&limit=` — histórico de gerações. RBAC: profissional só vê próprias, admin vê todas.
- ✅ **Frontend `AttendanceDialog`** — toolbar IA contextual na aba Evolução: banner destaca "IA Clínica contextual considera paciente + histórico + ficha", **mode selector** (Anexar/Substituir/Melhorar/Reescrever), botões Evolução IA · Protocolo · Contraindicações · Resumo da sessão, banner de alerta amarelo quando IA retorna contraindicações.
- ✅ **Backend tests**: 26/26 novos (`test_phase4_ai.py`, 117s total) — cobrindo backward compat, novos types, contexto enriquecido inspecionado via /ai/generations, RBAC, robustez, concorrência (3 chamadas paralelas → 3 generation_ids distintos).

### Fase 5 Onda A — Reestruturação Arquitetural (parte 1) (Fev/2026)
Documento arquitetural + quick-wins de performance + preparação aditiva de comissões. Zero mudança funcional.

- ✅ **Documento arquitetural completo** — `/app/memory/REFATORACAO_FASE_5.md` (300 linhas): arquitetura atual, proposta, 5 ondas de migração, plano de rollback, débitos identificados, arquivos afetados. Plano prevê: modularização de `server.py` em routers (Onda C), split de `AttendanceDialog` em subcomponentes/context (Onda B), transações MongoDB + locks (Onda D), unificação `anamnesis + anamnesis_modules` + WebSocket + comissões ativas (Onda E).
- ✅ **Memoização no `AttendanceDialog`** — `useCallback` importado; `useMemo` aplicado a `patientAge`, `progressSteps`, `progressPct`, `alerts`, `financialPreviewTotal`. Redução esperada de ~40% de re-renders em digitação/autosave.
- ✅ **Arquitetura de comissões (aditivo, sem regras)** — novos campos opcionais schema-only:
  - `ProcedureIn.commission_percent: Optional[float] = 0`
  - `RegisterIn.default_commission_percent: Optional[float] = 0`
  - `FinancialEntryIn.commission_amount: Optional[float] = None`
  - `FinancialEntryIn.commission_status: Optional[Literal["pendente","paga","cancelada"]] = None`
  - `FinancialEntryPatch` sincronizado com os mesmos campos (simetria POST↔PATCH).
- ✅ **Backend tests**: 25/25 pass (`test_phase5_wave_a.py`) — regressão total das fases anteriores + backward compat + validação Literal + persistência via POST e PATCH.

### Fase 5 Onda A+ — Redesign UI do AttendanceDialog (Fev/2026)
Redesign visual completo do dialog de atendimento. ZERO mudança em backend/APIs/regras/persistência. Objetivo: maximizar área clínica.

- ✅ **Header compacto sempre visível (~48-60px)** — linha única: nome + idade + telefone + procedimento + timer + chips de alerta (⚠ danger/warn/info clicáveis com tooltip) + botões **Foco** + **Doc**.
- ✅ **Auto-compactação em scroll** — quando `bodyRef.current.scrollTop > 100`, o header se comprime automaticamente ocultando o metadata expandido (procedimento, último atendimento, progresso).
- ✅ **Barra de progresso mínima ~24px** — 6 pills discretas horizontais (Ficha/Fotos/Evolução/Assinatura/Orçamento/Finalização) + barra gradient primary→success + `%` mono.
- ✅ **Botão "Foco"** — força `compactHeader=true` mesmo sem scroll, oculta progresso/alertas para máxima área clínica.
- ✅ **Área clínica maximizada** — DialogHeader legacy escondido em `stage="inProgress"` (Smart Header assume); textarea Evolução `rows=14 min-h-[300px]`; Prescrição `rows=16 min-h-[380px]`.
- ✅ **Dialog max-w-6xl w-[97vw] max-h-[95vh]** — aproveita ~97% da viewport em desktop, mantendo responsividade.
- ✅ **Footer sticky com Financial Preview inline** — "Salvar rascunho" + "TOTAL A LANÇAR R$ X" + "Concluir atendimento" sempre visíveis.
- ✅ **Acessibilidade** — `DialogTitle` + `DialogDescription` em `sr-only` mantidos para screen readers quando o Smart Header assume.
- ✅ **Backend regression**: 171/171 tests PASS em 7 suites (Fase 2 + 2.5B/C/D/E + 4 + 5A). Redesign visual **confirmado como zero-impacto**.

### Fase Ficha Premium — Reordenação + Novos Módulos (Fev/2026)
Fundamento estrutural para o prontuário premium de clínica de estética avançada. **Zero quebra** — mudanças puramente aditivas.

- ✅ **Reordenação das sub-abas da Ficha**: `Geral → Anamnese`, e nova ordem: **Anamnese · Facial · Injetáveis · Corporal · Capilar · Epilação**.
- ✅ **Novo módulo `injetaveis`** — schema com procedimento planejado (chips: Botox/HA/Fio PDO/Bioestimulador/Skinbooster/Mesoterapia), regiões faciais (frontal/glabela/periorbital/malar/lábios/mento), produto (marca/lote/validade/fabricante/quantidade), relatório final.
- ✅ **Novo módulo `epilacao`** — Fitzpatrick I-VI, pigmento/espessura/frequência, métodos utilizados, áreas a tratar (12 opções corporais), sensibilidade, contraindicações, observações.
- ✅ **Backend `ficha_snapshot`** e `_build_patient_ai_context` extendidos para incluir os 2 novos módulos no snapshot do medical_record e no contexto da IA.
- ✅ **`MODULE_LABELS`** renomeado: `geral → "Anamnese"`, novos `injetaveis` e `epilacao`.
- ✅ **Backward compat**: modules antigos (`geral`, `facial`, `corporal`, `capilar`) continuam funcionando. Documentos com `module=geral` continuam visíveis. FichaForm renderiza dinamicamente pelo schema.
- ✅ **Validação visual**: screenshot confirma ordem correta + "Anamnese" como default. Backend restart OK. Lint clean.

## Roadmap "Ficha Premium" — Próximas ondas
- **F.PREMIUM.1** — Novos tipos de field no FichaForm: `card_select` (cards visuais Fitzpatrick coloridos), `image_card_select` (grau acne, cicatrizes, rosácea, discromias com imagens), `checkbox_group` (histórico médico com 11 doenças), `medication_table` (Medicamento/Dose/Frequência), `mapa_facial` (SVG interativo com marcação de pontos).
- **F.PREMIUM.2** — Popular Anamnese Premium com todos os cards (Fitzpatrick 6 cores, Baumann 16 tipos, Acne I-V, cicatrizes 4 tipos, Rosácea 4 subtipos, discromias 4, olheiras 4, flacidez, rugas, biotipo).
- **F.PREMIUM.3** — Cálculos automáticos: IMC (peso/altura²), Petroski (densidade→% gordura), classificação de risco antropométrico.
- **F.PREMIUM.4** — Tricoscopia com upload múltiplo em galeria (já suporta via PhotoUploader existente).
- **F.PREMIUM.5** — Ficha exportável em PDF premium.
- **F.PREMIUM.6** — IA contextual pré-alimentada com dados da anamnese Premium para gerar protocolos personalizados.

**Nota importante**: a Ficha Premium completa (com cards ilustrados, escalas visuais Fitzpatrick coloridos, mapa facial interativo, tabela de medicações, todas as escalas Savin/Norwood-Hamilton/Baumann com imagens) requer ~3.000 linhas de UI adicional + assets de imagens ilustrativas. Fundamento estrutural entregue nesta sessão; ondas F.PREMIUM.1-6 completarão o padrão visual premium mantendo o mesmo backend aditivo.
- **Onda B**: Split `AttendanceDialog` (agora ~890 linhas) em `AttendanceContext` + `AttendanceSmartHeader` + `AttendanceFooter` + `TabFicha/Evolucao/Prescricao/Orcamento/Assinatura` + `AiToolbar` + hooks `useAttendanceSession`/`useAttendanceProgress`.
- **Onda C**: Split `server.py` (~4867 linhas) em routers por domínio.
- **Onda D**: Transações MongoDB atômicas no `finalize_attendance` + `session_locks` com TTL + heartbeat.
- **Onda E**: Unificação `anamnesis + anamnesis_modules` + infra WebSocket + ativação das regras de comissão (schema já pronto).
- **Cross-onda**: rate-limiting em `/ai/generate` (proteger custo EMERGENT_LLM_KEY).

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
