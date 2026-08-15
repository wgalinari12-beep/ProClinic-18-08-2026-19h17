# PLANO — DOSSIÊ CLÍNICO PREMIUM (PDF JURÍDICO CONSOLIDADO)
## ProClinic Luxury Edition
### Modo: AUDITORIA + PLANEJAMENTO (NENHUM código alterado, NENHUM teste executado)
Status: **AGUARDANDO APROVAÇÃO DO USUÁRIO**

---

## 0. RESUMO EXECUTIVO

**Boa notícia: 90% dos dados e da infraestrutura já existem.** O `finalize_attendance` já **congela** um documento `medical_records` com praticamente tudo que o Dossiê exige, e já há um pipeline de PDF maduro (`xhtml2pdf`/pisa) com dois geradores muito próximos do objetivo (`prontuario-pdf` e `ficha-pdf`).

O Dossiê Premium é, portanto, **um novo gerador de PDF que consolida por atendimento (1 `session_id`)** os dados já congelados — e não um novo modelo de dados.

**Único gap técnico relevante:** as fotos hoje são referenciadas por `<img src="/api/files/...?sig=">`, mas o pisa é chamado **sem `link_callback`** → as imagens **não renderizam** no PDF atual. O Dossiê precisará **embutir as fotos como base64** (via `get_object`).

---

## ETAPA 1 — AUDITORIA: o que já existe / exportável / adaptar / novo

### Infraestrutura de PDF (já existe)
- Motor: `xhtml2pdf` (`pisa`, import em `server.py:20`). `pypdf 6.13.2` também disponível (permite *merge* de PDFs).
- Geradores existentes:
  - `patient_prontuario_pdf` — `GET /patients/{id}/prontuario-pdf` (`:3503`): renderiza sessões (evolução, observações, protocolo, prescrição), **ficha por módulo** (`_render_module_html`) e **blocos de assinatura com nome, data/hora, IP e SHA-256**. Suporta filtros por período/profissional/tipo. **É o mais próximo do Dossiê**, porém é por-paciente (multi-sessão).
  - `patient_ficha_pdf` — `GET /patients/{id}/ficha-pdf` (`:3776`): todos os 6 módulos + galeria de fotos (fotos **não renderizam** — ver gap).
  - `_build_receipt_pdf` (`:1026`), `export_finance_pdf` (`:1469`), `_build_pdf_html` (documentos/TCLE com QR, `:4742`), invoice PDF.

### Fonte de dados congelada (já existe) — `finalize_attendance` (`:2478`)
Grava em **`db.medical_records`** por sessão: `evolution`, `observations`, `protocols`, `prescriptions`, `photos_before`, `photos_after`, `consent_signature(+_meta)`, `evolution_signature(+_meta)` com **`signed_at`, `signed_by_name`, `ip`, `sha256`**, **`ficha_snapshot`** dos 6 módulos (`answers` + `photos` + `captured_at`), `session_number` (**ATT-YYYY-######**), `duration_seconds`, `professional_name`, `procedure`, timestamps. É **snapshot imutável** (integridade jurídica).

### Consolidação por sessão (já existe) — `_build_patient_timeline` (`:3361`)
Para cada sessão reúne: `medical_record`, `appointment`, `financial_entries`, `budget`, `receipts`, `ficha_snapshot`, `signed_documents` (TCLE etc.), `signatures` + `clinical_events`.

### Mapa item-a-item do Dossiê solicitado
| Seção pedida | Situação | Fonte |
|---|---|---|
| **Identificação** (nome, CPF, nasc., telefone, e-mail, endereço) | ✅ Existe | `db.patients` (`email`/`address` em `:89-90`); header atual mostra só nome/CPF/nasc/tel → **adaptar** p/ incluir e-mail/endereço |
| **Info do atendimento** (data, hora, profissional, procedimento, tempo, status) | ✅ Existe | `attendance_sessions`/`medical_records` (`started_at`, `finalized_at`, `duration_seconds`, `status`) |
| **Anamnese Premium** (histórico, medicamentos, patologias, alergias, contraindicações) | ✅ Existe | `ficha_snapshot["geral"].answers` (render genérico via `_render_module_html`) |
| **Ficha Facial** (campos, escalas, observações) | ✅ Existe | `ficha_snapshot["facial"]` |
| **Ficha Corporal** (IMC, classificação, perimetria, adipometria, Petroski) | ⚠️ Dados existem; render **genérico** | `ficha_snapshot["corporal"]` → **adaptar** formatação premium |
| **Ficha Capilar** (Norwood, Savin, displasias, tricoscopia) | ⚠️ Dados existem; render genérico | `ficha_snapshot["capilar"]` → **adaptar** |
| **Ficha Epilação** (Fitzpatrick, características, observações) | ✅ Existe | `ficha_snapshot["epilacao"]` |
| **Ficha Injetáveis** (mapa facial, locais, produtos, quantidades, obs.) | ⚠️ Dados existem; **mapa visual** não é imagem | `ficha_snapshot["injetaveis"]` → **adaptar** (listar pontos; mapa visual = componente novo opcional) |
| **Evolução** (texto, IA, protocolos, contraindicações, resumo) | ✅ Existe | `evolution`/`observations`/`protocols` (a IA escreve nesses campos) |
| **Fotografias** (antes, depois, galeria) | ⚠️ Dados existem; **não renderizam no PDF** | `photos_before/after` + `ficha_snapshot[*].photos` → **novo componente base64** |
| **Assinaturas** (paciente, profissional, data/hora, metadados) | ✅ Existe (grau jurídico) | `*_signature_meta` (signed_at, signed_by_name, IP, SHA-256) |
| **Documentos** (TCLE, receitas, prescrições, recibos, orçamentos) | ✅ Existe como metadados/links | `signed_documents`, `receipts`, `budget`, `prescriptions` → **adaptar** (anexo/QR) ou **novo** (merge pypdf) |
| **Timeline** (resumo cronológico) | ✅ Existe | `clinical_events` + sessão |

**Resumo:** *Já existe* toda a base de dados. *Já exportável* boa parte via `prontuario-pdf`/`ficha-pdf`. *Adaptar*: consolidar por 1 `session_id`, formatar escalas premium, header com e-mail/endereço. *Novo*: (1) endpoint do Dossiê, (2) embed de fotos/assinaturas em base64, (3) opcional: merge de PDFs anexos (pypdf) e mapa visual de injetáveis.

---

## ETAPA 2 — ARQUITETURA RECOMENDADA

- **Reutilizar o pipeline atual** `HTML → pisa.CreatePDF` (consistência com prontuário/ficha; sem nova dependência).
- **Novo endpoint:** `GET /attendance/{session_id}/dossie-pdf` (autenticado, `forbid_recepcao_clinical`).
  - Fonte primária: `medical_records` da sessão (snapshot congelado) + complementos do `_build_patient_timeline` filtrado ao `session_id` (documentos, recibos, orçamento, eventos).
  - Monta **um HTML premium auto-contido** com todas as seções na ordem pedida.
- **Novo helper de imagem:** `_img_data_uri(url_or_path)` → resolve `storage_path`, chama `get_object`, retorna `data:<mime>;base64,...`. Usado em fotos antes/depois, galeria de anamnese e nas assinaturas (que já são base64/PNG). **Resolve o gap das imagens.**
- **Formatação premium (adaptação):** blocos dedicados para escalas (IMC + classificação, perimetria, adipometria, Petroski, Norwood/Savin, Fitzpatrick) e para injetáveis (tabela de locais/produtos/quantidades). Reutiliza `ficha_snapshot`.
- **Documentos anexos:** 
  - *Fase 1 (recomendada):* seção "Documentos e Anexos" listando TCLE/recibos/orçamentos com nº, status, data e **QR/link** para o PDF original (permanente após PROMPT 01).
  - *Fase 2 (opcional):* **merge real** dos PDFs (TCLE, recibos) num único arquivo mestre via `pypdf` (append de páginas).

## ETAPA 3 — ESTRATÉGIA DE GERAÇÃO
- **Server-side, a partir do snapshot congelado** (`medical_records`) → garante que o Dossiê reflita o estado no finalize (valor jurídico).
- **Idempotência/regeneração:** cada geração produz novo arquivo versionado (timestamp no path), registrando `sha256`. Regenerar é permitido (reflete fotos/documentos adicionados após o finalize).

## ESTRATÉGIA DE ARMAZENAMENTO
- Persistir no **Object Storage** (`put_object`) + registro em `db.files` com `kind="dossie_pdf"`, `patient_id`, `session_id`, `sha256`, `signature` (URL permanente — PROMPT 01). Mesmo padrão de `ficha-pdf`/`prontuario-pdf`.

## ESTRATÉGIA JURÍDICA
- Cabeçalho com clínica (nome, **CNPJ**), `session_number` (ATT-YYYY-######) e data/hora de emissão.
- Assinaturas com **nome, data/hora, IP e SHA-256** (já disponíveis).
- **Hash SHA-256 do PDF final** impresso no rodapé + armazenado (prova de integridade).
- **QR de validação pública** reutilizando o padrão de `GET /public/documents/{token}/validate` (`:4936`) — opcional, cria um validador de dossiê.
- Rodapé "documento gerado eletronicamente / íntegro".

## ESTRATÉGIA DE AUDITORIA
- Registrar `clinical_event` `type="dossie_generated"` (label "Dossiê Clínico gerado"), com `session_id`, `user`, `sha256`, `url`, `at` (reutiliza `_log_clinical_event`). Aparece na timeline. Opcional: `audit_logs`.

---

## ETAPA 4 — RESPOSTA OBRIGATÓRIA: A (sob demanda) ou B (automático no finalize)?

### ✅ RECOMENDAÇÃO: **A — sob demanda** (com B como opção opt-in futura)

**Justificativa:**
1. **Performance do finalize:** gerar um PDF pesado (fotos em base64, possível merge) a CADA finalize adicionaria latência ao passo mais crítico do atendimento. Sob demanda mantém o finalize rápido e confiável.
2. **Frescor do documento:** fotos via QR e documentos (TCLE/recibos) podem ser adicionados/assinados **após** o finalize. Sob demanda gera sempre a versão mais completa; automático no finalize "congelaria cedo demais".
3. **Custo/armazenamento:** evita gerar e guardar dossiês que ninguém solicitou.
4. **Integridade preservada:** mesmo sob demanda, a fonte é o snapshot congelado (`medical_records`) → o conteúdo clínico não muda; apenas anexos aditivos podem ser incluídos.

**Opção B (opt-in):** um flag por clínica "gerar Dossiê automaticamente ao concluir" pode ser adicionado depois, chamando o mesmo gerador de forma assíncrona (sem bloquear o finalize).

---

## ARQUIVOS/COMPONENTES ENVOLVIDOS (proposta)
- **Backend:** `backend/server.py` — novo endpoint `GET /attendance/{session_id}/dossie-pdf`, helper `_img_data_uri`, helpers de formatação de escalas, (opcional) merge `pypdf`. Reutiliza `_render_module_html`, `_build_patient_timeline`, `put_object`, `make_file_signature`, `_log_clinical_event`.
- **Frontend:** botão "Gerar Dossiê Clínico" no `AttendanceDialog` (estágio concluído) e/ou em `PatientDetail`/`Documentos` (abrir a URL do PDF). 

## IMPACTOS / RISCOS / COMPATIBILIDADE / ROLLBACK
- **Impacto:** recurso novo e isolado; nada existente muda de comportamento.
- **Riscos:** (a) PDFs grandes com muitas fotos → mitigar com limite/resize e paginação; (b) `get_object` de muitas imagens → mitigar com cache/limite por seção; (c) merge pypdf de PDF corrompido → try/except por anexo. 
- **Compatibilidade:** total; nenhum dado/campo/coleção alterado (só leitura + novo arquivo em `db.files`).
- **Rollback:** remover o endpoint/botão; sem migração; dossiês já gerados continuam válidos como arquivos normais.

---

## PLANO DE TESTES (proposto — NÃO executar sem autorização)
1. Atendimento concluído → "Gerar Dossiê" → PDF abre com todas as seções na ordem pedida.
2. **Fotos** antes/depois e galeria de anamnese **aparecem** (base64) — valida o gap corrigido.
3. **Assinaturas** renderizadas com nome, data/hora, IP e SHA-256.
4. **Escalas** (IMC/Petroski/Norwood/Fitzpatrick) e **injetáveis** formatados.
5. **Documentos/recibos/orçamentos** listados (Fase 1) ou anexados (Fase 2).
6. **Timeline** cronológica presente.
7. **Jurídico:** hash do PDF no rodapé + `session_number` + CNPJ; (se habilitado) QR de validação resolve.
8. **Auditoria:** evento "Dossiê Clínico gerado" na timeline.
9. **Persistência/permanência:** reabrir a URL do dossiê depois (URL permanente — PROMPT 01).
10. **Regressão:** `prontuario-pdf`, `ficha-pdf`, recibos e documentos inalterados.

Validação (Playwright/Testing Agent) **somente após autorização explícita**.

---

## ENTREGÁVEL
Este documento: `/app/memory/PLANO_PDF_CLINICO_PREMIUM.md`.

## PRÓXIMO PASSO
**Aguardando sua aprovação.** Ao aprovar, confirme:
- **Trigger:** A (sob demanda, recomendado) ou B (automático no finalize)?
- **Documentos anexos:** Fase 1 (listar + QR/link) ou Fase 2 (merge real dos PDFs via pypdf)?
- **Mapa visual de injetáveis:** incluir agora (componente novo) ou listar pontos em texto por enquanto?
