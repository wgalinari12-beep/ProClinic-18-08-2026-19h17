# ProClinic — PRD

## Visão geral
**ProClinic** é um SaaS multi-tenant para gestão de clínicas de estética e clínicas médicas modernas, com foco em experiência premium estilo Apple/iPhone (Luxury Medical Minimalism).

## Stack
- **Frontend:** React 19, React Router 7, Tailwind, Shadcn UI, Recharts, lucide-react, @dnd-kit, react-signature-canvas
- **Backend:** FastAPI + Motor (MongoDB async), Emergent Object Storage
- **Banco:** MongoDB
- **IA:** Claude Sonnet 4.5 via `emergentintegrations` (Emergent Universal Key)
- **Auth:** JWT customizado (httpOnly cookie + Bearer fallback) + Emergent Google OAuth

## User personas
- Administrador (acesso total)
- Profissional (clínico/estético)
- Recepção (agenda, pacientes)
- Financeiro
- Marketing
- Paciente (portal read-only — fase 3)

## Core requirements (estáticos)
- Multi-tenant (`clinic_id` isolando dados por clínica)
- Tema claro e escuro premium
- Sistema em pt-BR
- LGPD / consentimento por paciente
- Assinatura digital (touch canvas, estrutura ICP Brasil-ready)

## What's been implemented

### Fase 1 (21/Maio/2026) — MVP
- Auth JWT + Google OAuth Emergent
- Seed automático (clínica demo, admin, profissional, 4 pacientes, ~20 agendamentos, 7 lançamentos)
- Dashboard executivo
- Pacientes CRUD + perfil
- Agenda semanal v1
- Prontuário Digital com Antes/Depois
- Anamnese inteligente v1
- Financeiro
- Assistente IA (Claude)
- Sidebar + tema light/dark

### Fase 2 (27/Maio/2026)
- ✅ **Agenda v2** com drag-and-drop (@dnd-kit) — mover atendimentos entre células, threshold 6px para não conflitar com clique
- ✅ **Dialog único** unificado (`dialogMode` state) — corrigido bug crítico de múltiplos modais abrindo simultaneamente
- ✅ **Dialog de detalhe** do agendamento com ações: Confirmar, WhatsApp, Cancelar, Excluir, **Iniciar atendimento**
- ✅ **Atendimento clínico completo** (AttendanceDialog):
  - Verificação de pré-cadastro com tela de completion
  - Cronômetro live + autosave (debounce 800ms)
  - 5 abas: Ficha / Evolução / Fotos / Prescrição / Assinatura
  - Indicador "Rascunho salvo HH:MM"
  - Finalização cria medical_record + marca appointment "concluído"
- ✅ **4 Fichas premium** (Geral / Facial / Corporal / Capilar):
  - Campos condicionais (predicate `when`)
  - Tipos: text, textarea, number, select, chips, full-row
  - Autosave por ficha + módulo
  - Botão "Resumo IA" gera análise da anamnese via Claude
- ✅ **Upload de fotos real** via Emergent Object Storage
  - Multi-upload com preview
  - Whitelist MIME (jpeg/png/webp/gif/pdf)
  - Limite 12MB, soft-delete via `is_deleted`
  - Servidor com autenticação query-param para `<img src>`
- ✅ **Assinatura digital touch** (react-signature-canvas)
  - Funciona mouse + touch + tablet
  - Salva base64 PNG
  - 2 assinaturas por sessão: consentimento (paciente) + evolução (profissional)
- ✅ **IA Clínica expandida**:
  - `POST /api/ai/generate` com 4 tipos: evolution, protocol, session_summary, anamnesis_summary
  - Sistema prompt anti-diagnóstico ("não diagnostique, não prescreva")
  - Botões "Gerar evolução IA" e "Sugerir protocolo" na sessão
  - "Resumo IA" em cada ficha
- ✅ **Central de Mensagens** (`/mensagens`):
  - Mensagens enfileiradas no MongoDB (`messages` collection)
  - Botão WhatsApp na agenda envia template de confirmação
  - Banner "Evolution API pendente" até credenciais serem fornecidas

### Backend tests
- 45/45 pytest PASS (26 Fase 2 + 19 Fase 1)

## P0 backlog (próxima sessão)
- **WhatsApp Evolution API real** (aguardando credenciais do usuário: URL + Instance + API Key)
- Resize de duração na agenda (handle inferior do card)
- Portal completo do paciente (login dedicado read-only)
- Drawer mobile para AttendanceDialog (UX mobile-first refinada)

## P1 backlog
- CRM/Funil de vendas com leads e estágios
- Estoque (lote, validade, consumo automático, alertas)
- Análise facial IA com upload de foto
- Relatórios PDF (financeiro, produtividade, comissão)
- Drag-and-drop também no mobile (touch sensor)

## P2 backlog
- Assinatura ICP Brasil real
- 2FA + biometria mobile
- White label multi-clínica
- Cobrança recorrente Stripe
- Mobile app nativo (PWA primeiro)

## Credenciais teste
Ver `/app/memory/test_credentials.md`
