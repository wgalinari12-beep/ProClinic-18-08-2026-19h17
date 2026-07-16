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
- ✅ **Integração Asaas** (sandbox real) — customer + subscription + PIX/Boleto/Cartão + webhooks.
- ✅ **3 planos** (Starter R$59,90 · Professional R$99,90 · Premium R$149,90) com 20% off no anual.
- ✅ **Trial 7 dias** automático (sem cartão) para toda nova clínica; grace read-only 3 dias; expired.
- ✅ **Feature gating** server-side (`require_feature`): IA e Documentos ≥ Professional; WhatsApp ≥ Premium.
- ✅ **Endpoints**: /plans, /subscriptions/me, /subscriptions/checkout, /subscriptions/cancel, /subscriptions/change-plan, /subscriptions/payments, /admin/finance/summary (scoped por clínica).
- ✅ **Webhooks Asaas** com header `asaas-access-token`, idempotência por `event.id` + unique index em `webhook_events`, eventos PAYMENT_CONFIRMED/RECEIVED/OVERDUE/DELETED e SUBSCRIPTION_UPDATED/INACTIVATED/DELETED.
- ✅ **Frontend**: /planos (toggle mensal↔anual), /checkout/:planKey (PIX/Boleto/Cartão), /minha-assinatura (status + histórico + cancelar), TrialBanner global no Layout.
- ✅ **RBAC UX**: item "Assinatura" na sidebar apenas para admin; botão "Assinar" desabilitado para não-admin com título "Pedir ao admin".
- ✅ **Backend tests**: 20/20 (`test_phase2_4a_subscriptions.py`) — chamadas reais para Asaas sandbox.
- ✅ **Polimentos pós-teste**: /admin/finance/summary scoped por clinic_id; webhook exige id; unique index em event_id.

## P0 backlog — Fase 2.4B (próxima)
- **Super-admin dashboard cross-tenant** (MRR/ARR/churn/inadimplência global).
- **Cupons de desconto** (promo codes com prazo + %).
- **Emails automáticos** (Resend) — trial expirando, pagamento recebido, cobrança em atraso.
- **Fatura em PDF** por pagamento.

## P0 backlog — Fase 2.3B
- **Import DOCX + PDF** como modelos.
- **Relatórios de auditoria** com filtros.
- **Realtime QR sign** feedback (polling).

## P0 backlog — Fase 2.2C / paralelo
- **WhatsApp Evolution API real** (aguardando credenciais do usuário).
- **Refactor `server.py`** (~3300 linhas) em routers por domínio: /routes/subscriptions.py, /services/asaas.py (+ helpers _normalize_cpf, retries em asaas_request).
- **Auditoria de todas as ações** (não só documentos).

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
