# ProClinic — PRD (Product Requirements Document)

## Visão geral
**ProClinic** é um SaaS multi-tenant para gestão de clínicas de estética e clínicas médicas modernas, com foco em experiência premium estilo Apple/iPhone (Luxury Medical Minimalism).

## Stack
- **Frontend:** React 19, React Router 7, Tailwind, Shadcn UI, Recharts, Framer Motion (animações CSS), lucide-react
- **Backend:** FastAPI + Motor (MongoDB async)
- **Banco:** MongoDB
- **IA:** Claude Sonnet 4.5 via `emergentintegrations` (Emergent Universal Key)
- **Auth:** JWT customizado (httpOnly cookie + Bearer fallback) + Emergent Google OAuth

## User personas
- Administrador (acesso total)
- Profissional (clínico/estético)
- Recepção (agenda, pacientes)
- Financeiro
- Marketing
- Paciente (portal read-only — fase 2 portal completo)

## Core requirements (estáticos)
- Multi-tenant (`clinic_id` isolando dados por clínica)
- Tema claro e escuro premium
- Sistema em pt-BR
- LGPD / consentimento por paciente
- Assinatura digital (campo `signed` em prontuário e anamnese — UI ICP fase 2)

## What's been implemented (21/Maio/2026)
- ✅ Auth JWT (register, login, logout, /me) + brute-force-safe pattern
- ✅ Emergent Google OAuth (`/auth/google/session`) — sincroniza usuários
- ✅ Seed automático: 1 clínica demo, admin, profissional, 4 pacientes, ~20 agendamentos, 7 lançamentos financeiros
- ✅ Dashboard executivo: faturamento mensal, atendimentos hoje, ocupação, top procedimentos, aniversariantes, agenda do dia, gráfico receita×despesa
- ✅ Pacientes: CRUD + busca + cards premium + perfil com Timeline/Prontuário/Anamnese
- ✅ Agenda semanal estilo Google Calendar premium (8h-19h, drag-drop visual, cores por status, navegação)
- ✅ Prontuário Digital com comparação Antes/Depois lado a lado
- ✅ Anamnese inteligente com formulário condicional (`select`/`text`/`textarea`) e assinatura
- ✅ Financeiro: cards, BarChart 6 meses, lista com toggle pago/pendente
- ✅ Assistente IA (Claude Sonnet 4.5) com sugestões pré-definidas e histórico
- ✅ Sidebar Linear-style + TopBar glassmorphism + theme toggle premium
- ✅ Login com background luxury (light/dark), Google OAuth + email/senha

## P0 backlog (próxima sessão)
- Upload de imagens reais (object storage) para foto do paciente e antes/depois
- Permissões granulares por role no frontend (UI gates)
- Drag-drop real na agenda (atualmente visual)
- WhatsApp via Evolution API (confirmação automática, lembretes)

## P1 backlog
- Portal completo do paciente (read-only — login dedicado)
- Estoque (lote, validade, alertas)
- CRM/Funil de vendas com leads
- Análise facial IA com upload de foto
- Relatórios PDF (financeiro, produtividade, comissão)

## P2 backlog
- Assinatura ICP Brasil real
- 2FA + biometria mobile
- White label multi-clínica
- Cobrança recorrente Stripe
- Mobile app nativo

## Credenciais teste
Ver `/app/memory/test_credentials.md`
