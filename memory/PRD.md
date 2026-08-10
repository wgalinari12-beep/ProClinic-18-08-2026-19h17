# PRD — ProClinic (importado de GitHub)

## Problema original
Importar repositório https://github.com/ptfirmino01-max/PROCINIC-10-08-2020.git e executar alterações solicitadas pelo usuário (PT-BR).

## Stack
React (CRA) + FastAPI + MongoDB + Supervisor. Object Storage Emergent. JWT auth.

## Estado atual (10/06/2026)
- Projeto importado, dependências instaladas, serviços rodando (sessão anterior).
- `EMERGENT_LLM_KEY` preenchida no backend/.env (10/06/2026) — necessária para Object Storage.

## Trabalho desta sessão (10/06/2026)
### AUDITORIA QR Code — Assinaturas e Fotos (SOMENTE LEITURA, nenhum código alterado)
- Relatório completo: `/app/memory/AUDITORIA_QRCODE_ASSINATURAS_FOTOS.md`
- **Causa raiz FOTOS (crítico, provado):** autosave do `FichaForm.jsx` envia array `photos` local e `save_anamnesis_module` (server.py:2100) faz `$set` total → APAGA fotos enviadas via QR mobile (`$push`). Perda real de dados reproduzida em teste controlado (1 foto → 0).
- **Causa raiz ASSINATURAS (crítico, provado):** assinatura via QR É salva em `db.documents.patient_signature`, mas: DocumentGenerator sem polling (estado stale), status não avança no endpoint público, sem UI para retomar rascunho, PDF nunca gerado, docs sem `appointment_id` invisíveis na timeline.
- **Latente:** URLs assinadas de arquivos expiram em 365 dias sem renovação/fallback (401 confirmado com sig expirado).
- **Lacuna:** fotos antes/depois do atendimento e TCLE do atendimento NÃO possuem fluxo QR (só a Ficha/anamnese tem QR de fotos; só documentos têm QR de assinatura).
- Dados de teste criados: `anm_df6777e6f4af`, `tpl_82631c0096f9`, `doc_3c8d1cfb59f5`, `file_f11df160ed6d`.

## Backlog priorizado
- **P0 — F1 Fotos:** endpoints atômicos add/remove foto de anamnese + FichaForm parar de enviar `photos` no autosave (AGUARDANDO APROVAÇÃO DO USUÁRIO)
- **P0 — F2 Assinaturas:** polling no DocumentGenerator, status no endpoint público, ação "Continuar" em rascunhos, `appointmentId` no PatientDetail, timeline por patient_id (AGUARDANDO APROVAÇÃO)
- **P1 — F3:** QR para fotos antes/depois do atendimento (context_type="session" já existe no backend, órfão)
- **P2 — F4:** renovação de URLs assinadas expiradas
- Chaves pendentes: ASAAS_API_KEY, RESEND_API_KEY, SENDER_EMAIL (vazias)

## Credenciais
Ver `/app/memory/test_credentials.md` (admin@proclinic.com/admin123, superadmin@proclinic.com/super123)
