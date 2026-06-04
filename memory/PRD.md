# ProClinic — PRD

## Visão geral
**ProClinic** é um SaaS multi-tenant para gestão de clínicas de estética e clínicas médicas, com foco em experiência premium estilo Apple/iPhone (Luxury Medical Minimalism).

## Stack
- **Frontend:** React 19, React Router 7, Tailwind, Shadcn UI, Recharts, lucide-react, @dnd-kit, react-signature-canvas, qrcode.react
- **Backend:** FastAPI + Motor (MongoDB async), Emergent Object Storage (signed URLs)
- **IA:** Claude Sonnet 4.5 via `emergentintegrations`
- **Auth:** JWT customizado (email OU CPF) + Emergent Google OAuth + Role-Based Access Control

## What's been implemented

### Fase 1 — MVP
Auth JWT + Google, Dashboard, Pacientes, Agenda v1, Prontuário, Anamnese, Financeiro, IA, Sidebar, tema light/dark.

### Fase 2
Agenda v2 (drag-drop), Atendimento clínico (cronômetro+autosave+5 tabs), 4 Fichas premium, Object Storage uploads, Assinatura touch, IA clínica expandida, Central de Mensagens.

### Fase 2.1
IMC auto, doenças condicional, fotos por ficha, QR code mobile capture, pré-cadastro inline, Procedimentos CRUD, portal público de confirmação, Minha Clínica.

### Fase 2.2A (04/Jun/2026) — Multiprofissional + RBAC + Photo Bug fix
- ✅ **Signed URLs para fotos**: backend gera JWT de longa duração (`?sig=`); imagens renderizam mesmo sem token de usuário/cross-origin/JWT expirado.
- ✅ **Login por email OU CPF** (com ou sem pontuação) — `POST /api/auth/login` aceita ambos.
- ✅ **RBAC**: roles `admin`, `profissional`, `recepcao`, `financeiro`, `marketing`, `paciente` com filtros server-side.
- ✅ **Segregação de prontuário**: profissional vê apenas próprios appointments/anamnese; admin vê tudo.
- ✅ **CRUD de Equipe** (`/equipe`, admin only): cadastrar usuários com role, CPF, cor, senha inicial; reset de senha; soft-delete.
- ✅ **Troca obrigatória de senha** no 1º acesso — `ChangePasswordModal` modal forçado, montado globalmente em `App.js`.
- ✅ **Agenda colorida por profissional**: bloco do appointment usa `professional_color`; legenda de profissionais embaixo da grade; seletor de profissional no formulário.
- ✅ **PhotoUploader v2 + Lightbox premium** (zoom 1x-5x, drag, prev/next, ESC, download).
- ✅ **Backend tests**: 19/19 novos (`test_phase2_2a_api.py`) + 78/78 regressão.

## P0 backlog — Fase 2.2B (próxima sessão)
- **Módulo de Orçamento** dentro do Atendimento (itens, descontos, totais, condições de pagamento, assinatura).
- **Lançamento financeiro automático** ao concluir atendimento (Pago/Parcial/Não pago → registro em /financeiro).
- **Permissões da Recepcionista**: visão simplificada de financeiro, sem prontuário clínico.
- **WhatsApp Evolution API real** (aguardando credenciais URL + Instance + API Key do usuário).

## P1 backlog
- Refatorar `server.py` (~2050 linhas) em routers por domínio (`auth`, `users`, `files`, `appointments`, `patients`, `clinic`, `public`, `ai`).
- Logs de auditoria (quem criou/alterou/concluiu com timestamps).
- Resize de duração na agenda (handle inferior do card).
- Portal completo do paciente (login dedicado read-only).
- Drawer mobile para AttendanceDialog.
- Token de confirmação one-shot.
- Migration para anexar `?sig=` em fotos legadas armazenadas antes da Fase 2.2A.

## P2 backlog
- Assinatura ICP Brasil real.
- 2FA + biometria mobile.
- White label multi-clínica.
- Cobrança recorrente Stripe.
- Mobile app nativo (PWA primeiro).
- CORS hardening (origens explícitas em produção).
- Distinct secret/audience para signed URL JWT.
- PATCH semantics para `/api/users/{id}`.

## Credenciais teste
Ver `/app/memory/test_credentials.md`
