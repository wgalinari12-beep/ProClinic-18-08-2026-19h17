# ProClinic — PRD

## Visão geral
**ProClinic** é um SaaS multi-tenant para gestão de clínicas de estética e clínicas médicas modernas, com foco em experiência premium estilo Apple/iPhone (Luxury Medical Minimalism).

## Stack
- **Frontend:** React 19, React Router 7, Tailwind, Shadcn UI, Recharts, lucide-react, @dnd-kit, react-signature-canvas, qrcode.react
- **Backend:** FastAPI + Motor (MongoDB async), Emergent Object Storage
- **IA:** Claude Sonnet 4.5 via `emergentintegrations`
- **Auth:** JWT customizado + Emergent Google OAuth

## What's been implemented

### Fase 1 (21/Maio/2026) — MVP
Auth JWT + Google, Dashboard, Pacientes, Agenda v1, Prontuário, Anamnese, Financeiro, IA, Sidebar, tema light/dark.

### Fase 2 (27/Maio/2026)
Agenda v2 (drag-drop), Atendimento clínico (cronômetro+autosave+5 tabs), 4 Fichas premium, Object Storage uploads, Assinatura touch, IA clínica expandida, Central de Mensagens.

### Fase 2.1 (30/Maio/2026)
- ✅ **Ficha Geral**: campo condicional `doencas_descricao` aparece após marcar chips de doenças
- ✅ **Ficha Corporal**: IMC auto-calculado em tempo real com 6 classes (Abaixo / Normal / Sobrepeso / Obesidade I/II/III)
- ✅ **Fotos por ficha**: aba "Fotos" isolada removida; cada ficha (Geral/Facial/Corporal/Capilar) tem sua própria seção "Fotos da Avaliação" — Antes/Depois movidos para aba Evolução
- ✅ **QR Code mobile capture**: dialog gera QR + URL pública com JWT 20min; mobile abre câmera, fotos aparecem por polling automático
- ✅ **Pré-cadastro inline na Agenda**: botão "+ Novo paciente" cria com Nome + Telefone, flag `is_pre_registered=true`, bloqueia atendimento até completar cadastro
- ✅ **Cadastro de Procedimentos** (`/procedimentos`): CRUD com nome, valor, duração, categoria, ativo. Agenda agora carrega dinamicamente o catálogo e auto-preenche valor + duração
- ✅ **Portal público de confirmação** (`/confirmacao/:token`): página premium com logo da clínica, dados do agendamento e botões Confirmar / Reagendar / Cancelar (sem auth, JWT 30 dias)
- ✅ **WhatsApp Web** abre automaticamente com link público de confirmação pré-preenchido
- ✅ **Minha Clínica** (`/minha-clinica`): identidade, contato, endereço, responsável técnico (CRM/conselho), redes sociais, upload de logomarca
- ✅ **Finalização do atendimento**: ao concluir, fecha dialog automaticamente e retorna à agenda
- ✅ **Login text** atualizado para "Excelência em cada atendimento"

### Backend tests
- **123/123 PASS** acumulados (78 Fase 2.1 + 26 Fase 2 + 19 Fase 1) — sem regressões

## P0 backlog (próxima sessão)
- **WhatsApp Evolution API real** (aguardando credenciais: URL + Instance + API Key)
- Resize de duração na agenda (handle inferior do card)
- Portal completo do paciente (login dedicado read-only)
- Drawer mobile para AttendanceDialog

## P1 backlog
- CRM/Funil de vendas com leads e estágios
- Estoque (lote, validade, consumo automático, alertas)
- Análise facial IA com upload de foto
- Relatórios PDF (financeiro, produtividade, comissão)
- Token de confirmação one-shot (auditoria)
- Refatorar server.py (1700 linhas) em routers por domínio

## P2 backlog
- Assinatura ICP Brasil real
- 2FA + biometria mobile
- White label multi-clínica
- Cobrança recorrente Stripe
- Mobile app nativo (PWA primeiro)
- CORS hardening (origens explícitas em produção)

## Credenciais teste
Ver `/app/memory/test_credentials.md`
