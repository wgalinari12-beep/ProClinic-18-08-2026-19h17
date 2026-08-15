# PLANO — QR CODE PARA FOTOS ANTES E DEPOIS DO ATENDIMENTO
## ProClinic Luxury Edition
### Modo: AUDITORIA + PLANEJAMENTO (NENHUM código alterado, NENHUM teste executado)
Status: **AGUARDANDO APROVAÇÃO DO USUÁRIO**

---

## 0. RESUMO EXECUTIVO

A funcionalidade de QR para fotos Antes/Depois pode ser entregue de forma **100% aditiva e, na prática, apenas no frontend**, porque a infraestrutura de QR já foi construída para suportar exatamente este caso — o `context_type="session"` **já existe** no backend, porém hoje está **órfão** (grava o arquivo mas ninguém o consome no atendimento).

**Conclusão-chave:** reaproveitar o sistema QR existente e distinguir "Antes" de "Depois" usando o `contextId` com sufixo (`{session_id}:before` e `{session_id}:after`). Isso separa naturalmente os dois conjuntos no endpoint de listagem, **sem alterar schema, banco ou endpoints**.

---

## ETAPA 1 — AUDITORIA (mapeamento dos componentes exigidos)

### AttendanceDialog (`frontend/src/components/AttendanceDialog.jsx`, 918 linhas)
- Aba **"evolucao"** já renderiza **dois** `PhotoUploader` (linhas 765–773):
  - Antes → `value={session.photos_before}` · `onChange={(urls)=>setSessionField("photos_before", urls)}`
  - Depois → `value={session.photos_after}` · `onChange={(urls)=>setSessionField("photos_after", urls)}`
- Persistência via **autosave** debounced → `PUT /attendance/{session_id}` (linhas 138–157) e no `finalize` (347–348). Bloqueado quando `locked` (atendimento finalizado, linha 146).
- Checklist "Fotos" (435) e progresso (453) já consideram `photos_before/after`.

### PhotoUploader (`frontend/src/components/PhotoUploader.jsx`, 139 linhas)
- Suporta 2 modos: **`onChange`** (não-atômico, usado em Antes/Depois → append na array + autosave) e **`onAdd/onRemove`** (atômico, usado na anamnese).
- Renderiza URLs assinadas (`?sig=`) diretamente; já compatível com o storage permanente (PROMPT 01).

### MobileUploadQR (`frontend/src/components/MobileUploadQR.jsx`, 121 linhas)
- **Já é genérico e parametrizável:** props `contextType` ("anamnesis" | "session"), `contextId`, `contextLabel`, `onUploaded`.
- Fluxo: `POST /mobile-upload/init` → gera QR (`/upload-mobile?token=...`) → faz **polling** de `GET /mobile-upload/files/{token}` a cada 2,5s → ao aparecer arquivo novo chama `onUploaded(urls)` (retorna TODAS as urls do contexto).
- QR válido por 20 min (por design).

### MobileUpload (página mobile) (`frontend/src/pages/MobileUpload.jsx`)
- Rota pública `/upload-mobile` (App.js:58). Valida token (`/mobile-upload/verify`), abre câmera, envia (`/mobile-upload/upload`). **Totalmente agnóstica ao contexto** → serve para session sem mudança.

### Storage
- `POST /mobile-upload/upload` (backend `server.py:4176`): para `ctx_type=="session"` grava em `db.files` com `context_type/context_id/from_mobile`, gera `sig` permanente e retorna `url`. **Não valida sessão nem anexa a nada** (comportamento órfão atual). `GET /mobile-upload/files/{token}` (`:4252`) lista por `context_type+context_id` — **genérico**.

### Prontuário / Timeline
- `photos_before/after` vivem na coleção `sessions` (atendimento). O finalize (`:2574-2575`) e a timeline (`_build_patient_timeline`, `:3361`) leem dessa coleção. **Assim que as fotos entram nas arrays e o autosave persiste, prontuário e timeline refletem automaticamente** — sem código novo.

### Finalize / Assinatura
- `finalize_attendance` (`:2478`) e `sign_attendance` (`:2409`) apenas persistem/leem `photos_before/after`. **Nada precisa mudar** — o QR alimenta as mesmas arrays que o upload local já alimenta.

---

## ETAPA 2 — RESPOSTA OBRIGATÓRIA: sistema QR existente OU fluxo próprio?

### ✅ REUTILIZAR O SISTEMA QR EXISTENTE

**Justificativa:**
1. O backend **já suporta** `context_type="session"` (o recurso foi previsto, só ficou órfão). Nenhum endpoint novo é necessário.
2. As fotos Antes/Depois já são apenas **duas arrays de URLs** (`photos_before`/`photos_after`) preenchidas hoje pelo upload local. O QR passa a ser **mais uma origem** para as mesmas arrays → consistência total com o fluxo atual.
3. Criar um fluxo próprio duplicaria endpoints, tokens e a página mobile — mais superfície, mais risco, contra a regra "aditivo e não quebrar".

**Como distinguir Antes de Depois sem tocar em schema:** usar o **`contextId` com sufixo de fase**:
- Antes → `contextId = "{session_id}:before"`
- Depois → `contextId = "{session_id}:after"`

O endpoint `/mobile-upload/files` filtra por `context_id` exato, então os dois conjuntos ficam **naturalmente separados**. O `context_type` permanece `"session"` (valor já existente no `Literal`). Zero mudança de modelo/banco.

---

## ETAPA 3 — PLANO DE IMPLEMENTAÇÃO (proposto, NÃO executado)

### Escopo: **apenas 1 arquivo de frontend**

**Arquivo:** `frontend/src/components/AttendanceDialog.jsx`
**Componentes reutilizados (sem alteração):** `MobileUploadQR.jsx`, `MobileUpload.jsx`, `PhotoUploader.jsx`
**Endpoints (todos já existentes, sem alteração):** `POST /mobile-upload/init`, `GET /mobile-upload/verify/{token}`, `POST /mobile-upload/upload`, `GET /mobile-upload/files/{token}`, `PUT /attendance/{session_id}` (autosave).

**Alterações em `AttendanceDialog.jsx` (aditivas):**
1. Novo estado: `qr = { open: false, phase: null }` (`phase` = "before" | "after").
2. Ao lado de cada `PhotoUploader` (Antes/Depois) na aba "evolucao", adicionar botão **"Capturar via QR Code"** (oculto quando `locked`). O botão de "Adicionar Localmente" continua sendo o `PhotoUploader` atual, intocado.
3. Montar **um** `<MobileUploadQR>` controlado por `qr.open`:
   - `contextType="session"`
   - `contextId={`${session.session_id}:${qr.phase}`}`
   - `contextLabel={qr.phase === "before" ? "Fotos Antes" : "Fotos Depois"}`
   - `onUploaded={(urls) => mergePhotos(qr.phase, urls)}`
4. `mergePhotos(phase, urls)`: faz **união deduplicada** das urls recebidas com `session.photos_before`/`photos_after` e chama `setSessionField(...)` → **autosave existente persiste** (mesmo caminho do upload local).

### Backend: **NENHUMA alteração** (comportamento órfão de "session" passa a ser consumido pelo frontend).

### (Opcional, fora do escopo mínimo) Evento de auditoria na timeline
- Registrar `clinical_event` "Foto (antes/depois) capturada via QR" exigiria toque no backend. **Não incluído** no escopo mínimo — as fotos já aparecem no prontuário/timeline via as arrays. Pode virar um PROMPT posterior.

---

## IMPACTOS
- Usuário ganha "Capturar via QR Code" nas fotos Antes e Depois, com câmera do celular, sem sair do atendimento.
- Prontuário e timeline refletem as fotos automaticamente (mesma origem de dados).

## RISCOS E MITIGAÇÃO
- **Duplicação de foto:** mitigada por união deduplicada em `mergePhotos` (o polling retorna todas as urls do contexto).
- **Atendimento finalizado (locked):** botão QR oculto/desabilitado quando `locked` — não permite alterar atendimento imutável.
- **Isolamento antes/depois:** garantido pelo sufixo de `contextId`.
- **Perda de dados:** as urls são persistidas pelo autosave já existente (mesmo mecanismo do upload local), sobre storage agora permanente (PROMPT 01).

## COMPATIBILIDADE
- **Total.** Fluxo de atendimento, finalização, assinatura, anamnese-QR e upload local permanecem idênticos. Nada é removido; apenas botões e um diálogo são adicionados.

## ROLLBACK
- Reverter `AttendanceDialog.jsx` (arquivo único). Sem estado persistido novo, sem migração → rollback instantâneo.

---

## PLANO DE TESTES (proposto — NÃO executar sem autorização)
1. **QR Antes:** abrir atendimento → aba Evolução → "Capturar via QR Code" em *Antes* → escanear → tirar foto no celular → confirmar → foto aparece em *Antes* no desktop (polling) e some da fila.
2. **QR Depois:** repetir para *Depois* → foto entra **somente** em *Depois* (isolamento por `contextId`).
3. **Persistência/autosave:** fechar e reabrir o atendimento → fotos QR continuam nas arrays corretas.
4. **Prontuário/Timeline:** finalizar → verificar fotos Antes/Depois no prontuário e na timeline do paciente.
5. **Regressão upload local:** "Adicionar Localmente" continua funcionando em Antes/Depois.
6. **Regressão anamnese-QR:** QR de fotos da anamnese (FichaForm) inalterado.
7. **Locked:** atendimento finalizado não exibe botão QR; reabertura com justificativa mantém fotos.
8. **Dedupe:** múltiplos envios não duplicam a mesma url.

Validação de frontend (Playwright/Testing Agent) **somente após sua autorização explícita**.

---

## ENTREGÁVEL
Este documento: `/app/memory/PLANO_QR_FOTOS_ANTES_DEPOIS.md`.

## PRÓXIMO PASSO
**Aguardando sua autorização.** Nenhuma linha será alterada até você aprovar. Ao aprovar, confirme também se deseja apenas o **escopo mínimo (frontend-only)** ou **+ evento de auditoria na timeline** (que adiciona um pequeno toque no backend).
