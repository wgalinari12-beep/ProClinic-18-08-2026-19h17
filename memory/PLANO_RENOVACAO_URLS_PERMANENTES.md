# PLANO — RENOVAÇÃO AUTOMÁTICA / PERMANÊNCIA DE URLs
## ProClinic Luxury Edition
### Modo: AUDITORIA + PLANEJAMENTO (NENHUM código alterado, NENHUM teste executado)
Data: 15/08 (sessão atual) · Autor: agente principal (read-only) · Status: **AGUARDANDO APROVAÇÃO DO USUÁRIO**

---

## 0. RESUMO EXECUTIVO (leia isto primeiro)

**Descoberta central que muda tudo:** o que o projeto chama de "URL assinada" **NÃO é** uma URL pré-assinada do provedor de storage (tipo S3 presigned com expiração no lado do storage). É um **JWT interno do próprio ProClinic** (`make_file_signature`) que é anexado como query param `?sig=<jwt>` ao endpoint interno `GET /api/files/{path}`.

Consequências diretas:
1. **O arquivo físico no Object Storage NUNCA expira.** Ele é buscado server-side (`get_object`) usando uma `storage_key` que o backend renova sozinho (auto-refresh em erro 403). Não há TTL no arquivo.
2. **A ÚNICA coisa que expira é o JWT `sig`** (validade de 365 dias, `server.py:1983`).
3. O caminho real do arquivo (`storage_path`, um UUID) fica **sempre persistido** em `db.files`, junto com a assinatura. Ou seja, **uma nova assinatura pode ser gerada a qualquer momento** — o "material" para permanência já existe.
4. O ponto de falha é **um único endpoint**: `serve_file` (`server.py:2041`). Quando o `sig` está expirado, ele responde **401 "Link de imagem expirado"** (falha dura), mesmo o arquivo existindo intacto no storage e o registro existindo no banco.

**Portanto o risco é real, porém a superfície é pequena e a correção é cirúrgica.** Não é necessário migrar dados, nem tocar em cada coleção, nem criar cron. Recomenda-se **Opção B** (detalhada na Etapa 3), implementável com alteração mínima e 100% retrocompatível com todas as URLs já gravadas.

---

## ETAPA 1 — AUDITORIA: pontos que usam "URLs assinadas"

Todos os artefatos abaixo seguem o MESMO mecanismo (`storage_path` no Object Storage + JWT `sig` de 365d + servidos por `/api/files/{path}?sig=`).

| # | Artefato clínico | Onde é criado | Persistência |
|---|---|---|---|
| 1 | Upload genérico (fotos clínicas, anexos) | `POST /api/uploads` (`server.py:1993`, retorna url em `:2031`) | `db.files` + URL embutida em `answers`/`photos` dos módulos |
| 2 | Fotos da anamnese (antes/depois, facial, corporal, capilar) | módulos de anamnese; helper `_validate_photo_url` (`:2186`) | array `photos[]` em `db.anamnesis_modules` (URL completa) |
| 3 | Fotos enviadas por **QR Code (mobile)** | `POST /api/mobile-upload/upload` (`:4196/4213`) | `db.files` (com `context_type/context_id`) + módulo alvo |
| 4 | Listagem de uploads mobile (polling desktop) | `GET /api/mobile-upload/files/{token}` (`:4235`, url em `:4249`) | reconstrói URL a partir de `db.files.signature` salva |
| 5 | Recibos financeiros (PDF) | `_persist_receipt_pdf` (`:1089`, url em `:1101`) | `db.files` + `receipt_url` em lançamentos financeiros |
| 6 | Documentos jurídicos / termos (PDF) | geração de PDF (`:3679/3690`) | `db.files` + URL no documento |
| 7 | Documentos gerados (2ª rota) | (`:3861/3871`) | `db.files` + URL no documento |
| 8 | Upload de documento público (assinatura remota) | rota pública de documento (`:4787/4801`) | `db.files` + URL no documento |
| 9 | Outro ponto de persistência de arquivo | (`:5801/5809`) | `db.files` |
| 10 | Assinaturas (paciente/profissional) | armazenadas como **base64 PNG** em campos do documento (`patient_signature`, `signature`) — ver nota abaixo | `db.documents` / `db.anamnesis_modules` |

**Nota sobre assinaturas:** as assinaturas manuscritas são gravadas majoritariamente como **base64** dentro do próprio documento (`payload["signature"]`, `patient_signature` em `:3126`, `:4867`; `evolution_signature` em `:2560`), **não** como arquivo com URL assinada. Logo, **assinaturas em base64 não têm risco de expiração de URL**. Só entram no risco quando a assinatura/documento é renderizada em PDF e esse PDF é salvo como arquivo (itens 6–8).

**Metadados sempre presentes em `db.files`** (garante recuperação): `file_id`, `storage_path`, `content_type`, `clinic_id`, `is_deleted`, `signature`, `created_at`, e (mobile) `context_type/context_id`.

---

## ETAPA 2 — MAPEAMENTO TÉCNICO (ciclo de vida da URL)

- **Onde a URL é criada:** função única `make_file_signature(file_id, clinic_id)` (`server.py:1977`) → gera JWT `{scope:"file_sig", fid, clinic, exp: now+365d}` assinado com `JWT_SECRET`. A URL final é `/api/files/{storage_path}?sig={jwt}`.
- **Onde é armazenada:** (a) a assinatura crua em `db.files.signature`; (b) a URL completa (com `?sig=`) embutida em documentos/lançamentos/arrays de fotos das coleções de negócio.
- **Onde é consumida:** frontend renderiza `REACT_APP_BACKEND_URL + url`. O backend serve em `GET /api/files/{path}` (`:2041`):
  1. valida o `sig` (JWT). Se válido e existir registro em `db.files` (por `storage_path` + `clinic`), busca o binário via `get_object(path)` e retorna.
  2. **se o `sig` estiver expirado → `raise 401 "Link de imagem expirado"` (`:2056-2057`).** ← ÚNICO PONTO DE FALHA.
  3. fallback: autenticação de usuário (`auth` query token ou sessão) → mesma busca por `storage_path`.
- **Onde expira:** somente o claim `exp` do JWT (365 dias, `:1983`). O arquivo no storage e o registro em `db.files` **não expiram**.
- **Onde é renovada:** **em lugar nenhum.** Não há renovação. `mobile-upload/files` (`:4249`) apenas reusa a `signature` original salva (que também expira em 365d).
- **Onde NÃO existe renovação:** todos os itens da Etapa 1.

**Outras expirações relacionadas (contexto, fora do escopo principal, apenas registro):**
- Token de upload por QR (mobile): 20 min (`:4143`) — por design (janela curta de captura). OK.
- Token público de documento (assinatura remota): 180 dias (`:4439`).
- Tokens diversos: 30 dias (`:4034`), 60 dias (`:2889`). Sessão: 7 dias (`:492/501`).

Esses tokens de fluxo/uso não são "URLs de arquivo" e **não** causam perda de evidência clínica; ficam de fora deste plano (podem virar um PROMPT separado se desejado).

---

## ETAPA 3 — ANÁLISE DE RISCO E DECISÃO ARQUITETURAL

### Pergunta: A) renovar URLs automaticamente, ou B) guardar só a chave e gerar URL sob demanda?

### ✅ RECOMENDAÇÃO: **Opção B** (guardar só a chave / validar-gerar sob demanda)

**Justificativa técnica:** a Opção B **já está 95% implementada** sem que o projeto perceba. O `storage_path` (a "chave") já é sempre persistido em `db.files`, e `serve_file` já resolve o arquivo **pela chave**, não pela URL. O `sig` é apenas um verificador de integridade/autorização. Basta **parar de tratar o `sig` expirado como fatal**: quando expirar, revalidar contra `db.files` pela chave e servir mesmo assim. Isso torna toda URL — antiga ou nova — **permanente**, sem migração e sem cron.

| | **Opção A — Renovar automaticamente** | **Opção B — Chave + geração sob demanda (RECOMENDADA)** |
|---|---|---|
| Vantagens | URLs "novas" ficam sempre válidas | Correção em 1 ponto; **retrocompatível com TODAS as URLs já salvas**; sem migração; sem cron; sem varrer coleções |
| Desvantagens | Precisa varrer TODAS as coleções (documentos, financeiro, anamnese, files); cron/job; migração massiva; risco de tocar dados clínicos; janela onde algo pode falhar | O `sig` deixa de garantir expiração temporal (aceitável: `storage_path` é UUID não-adivinhável e o JWT continua assinado por `JWT_SECRET`) |
| Esforço | Alto (job + migração + testes amplos) | Baixo (edição cirúrgica em `serve_file`) |
| Risco a dados | Médio/Alto (escreve em coleções clínicas) | Muito baixo (endpoint é read-only ao servir) |

**Segurança da Opção B:** o `sig` é um JWT assinado com `JWT_SECRET` → **não forjável**. O `storage_path` é um `uuid4` → **não adivinhável/enumerável**. O escopo de clínica (`clinic`) pode ser lido do JWT mesmo expirado (`options={"verify_exp": False}`) para manter o isolamento multi-tenant. Aceitar um `sig` **expirado porém integralmente válido** apenas reconhece que aquele link foi **legitimamente emitido** — mantém a postura de segurança atual.

---

## ETAPA 4 — PLANO DE IMPLEMENTAÇÃO (proposto, NÃO executado)

### Mudança principal (obrigatória) — tornar `serve_file` tolerante a `sig` expirado
- **Arquivo:** `backend/server.py`
- **Função:** `serve_file` (`:2041`)
- **Endpoint:** `GET /api/files/{path}`
- **O quê:** no bloco `except jwt.ExpiredSignatureError` (`:2056`), em vez de `raise 401`, decodificar o token com `options={"verify_exp": False}` para obter o claim `clinic`, revalidar o registro em `db.files` por `storage_path`+`clinic`+`is_deleted:False`; se existir, servir normalmente via `get_object(path)`. Se não existir registro, aí sim negar (404/401).
- **Efeito:** cobre **imediatamente** todas as URLs antigas e novas já persistidas. Zero migração.

### Mudança secundária (opcional, defensiva) — parar de "nascer" com expiração
- **Arquivo:** `backend/server.py` · **Função:** `make_file_signature` (`:1977`)
- **O quê:** aumentar `exp` para prazo muito longo (ex.: 100 anos) **ou** remover o claim `exp` para `sig` de arquivos de acervo clínico. Assim novos `sig` já nascem praticamente permanentes. (A mudança principal já resolve; esta é reforço.)
- **Cuidado:** manter o `scope:"file_sig"` e a assinatura por `JWT_SECRET` inalterados.

### O que NÃO será tocado
- Object Storage (`init_storage`/`put_object`/`get_object`) — inalterado.
- Coleções `db.documents`, `db.anamnesis_modules`, financeiro, `db.files` — **nenhuma escrita/migração**.
- Fluxos de QR (20 min), token público de documento (180 d), sessão (7 d) — fora do escopo.
- Frontend — nenhuma alteração necessária (URLs continuam idênticas).

### Impactos
- Prontuários, fotos (incl. QR), PDFs, recibos e documentos passam a ser **sempre acessíveis**, independentemente de idade da URL.
- Nenhuma quebra de contrato de API (mesma rota, mesmo formato de URL/resposta).

### Riscos e mitigação
- Risco: aceitar `sig` expirado enfraquece o TTL. Mitigação: `storage_path` UUID não-enumerável + JWT assinado + isolamento por `clinic` lido do próprio token; mantém `is_deleted` e escopo de clínica.
- Risco: token com assinatura inválida/adulterada. Mitigação: `jwt.decode` sem `verify_exp` **ainda verifica a assinatura**; token adulterado continua rejeitado.

### Rollback
- Mudança isolada em 1 (ou 2) funções. Rollback = reverter o bloco `except ExpiredSignatureError` ao `raise 401` original. Sem estado persistido alterado → rollback instantâneo e sem resíduos.

### Compatibilidade com dados antigos
- **Total.** Como a resolução passa a ser pela chave (`storage_path`) já gravada em `db.files`, qualquer URL histórica (mesmo com `sig` expirado há anos) volta a funcionar sem tocar no dado salvo.

---

## PLANO DE TESTES (proposto — NÃO executar agora)

Backend (após aprovação):
1. **URL nova válida** → `GET /api/files/{path}?sig=<válido>` retorna 200 + binário correto.
2. **URL com `sig` expirado, arquivo existente** → 200 (antes: 401). *(cenário-chave da correção)*
3. **`sig` expirado + `storage_path` inexistente/removido (`is_deleted`)** → 404/401 (nega corretamente).
4. **`sig` adulterado (assinatura inválida)** → negado (integridade preservada).
5. **Isolamento multi-tenant:** `sig` expirado da clínica A não serve arquivo da clínica B.
6. **Fallback de auth de usuário** continua funcionando sem `sig`.
7. **Regressão:** uploads, recibos (PDF), documentos (PDF), fotos QR e listagem `mobile-upload/files` seguem servindo normalmente.

Frontend (somente com autorização explícita do usuário, conforme protocolo):
8. Abrir prontuário antigo, PDFs, recibos e fotos (inclui QR) e confirmar renderização.

Evidência: registrar resultados e (se frontend for aprovado) screenshots do testing agent.

---

## ENTREGÁVEL
Este documento: `/app/memory/PLANO_RENOVACAO_URLS_PERMANENTES.md`.

## PRÓXIMO PASSO
**Aguardando sua autorização.** Nenhuma linha de código foi ou será alterada até você aprovar. Ao aprovar, informe também se deseja apenas a **Mudança principal** (recomendada, mínima) ou **principal + secundária** (reforço).
