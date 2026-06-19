# ProClinic — PRD

## Visão geral
**ProClinic** é um SaaS multi-tenant para gestão de clínicas de estética e clínicas médicas, com foco em experiência premium estilo Apple/iPhone (Luxury Medical Minimalism).

## Stack
- **Frontend:** React 19, React Router 7, Tailwind, Shadcn UI, Recharts, lucide-react, @dnd-kit, react-signature-canvas, qrcode.react
- **Backend:** FastAPI + Motor (MongoDB async), Emergent Object Storage (signed URLs), xhtml2pdf (PDF), python markdown
- **IA:** Claude Sonnet 4.5 via `emergentintegrations`
- **Auth:** JWT (email OU CPF) + Google OAuth + RBAC (admin/profissional/recepcao/financeiro/marketing)

## What's been implemented

### Fase 1 — MVP
Auth, Dashboard, Pacientes, Agenda v1, Prontuário, Anamnese, Financeiro, IA, Sidebar, tema light/dark.

### Fase 2
Agenda v2 (drag-drop), Atendimento clínico, 4 Fichas premium, Object Storage uploads, Assinatura touch, IA clínica, Mensagens.

### Fase 2.1
Auto-IMC, fotos por ficha, QR mobile capture, Procedimentos CRUD, portal público de confirmação, Minha Clínica.

### Fase 2.2A — RBAC + Photo Bug fix (Jun/2026)
Signed URLs para fotos; Login email OU CPF; RBAC; Segregação de prontuário; CRUD de Equipe; ChangePasswordModal forçado; Agenda colorida por profissional; Lightbox premium.

### Fase 2.2B — Orçamento + Financeiro auto + Visão por Profissional
Módulo de Orçamento (atendimento + ficha); Link público `/orcamento/:token`; Lançamento financeiro automático (Pago/Parcial/Não pago); Recepção bloqueada de prontuário; Agenda toggle Todas | Por profissional.

### Fase 2.3A — Documentos Jurídicos (Jun/2026)
- ✅ **Biblioteca de modelos** (admin CRUD) com markdown + palette de 16 variáveis dinâmicas.
- ✅ **Editor com preview HTML ao vivo** e inserção de variáveis na posição do cursor.
- ✅ **Auto-preenchimento** ({{PACIENTE_NOME}}, {{PROFISSIONAL_NOME}}, {{CLINICA_NOME}}, {{PROCEDIMENTO}}, {{VALOR_PROCEDIMENTO}}, {{DATA_ATUAL}}, etc.) durante atendimento ou via ficha do paciente.
- ✅ **Assinatura digital** do paciente + profissional via canvas touch (desktop/tablet/mobile).
- ✅ **PDF final** gerado via xhtml2pdf com QR Code de validação, salvo em Object Storage (signed URL).
- ✅ **Aba "Documentos Assinados"** na ficha do paciente.
- ✅ **Sigilo profissional** server-side: profissional vê apenas docs que ele criou; admin vê tudo; recepção 403.
- ✅ **Link público** `/documento-publico/:token` (paciente assina pelo celular via QR) e `/documento/:id/validar?t=` (validação pública do QR no PDF).
- ✅ **Auditoria** (created/viewed/signed_patient/signed_professional/finalized/signed_patient_public com IP+device+timestamp).
- ✅ **Backend tests**: 23/23 (`test_phase2_3a_documents.py`).
- ✅ **Polimento pós-teste**: insertVar agora respeita o cursor (ou append ao final se nunca focado).

## P0 backlog — Fase 2.3B (próxima)
- **Import DOCX e PDF** como modelos (.docx via python-docx; PDF via pdfplumber → text → md).
- **Relatórios de auditoria** com filtros (período, ação, usuário, paciente, documento).
- **Mobile QR sign loop**: feedback imediato no desktop quando o paciente assina pelo celular (polling ou WebSocket leve).

## P0 backlog — Fase 2.2C / paralelo
- **WhatsApp Evolution API real** — aguardando credenciais (URL + Instance + API Key).
- **Refactor `server.py`** (~2900 linhas) em routers por domínio: routes/documents.py, services/document_render.py, routes/budgets.py, routes/attendance.py, routes/auth.py.

## P1 backlog
- **Validação pública do QR**: redigir nome do paciente para iniciais (LGPD).
- **DOC_PUBLIC_SECRET** separado do JWT_SECRET (+ audience='doc') para tokens de longa duração (180d).
- Sanitização do `content_md` antes de injetar em PDF (proteção contra admin malicioso colar HTML/JS).
- Whitelist de `device` (desktop|tablet|mobile-qr) no DocumentSignIn.
- Warning quando variáveis em minúsculo ({{paciente_nome}}) não casam.
- PDF do orçamento para download.
- Resize de duração na agenda.
- Drawer mobile para AttendanceDialog.
- Migration para anexar `?sig=` em fotos legadas.

## P2 backlog
- Assinatura ICP Brasil real (estrutura preparada via `audit_logs.action` + `pdf_path`).
- Carimbo de tempo.
- 2FA + biometria mobile.
- White label multi-clínica.
- Stripe recorrente.
- Cleanup TEST_ data acumulado.

## Credenciais teste
Ver `/app/memory/test_credentials.md`
