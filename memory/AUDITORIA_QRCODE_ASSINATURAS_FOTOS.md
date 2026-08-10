# AUDITORIA — FLUXO DE ASSINATURAS E FOTOS VIA QR CODE
**Data:** 10/06/2026 · **Modo:** somente leitura (nenhum código alterado)
**Ambiente de teste:** preview · Backend FastAPI (`server.py`, 5.776 linhas) · MongoDB `proclinic`

> Única alteração de ambiente: `EMERGENT_LLM_KEY` preenchida em `/app/backend/.env` (estava vazia) apenas para o Object Storage funcionar e permitir o teste controlado. Nenhuma linha de código foi tocada.

---

## VEREDITO EXECUTIVO

| Fluxo | Dado é salvo no banco? | Por que "some"? |
|---|---|---|
| **Assinatura via QR** | ✅ SIM — `db.documents.patient_signature` (provado) | O desktop **nunca fica sabendo**: não há polling; o documento fica preso em `rascunho`, sem PDF, e a UI não tem como reabri-lo para finalizar. Sem PDF, prontuário/timeline não mostram nada útil. |
| **Fotos via QR** | ✅ SIM — `$push` em `anamnesis_modules.photos` (provado) | O **autosave do desktop APAGA a foto**: `FichaForm` envia o array `photos` local (desatualizado) e o backend faz `$set` do documento inteiro, sobrescrevendo o `$push` do celular. **Perda de dados provada em teste controlado.** |

Ou seja: **não é falha de upload nem de storage — é (1) sobrescrita por race condition nas fotos e (2) fluxo interrompido/invisível nas assinaturas.**

---

## ETAPA 1 — FLUXO DE ASSINATURA VIA QR (mapeamento completo)

### Importante: existem DOIS sistemas de assinatura no ProClinic
1. **Assinaturas do ATENDIMENTO** (`AttendanceDialog` → aba "Assinatura"): TCLE do paciente + evolução do profissional, desenhadas no **SignaturePad do próprio desktop**. **NÃO existe QR Code aqui.** Persistem em `attendance_sessions.consent_signature / evolution_signature` via `POST /api/attendance/{id}/sign` (server.py:2266) e são copiadas para `medical_records` no finalize (server.py:2434-2437). Este fluxo FUNCIONA.
2. **Assinatura de DOCUMENTOS via QR** (`DocumentGenerator` → aba "QR celular"): é o único fluxo de assinatura por QR Code. **É aqui que ocorre a falha reportada.**

### Fluxograma real (documentos via QR)
```
DocumentGenerator (desktop, dentro do AttendanceDialog ou PatientDetail)
  └─ POST /api/documents  → cria doc status="rascunho" + public_token (JWT 180 dias)  [server.py:4449-4477]
QR Code (QRCodeSVG) → URL: /documento-publico/{public_token}          [DocumentGenerator.jsx:115-118]
  ↓ celular do paciente
DocumentoPublico.jsx (página pública)
  └─ GET  /api/public/documents/{token}          → carrega doc        [server.py:4651]
  └─ POST /api/public/documents/{token}/sign-patient                  [server.py:4676]
        payload: { signature: <base64 PNG>, device: "mobile-qr" }
  ↓
MongoDB db.documents ← $set patient_signature + signed_patient_at + audit_log  ✅ SALVO
  ↓
❌ AQUI O FLUXO MORRE:
  • Desktop (DocumentGenerator) NÃO faz polling → estado React `doc` continua com
    patient_signature: null → profissional vê "Aguardando" para sempre
  • Botão "Finalizar e gerar PDF" fica DESABILITADO (depende do estado local stale)
  • Endpoint público NÃO atualiza `status` (permanece "rascunho")
  • Se o profissional fecha o dialog: NÃO EXISTE tela para reabrir o doc rascunho
    (Documentos.jsx e PatientDetail só listam; sem ação "continuar/assinar/finalizar")
  ↓
Documento fica órfão: status="rascunho", pdf_url=null, appointment_id=null (se criado
pelo PatientDetail) → NUNCA gera PDF → NUNCA aparece de forma útil no prontuário
```

### Onde o prontuário procura as assinaturas de documento
- **Timeline** (`_build_patient_timeline`, server.py:3286-3291): busca `db.documents` **filtrando por `appointment_id`**. Docs criados fora do atendimento (PatientDetail não passa `appointmentId` — PatientDetail.jsx:325-334) têm `appointment_id=null` → **invisíveis na timeline**.
- **Aba Documentos do paciente** (PatientDetail.jsx:253-295) e **página Documentos** (Documentos.jsx:126-173): listam o doc com status "Rascunho", mas o link só aparece se `pdf_url` existir → como nunca finaliza, aparece "—". Para o usuário: "a assinatura sumiu".

---

## ETAPA 2 — FLUXO DE FOTOS VIA QR (mapeamento completo)

O QR de fotos existe **somente dentro da Ficha/Anamnese** (`FichaForm` → botão "Capturar pelo celular", FichaForm.jsx:286-307). As fotos "Antes/Depois" do atendimento (`photos_before/photos_after` no `PhotoUploader` do AttendanceDialog) **não têm opção QR** — só upload local.

```
FichaForm (desktop, aba Ficha do atendimento)
  └─ MobileUploadQR → POST /api/mobile-upload/init                  [server.py:3998]
        token JWT scope=mobile_upload, ctx_type="anamnesis", ctx_id=module_id, EXP 20 min
QR Code (QRCodeCanvas) → URL: /upload-mobile?token=...              [MobileUploadQR.jsx:68-70]
  ↓ celular
MobileUpload.jsx (página pública)
  └─ GET  /api/mobile-upload/verify/{token}                          [server.py:4004]
  └─ POST /api/mobile-upload/upload?token=...  (multipart)           [server.py:4017]
  ↓
Backend: put_object() → Emergent Object Storage  ✅
         db.files.insert_one (context_type/context_id, sig 365 dias) ✅
         $push anamnesis_modules.photos ← URL assinada               ✅ SALVO [server.py:4061-4065]
  ↓
Desktop: MobileUploadQR faz polling 2,5 s em /mobile-upload/files/{token}
         → onUploaded → FichaForm.onMobileUploaded → refetch → setPhotos  [FichaForm.jsx:111-118]
  ↓
❌ AQUI OCORRE A PERDA:
  FichaForm tem autosave (900 ms) que envia SEMPRE o array `photos` do estado local:
     POST /api/anamnesis-modules { answers, photos }                 [FichaForm.jsx:69-86]
  Backend save_anamnesis_module faz $set do doc INTEIRO (incluindo photos)  [server.py:2114-2128]
  → Se o estado local estiver desatualizado (dialog QR fechado antes do polling,
    foto enviada após fechar o dialog, outra aba/módulo, corrida upload×autosave),
    o autosave SOBRESCREVE e APAGA as fotos do celular no banco.
  ↓
Prontuário/timeline: ficha_snapshot copia anamnesis_modules.photos no finalize
  [server.py:2402-2412] → como já foram apagadas, o prontuário mostra 0 fotos.
```

Observação adicional: o backend aceita `context_type="session"` no mobile-upload (server.py:3981), mas **nenhuma tela usa** e, para "session", o arquivo só vai para `db.files` sem vincular a nada — **código órfão**.

---

## ETAPA 3 — VALIDAÇÃO DE PERSISTÊNCIA (teste real)

### Assinaturas (documento doc_3c8d1cfb59f5, criado no teste)
| Verificação | Resultado |
|---|---|
| Assinatura salva ao enviar? | **SIM** — `POST /api/public/documents/{token}/sign-patient` → `{"ok":true}` |
| Salva no Object Storage? | **NÃO (por design)** — assinatura é base64 PNG embutida no doc Mongo (1.134 chars no teste) |
| Salva no MongoDB? | **SIM** — `db.documents.patient_signature` + `signed_patient_at=2026-08-10T19:56:21Z` |
| URL válida? | N/A (base64 inline). O PDF final teria URL assinada — mas nunca é gerado |
| URL expira? | Token público do QR: 180 dias. URL do PDF (se existisse): 365 dias |
| Associação patient_id? | **SIM** (`patient_id` no doc) |
| Associação attendance_id? | **PARCIAL** — só se gerado de dentro do atendimento; via PatientDetail fica `null` |
| Associação medical_record_id? | **NÃO existe** — documentos nunca são vinculados a medical_records |

### Fotos (módulo anm_df6777e6f4af, criado no teste)
| Verificação | Resultado |
|---|---|
| Foto salva ao enviar? | **SIM** — upload mobile OK, storage OK |
| Salva no Object Storage? | **SIM** — `proclinic/clinic_.../747e9970...png` |
| Salva no MongoDB? | **SIM** — `db.files` + `$push` em `anamnesis_modules.photos` (contagem: 1) |
| URL válida? | **SIM** — URL assinada `?sig=` servida com HTTP 200 |
| URL expira? | **SIM — 365 dias**, sem renovação (ver Etapa 4) |
| Associação patient/attendance/record? | **INDIRETA e frágil** — foto vincula ao `module_id` da anamnese; chega ao prontuário só via `ficha_snapshot` no finalize. `db.files` guarda `context_id`, mas nada aponta para patient_id |
| **Foto SOBREVIVE ao autosave do desktop?** | **❌ NÃO — APAGADA (provado):** após simular autosave com estado stale (`photos: []`), contagem no banco caiu de **1 → 0** |

---

## ETAPA 4 — URLs ASSINADAS

- `make_file_signature` (server.py:1977): JWT com **expiração de 365 dias**.
- **URLs expiram?** SIM (365 dias para imagens/PDFs; 180 dias para o link público de assinatura; 20 min para o QR de upload).
- **Após expirar, a imagem some?** SIM — teste com sig expirado forjado: `GET /api/files/... → HTTP 401` ("Link de imagem expirado"). O `<img>` fica quebrado (PhotoUploader só aplica `opacity 0.3` no onError; timeline nem trata).
- **Existe renovação automática?** **NÃO.** Não há endpoint de re-assinatura nem re-geração periódica.
- **Existe fallback?** PARCIAL e inócuo: o fallback `?auth=token` do PhotoUploader (linha 51-63) só é usado quando a URL **não tem** `sig=` — se o sig existe mas expirou, não há fallback. `serve_file` até aceita auth de usuário, mas o frontend nunca tenta esse caminho quando há sig expirado.
- **Conclusão:** o problema apontado em auditorias anteriores **persiste**, porém com horizonte de 365 dias — não é a causa do sumiço imediato reportado agora.

## ETAPA 5 — AUDITORIA DE FRONTEND

| Componente | Achados |
|---|---|
| **DocumentGenerator.jsx** | ❌ Sem polling/refresh após gerar o QR (linhas 115-118 só montam a URL). Estado `doc` fica stale; "Finalizar" travado. ❌ Ao reabrir o dialog, `useEffect` reseta para "pick" e cria um **documento novo** a cada template escolhido (POST /documents) — gera rascunhos duplicados órfãos. |
| **DocumentoPublico.jsx** | ✅ Correto. Envia assinatura e confirma. Não é o problema. |
| **MobileUploadQR.jsx** | ⚠️ Polling de 2,5 s só enquanto o dialog está aberto; fecha = para. ⚠️ `useEffect` de polling com deps `[uploadedCount, initialCount]` recria o interval a cada foto (funciona, mas frágil). |
| **MobileUpload.jsx** (celular) | ✅ Correto. Upload sequencial com feedback. |
| **FichaForm.jsx** | ❌ **CAUSA RAIZ das fotos**: autosave (deps `[answers, photos]`) envia `photos` local inteiro → sobrescreve o banco. ❌ `onMobileUploaded` refaz fetch, mas só é chamado enquanto o QR dialog está aberto. ⚠️ Race dupla: `$push` do mobile × `$set` do autosave sem versionamento/merge. |
| **AttendanceDialog.jsx** | ✅ Autosave com AbortController + op_id (protege contra race própria). ⚠️ Fotos antes/depois sem opção QR (expectativa do usuário não coberta). Assinaturas do atendimento: pad desktop apenas, com metadados forenses OK. |
| **PhotoUploader.jsx** | ⚠️ Sem tratamento para sig expirado (Etapa 4). |
| **PatientClinicalTimeline.jsx** | ⚠️ Exibe apenas METADADOS das assinaturas do atendimento (SignatureCard, linhas 508-525) — nunca a imagem. Docs: só os com `appointment_id`; link só se `pdf_url`. |
| **PatientDetail.jsx** | ❌ Chama DocumentGenerator SEM `appointmentId` → docs invisíveis na timeline. Lista docs sem ação de continuar/assinar rascunho. |
| **Documentos.jsx** | ❌ Histórico sem ação para reabrir/finalizar rascunho assinado. |

## ETAPA 6 — AUDITORIA DE BACKEND

Endpoints envolvidos (todos respondendo 200 nos testes; logs sem exceptions):
- `POST /api/documents` · `PUT /api/documents/{id}/sign-patient|sign-professional` · `POST /api/documents/{id}/finalize`
- `GET/POST /api/public/documents/{token}[/sign-patient]` — ❌ **não atualiza `status`** ao receber assinatura pública (fica "rascunho"; o endpoint autenticado equivalente seta "aguardando_profissional" — inconsistência)
- `POST /api/mobile-upload/init|upload` · `GET /api/mobile-upload/verify|files/{token}`
- `POST /api/anamnesis-modules` — ❌ **`$set` do doc inteiro, incluindo `photos`** (server.py:2114-2128): é o que permite a sobrescrita
- `GET /api/files/{path}` — 401 em sig expirado, sem renovação
- Erros silenciosos: uploads mobile não logam falha de vínculo; `update_one` do `$push` não verifica `matched_count` (se module_id não existir, falha silenciosa)
- Timeout/upload: limite 12 MB ok; sem chunking (aceitável para fotos)

## ETAPA 7 — TESTE CONTROLADO (evidências)

Paciente: Renata Monteiro (`pat_2a6bb93ecdd0`) · Executado em 10/06/2026 via API real.

**Fotos:**
1. Criado módulo anamnese `anm_df6777e6f4af` ✅
2. QR init → token OK ✅
3. Upload mobile de PNG → `{"ok":true,"url":"/api/files/...?sig=..."}` ✅
4. Banco: `anamnesis_modules.photos.length = 1` ✅ **FOTO SALVA**
5. Simulado autosave desktop com estado stale (`photos: []`) → HTTP 200
6. Banco: `anamnesis_modules.photos.length = 0` ❌ **FOTO APAGADA — perda confirmada**

**Assinaturas:**
1. Template `tpl_82631c0096f9` + documento `doc_3c8d1cfb59f5` criados ✅
2. Assinatura enviada via endpoint público (simulando celular) → `{"ok":true}` ✅
3. Banco: `patient_signature` presente (1.134 chars), `signed_patient_at` gravado ✅ **ASSINATURA SALVA**
4. Banco: `status = "rascunho"` (não mudou) ❌ · `pdf_url` vazio ❌ · `appointment_id = null` ❌
5. Consequência verificada: doc invisível na timeline, sem PDF nas listagens → "assinatura sumiu"

**Etapa onde os dados desaparecem:**
- Fotos: **após** persistência correta, apagadas pelo autosave do FichaForm (frontend) + `$set` total (backend).
- Assinaturas: **nunca desaparecem do banco** — desaparecem da EXPERIÊNCIA: fluxo sem retorno ao desktop, sem finalize, sem PDF, sem vínculo.

---

## CAUSA RAIZ (resumo)

1. **FOTOS — Perda real de dados (crítico):** write-write race. Mobile faz `$push` em `anamnesis_modules.photos`; desktop (FichaForm autosave) reenvia o array local completo e o backend faz `$set` de tudo → fotos do celular são apagadas do MongoDB.
2. **ASSINATURAS — Fluxo interrompido (crítico):** assinatura pública é persistida, mas (a) desktop sem polling não percebe; (b) sem tela para retomar rascunho; (c) status não avança; (d) finalize/PDF nunca acontecem; (e) docs sem `appointment_id` ficam fora da timeline. Resultado: assinatura existe no banco e é invisível para todos.
3. **Latente:** URLs assinadas expiram em 365 dias sem renovação/fallback.
4. **Lacuna funcional:** fotos antes/depois do atendimento e assinatura do TCLE do atendimento **não têm** fluxo QR (usuário acredita que têm).

## ARQUIVOS / APIs / COLEÇÕES ENVOLVIDOS

- **Frontend:** `FichaForm.jsx` · `MobileUploadQR.jsx` · `MobileUpload.jsx` · `DocumentGenerator.jsx` · `DocumentoPublico.jsx` · `AttendanceDialog.jsx` · `PhotoUploader.jsx` · `PatientClinicalTimeline.jsx` · `PatientDetail.jsx` · `Documentos.jsx`
- **Backend (`server.py`):** 1977 (sig), 2037 (serve_file), 2100 (save_anamnesis_module ⭐), 2266 (sign attendance), 2335 (finalize), 3218 (timeline), 3998-4085 (mobile-upload ⭐), 4407-4532 (documents), 4594 (finalize doc), 4650-4705 (públicos ⭐)
- **MongoDB:** `anamnesis_modules` ⭐ · `documents` ⭐ · `files` · `attendance_sessions` · `medical_records` · `audit_logs`

## ESTRATÉGIA DE CORREÇÃO PROPOSTA (aguardando aprovação — NADA implementado)

**F1 — Fotos (perda de dados):**
- Backend: separar fotos do `$set` — autosave de anamnese deixa de aceitar/gravar `photos`; criar operações atômicas dedicadas (`$addToSet`/`$pull`) para adicionar/remover foto.
- Frontend: FichaForm para de enviar `photos` no autosave; adicionar/remover foto chama os novos endpoints; manter refetch pós-QR.
- Risco: **baixo** (mudança cirúrgica; contrato de leitura inalterado). Rollback: reverter 2 blocos de código.

**F2 — Assinaturas (fluxo invisível):**
- DocumentGenerator: polling (2-3 s) do doc enquanto a aba QR estiver aberta → ao detectar `signed_patient_at`, atualizar estado e habilitar Finalizar.
- Endpoint público: atualizar `status` → `aguardando_profissional`.
- Documentos.jsx / PatientDetail: ação "Continuar" em rascunhos (reabrir doc existente no DocumentGenerator em vez de criar novo).
- PatientDetail: passar `appointmentId` quando existir; timeline: incluir docs por `patient_id` (não só `appointment_id`).
- Risco: **baixo-médio** (toca 4 arquivos de UI + 1 endpoint). Rollback: git revert simples.

**F3 — (opcional/recomendado) QR para fotos antes/depois do atendimento** usando o `context_type="session"` já existente no backend + vínculo em `photos_before/photos_after`.
**F4 — (latente) Renovação de sig:** endpoint de re-assinatura de URL ou aumento de validade + fallback com auth no frontend.

## DADOS DE TESTE CRIADOS (podem ser removidos)
- `anamnesis_modules`: `anm_df6777e6f4af` (Renata Monteiro, módulo geral, "teste auditoria")
- `document_templates`: `tpl_82631c0096f9` ("TCLE Auditoria")
- `documents`: `doc_3c8d1cfb59f5` (assinado, rascunho)
- `files`: `file_f11df160ed6d` (PNG 10×10)
