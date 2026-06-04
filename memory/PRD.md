# ProClinic — PRD

## Visão geral
**ProClinic** é um SaaS multi-tenant para gestão de clínicas de estética e clínicas médicas, com foco em experiência premium estilo Apple/iPhone (Luxury Medical Minimalism).

## Stack
- **Frontend:** React 19, React Router 7, Tailwind, Shadcn UI, Recharts, lucide-react, @dnd-kit, react-signature-canvas, qrcode.react
- **Backend:** FastAPI + Motor (MongoDB async), Emergent Object Storage (signed URLs)
- **IA:** Claude Sonnet 4.5 via `emergentintegrations`
- **Auth:** JWT customizado (email OU CPF) + Emergent Google OAuth + RBAC

## What's been implemented

### Fase 1 — MVP
Auth JWT + Google, Dashboard, Pacientes, Agenda v1, Prontuário, Anamnese, Financeiro, IA, Sidebar, tema light/dark.

### Fase 2
Agenda v2 (drag-drop), Atendimento clínico (cronômetro+autosave+tabs), 4 Fichas premium, Object Storage uploads, Assinatura touch, IA clínica expandida, Central de Mensagens.

### Fase 2.1
IMC auto, doenças condicional, fotos por ficha, QR code mobile capture, pré-cadastro inline, Procedimentos CRUD, portal público de confirmação, Minha Clínica.

### Fase 2.2A — Multiprofissional + RBAC + Photo Bug fix (04/Jun/2026)
Signed URLs para fotos (?sig=); Login email OU CPF; RBAC admin/profissional/recepcao/financeiro/marketing; Segregação de prontuário por profissional; CRUD de Equipe com cor + reset de senha; ChangePasswordModal forçado no 1º acesso; Agenda colorida por profissional; PhotoUploader v2 + Lightbox premium.

### Fase 2.2B — Orçamento + Financeiro auto + Visão por Profissional (04/Jun/2026)
- ✅ **Módulo de Orçamento** completo: itens (catálogo + manual), descontos % e R$, totais auto, condições de pagamento, parcelas, validade.
- ✅ **Orçamento dentro do Atendimento** (aba dedicada) + **botão Novo Orçamento na ficha do paciente**.
- ✅ **Link público de Orçamento** (`/orcamento/:token` — JWT 60d) — paciente aprova com assinatura touch ou recusa, sem login.
- ✅ **Lançamento financeiro automático** ao concluir atendimento — modal Pago/Parcial/Não pago → gera entrada(s) em /finance/entries (parcial cria entrada paga + saldo a vencer).
- ✅ **Permissões refinadas da Recepção**: 403 server-side em /anamnesis, /medical-records, /anamnesis-modules, /budgets, /attendance/*; Sidebar/Routes/Tabs ocultos client-side.
- ✅ **Agenda "Visão por Profissional"**: toggle no header (Todas | Por profissional → colunas paralelas por médico no dia atual; drag pode reassinar profissional).
- ✅ **Backend tests**: 15/15 novos (`test_phase2_2b_api.py`).

## P0 backlog — Fase 2.2C
- **WhatsApp Evolution API real** — aguardando credenciais do usuário (URL + Instance + API Key).
- **Logs de auditoria** — quem criou/alterou/concluiu, com timestamps.
- **Refactor `server.py`** (>2350 linhas) em routers por domínio (auth, users, files, budgets, attendance, public, ai).

## P1 backlog
- PDF do orçamento para download (atualmente HTML/link).
- Token de orçamento com secret/scope separados (BUDGET_PUBLIC_SECRET).
- Validar installments × payment_method.
- Resize de duração na agenda (handle inferior do card).
- Drawer mobile para AttendanceDialog.
- Migration para anexar `?sig=` em fotos legadas.
- Portal completo do paciente (login dedicado read-only).
- Token de confirmação one-shot.

## P2 backlog
- Assinatura ICP Brasil real.
- 2FA + biometria mobile.
- White label multi-clínica.
- Cobrança recorrente Stripe.
- Mobile app nativo (PWA primeiro).
- CORS hardening (origens explícitas em produção).
- Cleanup de seed/data TEST_ acumulado de iterations.

## Credenciais teste
Ver `/app/memory/test_credentials.md`
