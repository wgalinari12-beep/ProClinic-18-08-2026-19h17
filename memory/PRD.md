# PRD — ProClinic (importado de GitHub)

## Feature: Identidade Visual por Clínica (18/08/2026) — implementado, SEM testes (a pedido)
- Backend `server.py`: `ClinicSettingsIn` +`secondary_color`/`accent_color` (validação HEX). `PUT /clinic` agora exige `require_admin`. `GET /clinic` continua legível por todos da clínica. Reutiliza coleção `clinics` (por clinic_id) e `POST /uploads` (storage por clínica, URL assinada). Sem novos endpoints/estrutura de dados.
- Frontend novos: `lib/color.js` (HEX↔HSL, validação, contraste WCAG), `contexts/ClinicBrandContext.jsx` (carrega GET /clinic no login e aplica CSS vars --primary/--secondary/--accent/--ring + foreground por contraste; cache em localStorage; reset no logout).
- Frontend alterados: `lib/api.js` (`resolveFileUrl`), `App.js` (ClinicBrandProvider dentro do AuthProvider), `pages/MinhaClinica.jsx` (seção Identidade Visual: logo upload/preview/remover, 3 cores com picker+HEX+validação, pré-visualização, restaurar padrão), `components/Sidebar.jsx` e `components/Layout.jsx` (exibem logo da clínica).
- Multi-tenant: tudo filtrado por user.clinic_id; sem personalização → tema padrão ProClinic. NENHUM teste executado.


## Re-importação (18/08/2026)
- Repo público reimportado/sincronizado: https://github.com/wgalinari15-boop/ProClinic-17-08-2026-22h51 (origin/main, up to date).
- `.env` estavam ausentes (gitignore) — recriados:
  - backend/.env: MONGO_URL, DB_NAME=proclinic_database, JWT_SECRET, EMERGENT_LLM_KEY (preenchida), FRONTEND_URL=preview, ADMIN_EMAIL/PASSWORD, ASAAS/RESEND vazias.
  - frontend/.env: REACT_APP_BACKEND_URL=preview, WDS_SOCKET_PORT=443.
- Fix de dependência: `svglib`→`rlpycairo`→`pycairo` exigia system deps. Instalado `pkg-config` + `libcairo2-dev` (registrado em .emergent/system_deps.txt).
- Serviços rodando; seed cria admin@proclinic.com/admin123 e superadmin@proclinic.com/super123.
- Validado E2E pelo testing agent: login → /dashboard OK, dashboard carrega dados reais, sem erros. Backend auth 200 (Bearer+Cookie), CORS preflight OK.


## Problema original
Importar repositório https://github.com/ptfirmino01-max/PROCINIC-10-08-2020.git e executar alterações solicitadas pelo usuário (PT-BR).

## Stack
React (CRA) + FastAPI + MongoDB + Supervisor. Object Storage Emergent. JWT auth.

## Estado atual (10/06/2026)
- Projeto importado, dependências instaladas, serviços rodando (sessão anterior).
- `EMERGENT_LLM_KEY` preenchida no backend/.env (10/06/2026) — necessária para Object Storage.

## Trabalho desta sessão (10/06/2026)
### AUDITORIA QR Code — Assinaturas e Fotos (concluída)
- Relatório completo: `/app/memory/AUDITORIA_QRCODE_ASSINATURAS_FOTOS.md`
- Plano técnico aprovado: `/app/memory/PLANO_CORRECAO_F1_F2.md`

### CORREÇÃO F1 + F2 IMPLEMENTADA E TESTADA (10/06/2026) ✅
**F1 — Fotos QR (perda de dados eliminada):**
- `server.py`: `save_anamnesis_module` não grava mais `photos` no update (`doc.pop`); novos endpoints `POST/DELETE /api/anamnesis-modules/{module_id}/photos` ($addToSet/$pull atômicos, com `photos_meta` {url, uploaded_at, uploaded_by, source}); `mobile_upload_upload` usa $addToSet + valida módulo antes (404) + logs estruturados (`proclinic.photos`: photo_added/removed/not_found/duplicate_skipped/storage_error); validação de URL contra db.files (anti-injeção).
- `FichaForm.jsx`: autosave sem `photos` (deps só [answers]); handlers addPhotos/removePhoto/ensureModuleId.
- `PhotoUploader.jsx`: props opcionais onAdd/onRemove (AttendanceDialog intocado).
**F2 — Assinaturas QR (fluxo completo):**
- `public_sign_patient`: status → aguardando_profissional + patient_sign_user_agent + clinical_event "Paciente assinou documento"; sign-patient/professional autenticados gravam user_agent; `finalize_document` → clinical_event "Documento finalizado".
- `DocumentGenerator.jsx`: polling 3s (GET /documents/{id}) com timeout 30min, prop `documentId` (modo Continuar), toast ao detectar assinatura.
- Botão "Continuar" em `PatientDetail.jsx` e `Documentos.jsx` para docs não finalizados.
- Timeline: campos aditivos `patient_documents` + `clinical_events` (coleção nova `clinical_events`), renderizados em `PatientClinicalTimeline.jsx`.
**Testes:** backend 10/10 PASS (`/app/backend/tests/test_f1_f2_qr_photos_signatures.py`) + E2E frontend completo pelo testing agent (`/app/test_reports/iteration_20.json`) — zero issues. Cenário crítico TF2 (autosave não apaga foto mobile) e TS10 (doc recuperável horas depois) validados.
**Incidente durante implementação:** edição paralela corrompeu server.py (duplicação do bloco App setup + perda de um bloco); corrigido — lição: não fazer search_replace paralelos no mesmo arquivo grande.

## Backlog priorizado
- **P1 — F3:** QR para fotos antes/depois do atendimento (context_type="session" já existe no backend, órfão)
- **P2 — F4:** renovação de URLs assinadas expiradas (validade atual: 365 dias, sem renovação)
- **P2:** regenerar public_token expirado (180 dias) ao usar "Continuar"
- Chaves pendentes: ASAAS_API_KEY, RESEND_API_KEY, SENDER_EMAIL (vazias)
- Observação: AnamnesisModuleIn Literal não inclui "injetaveis"/"epilacao" (módulos existem na UI) — possível 422 pré-existente, fora do escopo atual

## Credenciais
Ver `/app/memory/test_credentials.md` (admin@proclinic.com/admin123, superadmin@proclinic.com/super123)
