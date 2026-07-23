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

## P0 backlog — Fase 2.4D (próxima)
- **Clínica demo pré-populada** para o super-admin (gera clínica fake com 30 pacientes, 100 atendimentos históricos, orçamentos e docs — útil para demonstrações).
- **Cupons: whitelist opcional de clínicas específicas**.
- **Pagination + filtros** em /super-admin/email-logs.
- **Verificar domínio próprio no Resend** (produção real).

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
