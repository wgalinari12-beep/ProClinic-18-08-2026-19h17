# AUDITORIA DO `AttendanceDialog` — ProClinic

> **Escopo:** análise 100% read-only do componente `/app/frontend/src/components/AttendanceDialog.jsx` (528 linhas) — o coração da experiência clínica.
> **Regra do usuário:** NÃO IMPLEMENTAR. NÃO ALTERAR. APENAS DOCUMENTAR.
> **Autor:** E1 (Fev/2026)

---

## 1. ESTRUTURA GERAL DO COMPONENTE

### 1.1 Metadados
| Item | Valor |
| --- | --- |
| Arquivo | `/app/frontend/src/components/AttendanceDialog.jsx` |
| Linhas | 528 |
| Tipo de export | `export default function AttendanceDialog` |
| Props recebidas | `{appointment, open, onOpenChange, onCompleted}` |
| Renderiza | `<Dialog>` fullscreen do shadcn (max-w-4xl, max-h-[92vh], overflow-hidden) |
| Comportamento de fechamento | Bloqueia clique/tecla fora (`onPointerDownOutside={e => e.preventDefault()}` + `onInteractOutside`) — só fecha via botões internos |

### 1.2 Máquina de estados (`stage`)
```
      loading  ──►  completion  ──►  inProgress  ──►  (done)
         │                              │
         └──────────────────────────────┘
```
- `loading` — spinner enquanto carrega completeness + session (linhas 300-304).
- `completion` — form de complementação de cadastro (só se paciente incompleto) (linhas 307-350).
- `inProgress` — tela principal com 5 abas (linhas 354-479).
- `done` — tela de sucesso (linhas 482-493) — **prática: nunca chega aqui**, o `confirmFinalize` chama `onOpenChange(false)` direto (linha 251), fechando o dialog.

### 1.3 Layout físico
```
┌──────────────────────────────────────────────────────┐
│ HEADER (border-b)                                    │
│   • title = appointment.patient_name                 │
│   • description = procedure · professional           │
│   • Timer HH:MM:SS (só em inProgress)                │
│   • Botão "Documento" (só em inProgress)             │
│   • Badge "Rascunho salvo HH:MM" (após 1º autosave)  │
├──────────────────────────────────────────────────────┤
│                                                      │
│   BODY (flex-1, overflow-y-auto)                     │
│   • condicional por stage                            │
│                                                      │
├──────────────────────────────────────────────────────┤
│ FOOTER (border-t) — só em stage=inProgress           │
│   • "Salvar rascunho e sair" (ghost)                 │
│   • "Concluir atendimento" (primary)                 │
└──────────────────────────────────────────────────────┘
   + <CompletePaymentDialog>   ← sub-dialog aninhado
   + <DocumentGenerator>       ← sub-dialog aninhado
```

---

## 2. TODOS OS ESTADOS REACT (`useState`)

| # | Estado | Tipo inicial | Uso | Onde muda |
| --- | --- | --- | --- | --- |
| 1 | `stage` | `"loading"` | Máquina de estados | Effect L70 (após completeness+start), completion save L172, close reset L153 |
| 2 | `patient` | `null` | Dados completos do paciente | L77 após completeness |
| 3 | `session` | `null` | Doc de `attendance_sessions` | L87 após start, L115 no autosave (patch merge), L138 após PUT response |
| 4 | `tab` | `"ficha"` | Aba ativa nas Tabs | L154 reset ao fechar; L217 força "assinatura" se assinatura ausente |
| 5 | `fichaModule` | `"geral"` | Sub-aba da Ficha (geral/facial/corporal/capilar) | L380 clique nos botões pill |
| 6 | `seconds` | `0` | Cronômetro em segundos | L88 herda `sess.duration_seconds`; L109 setInterval 1s; L152 reset ao fechar |
| 7 | `busy` | `false` | Loading flag global (finalize, savePatient) | L161/176, L220/242 |
| 8 | `savedAt` | `null` | Date do último autosave | L139 após PUT sucesso; L155 reset ao fechar |
| 9 | `aiBusy` | `false` | Loading da IA | L181/190 |
| 10 | `pForm` | `{}` | Formulário de complementação | L78 seed via patient; L321/326/331/336/341 handlers |
| 11 | `linkedBudget` | `null` | Orçamento vinculado ao appointment | L95 setLinkedBudget; L454 onSaved do BudgetEditor |
| 12 | `paymentOpen` | `false` | Abre CompletePaymentDialog | L239 abre no finalize; L249 fecha após confirm |
| 13 | `docGenOpen` | `false` | Abre DocumentGenerator | L284/519 |

### Refs (`useRef`)
| Ref | Uso |
| --- | --- |
| `tickRef` | Handle do `setInterval` do cronômetro (limpo em unmount/close) |
| `saveTimerRef` | Handle do debounce de autosave (limpo antes de novo timeout) |

**Total:** 13 useState + 2 useRef → **15 estados** no total. É um componente denso.

---

## 3. TODOS OS HOOKS UTILIZADOS

| Hook | Local | Finalidade |
| --- | --- | --- |
| `useState` × 13 | Corpo do componente | Estados listados acima |
| `useRef` × 2 | Corpo do componente | Handles de interval/timeout |
| `useEffect` (L70) | Load inicial ao abrir | Fluxo: completeness → start → budgets → stage |
| `useEffect` (L107) | Timer | Inicia setInterval quando stage="inProgress"; cleanup em unmount |
| `useEffect` (L147) | Reset ao fechar | Limpa tudo quando `open === false` |
| `useMemo` | **NÃO USADO** | ❌ Ausente — pode causar recomputações desnecessárias em derivados |

**Observação:** o componente **NÃO usa `useMemo`, `useCallback` nem `useContext`**. Handlers são recriados a cada render, o que passa novas refs para os filhos (`FichaForm`, `PhotoUploader`, `BudgetEditor`) — potencial re-render em cascata.

---

## 4. ABAS EXISTENTES — DETALHAMENTO POR ABA

### 4.1 Aba **Ficha** (`data-testid="tab-ficha"`)

| Item | Detalhe |
| --- | --- |
| **Objetivo** | Anamnese modular por área (Geral, Facial, Corporal, Capilar) com IMC auto e fotos de avaliação |
| **Sub-abas** | 4 botões pill (geral/facial/corporal/capilar) — `MODULE_OPTIONS` L25-30 |
| **Componente renderizado** | `<FichaForm module=… schema=… patientId=… onAiSummary=…>` |
| **Dados carregados** | `GET /api/anamnesis-modules?patient_id={id}` (dentro do FichaForm, useEffect L45) |
| **Dados salvos** | `POST /api/anamnesis-modules` (upsert por `patient_id + module + user_id`) autosave 900ms |
| **APIs utilizadas** | `/anamnesis-modules` (GET+POST), `/ai/generate` (type=anamnesis_summary), `/mobile-upload/init`, `/uploads` |
| **Validações** | Nenhuma — campos livres. Só schema decide visibilidade condicional (`f.when(answers)`) |
| **Problemas encontrados** | (1) Salva em coleção **DIFERENTE** do `attendance_sessions` — dados nunca são copiados para `medical_records` no finalize; (2) `onAiSummary` injeta em `session.observations` mas dispara **outro autosave** do session — race condition possível com o autosave da ficha; (3) `moduleId` só existe após primeiro save → botão "Capturar pelo celular" fica disabled até então |

### 4.2 Aba **Evolução** (`data-testid="tab-evolucao"`)

| Item | Detalhe |
| --- | --- |
| **Objetivo** | Registrar evolução clínica, protocolo, produtos e fotos antes/depois |
| **Campos** | `observations` (textarea 3r), `evolution` (textarea 6r), `protocols` (textarea 3r), `products_used` (input), `photos_before` (array URLs), `photos_after` (array URLs) |
| **Botões de IA** | "Gerar evolução IA" (`ai-generate-evolution-btn`) + "Sugerir protocolo" (`ai-suggest-protocol-btn`) |
| **Dados carregados** | Vem do `session` já carregado no useEffect L70 |
| **Dados salvos** | `PUT /api/attendance/{session_id}` autosave 800ms via `setSessionField` |
| **APIs utilizadas** | `/attendance/{sid}` (PUT), `/ai/generate` (types=evolution\|protocol), `/uploads` (via PhotoUploader) |
| **Validações** | Nenhuma |
| **Problemas encontrados** | (1) Botões IA usam `session.observations` OU `session.evolution` OU string fallback — sem controle explícito; (2) IA sempre **anexa** ao final com `\n\n` — se profissional clicar 3× seguidos, gera 3 blocos duplicados; (3) `products_used` é string livre sem estrutura (lote/qtd/validade) — impossível auditar depois; (4) fotos antes/depois sem timestamp ou ordem; (5) Sem preview lado-a-lado das fotos |

### 4.3 Aba **Prescrição** (`data-testid="tab-prescricao"`)

| Item | Detalhe |
| --- | --- |
| **Objetivo** | Orientações pós-procedimento e receituário |
| **Campos** | `prescriptions` (textarea 10r) |
| **Dados carregados** | Vem do `session` |
| **Dados salvos** | Autosave 800ms no `session.prescriptions` |
| **APIs utilizadas** | `/attendance/{sid}` (PUT) |
| **Validações** | Nenhuma |
| **Problemas encontrados** | (1) Um único textarea gigante — não estrutura medicamento/posologia/duração; (2) Não gera **PDF de receita** (só o TCLE via DocumentGenerator); (3) Não envia para o paciente automaticamente; (4) Sem template pronto por procedimento (Botox → orientações padrão); (5) Aviso legal ("apenas profissionais habilitados") é apenas informativo — sem gate por role/conselho |

### 4.4 Aba **Orçamento** (`data-testid="tab-orcamento"`)

| Item | Detalhe |
| --- | --- |
| **Objetivo** | Criar/editar orçamento vinculado ao appointment |
| **Componente renderizado** | `<BudgetEditor patientId appointmentId budgetId onSaved>` |
| **Dados carregados** | `linkedBudget` state (buscado no useEffect L91 via `/budgets?patient_id`) |
| **Dados salvos** | POST/PUT `/api/budgets` |
| **APIs utilizadas** | `/budgets` (POST/PUT), `/procedures` (dentro do BudgetEditor) |
| **Validações** | Do BudgetEditor (nenhuma dentro do AttendanceDialog) |
| **Problemas encontrados** | (1) Orçamento é opcional mas é a única fonte confiável de `amount_total` no finalize — se não salvar, cai no fallback `appointment.price` (que pode estar zerado); (2) `linkedBudget?.total` alimenta o `defaultTotal` do CompletePaymentDialog — mas se editar budget e não salvar antes de concluir, o total vem defasado; (3) Não avisa "orçamento não salvo" ao clicar em concluir |

### 4.5 Aba **Assinatura** (`data-testid="tab-assinatura"`)

| Item | Detalhe |
| --- | --- |
| **Objetivo** | Capturar 2 assinaturas em canvas (TCLE do paciente + Evolução do profissional) |
| **Componentes** | 2× `<SignaturePad>` |
| **Campos** | `consent_signature` (base64 PNG), `evolution_signature` (base64 PNG) |
| **Dados carregados** | Do `session` |
| **Dados salvos** | Autosave 800ms |
| **APIs utilizadas** | `/attendance/{sid}` (PUT) — assinaturas viajam como base64 no JSON |
| **Validações** | Apenas `evolution_signature` obrigatória (linha 214) — TCLE do paciente é **opcional** |
| **Problemas encontrados** | (1) Base64 no payload → autosave fica pesado (~50-200 KB por assinatura); (2) Não valida assinatura vazia (canvas branco passa); (3) Não há timestamp de assinatura; (4) Sem QR mobile para o paciente assinar do próprio celular (existe no DocumentGenerator mas não aqui); (5) Reassinar sobrescreve sem histórico |

---

## 5. TODOS OS COMPONENTES FILHOS UTILIZADOS

| Componente | Onde é usado | Props passadas |
| --- | --- | --- |
| `Dialog` / `DialogContent` / `DialogHeader` / `DialogTitle` / `DialogDescription` | Wrapper geral | Bloqueio de fechamento externo |
| `Tabs` / `TabsList` / `TabsTrigger` / `TabsContent` | Estrutura do inProgress | `value=tab`, `onValueChange=setTab` |
| `Button` | Vários pontos | Ghost/outline/primary variants |
| `Input`, `Label`, `Textarea` | Campos de formulário | value + onChange |
| `Badge` | "Rascunho salvo HH:MM" | outline |
| `PhotoUploader` × 3 | 2 na aba Evolução (before/after) + 1 dentro da FichaForm | `label`, `testid`, `value`, `onChange`, `accent` |
| `SignaturePad` × 2 | Aba Assinatura | `testid`, `value`, `onChange` |
| `FichaForm` | Aba Ficha | `module`, `schema`, `patientId`, `onAiSummary` |
| `BudgetEditor` | Aba Orçamento | `patientId`, `appointmentId`, `budgetId`, `onSaved` |
| `CompletePaymentDialog` | Sub-dialog (aparece após clicar Concluir) | `open`, `onOpenChange`, `defaultTotal`, `budgetTotal`, `budgetId`, `onConfirm` |
| `DocumentGenerator` | Sub-dialog (aparece via botão Documento) | `open`, `onOpenChange`, `patientId`, `appointmentId`, `procedure`, `procedureValue` |
| Ícones lucide-react | Vários | Clock, AlertCircle, Save, Sparkles, FileSignature, CheckCircle2, ClipboardList, FileText, Pill, Loader2, X, Wallet |
| `toast` (sonner) | Notificações | success/error |
| `MODULE_OPTIONS` + `SCHEMA_*` | Metadata das fichas | Import direto |

**Observação:** o import de `Save` e `X` da lucide-react (linhas 11-12) **NUNCA são usados no JSX** — imports órfãos.

---

## 6. FLUXO DE SALVAMENTO AUTOMÁTICO

### 6.1 Autosave do session (aba Evolução/Prescrição/Assinatura)

```
setSessionField(key, value)
    ↓
autosave({[key]: value})
    ↓
setSession(s => ({...s, ...patch}))    ← atualização otimista imediata
clearTimeout(saveTimerRef.current)
saveTimerRef.current = setTimeout(() => {
    merged = {...session, ...patch, duration_seconds: seconds}
    PUT /api/attendance/{sid} { payload completo do session }
    setSession(response)
    setSavedAt(new Date())
}, 800ms)
```

**Problemas identificados:**
1. **Payload completo a cada autosave** (linhas 120-135): envia SEMPRE todos os campos, mesmo os intocados. Backend usa `exclude_unset=True` mas o JSON já foi para a rede — desperdício de banda em conexões ruins.
2. **`merged = {...session, ...patch}` usa closure de `session`** (linha 119) — se dois autosaves disparam em rápida sucessão, o segundo pode usar `session` desatualizado. **Race condition potencial.**
3. **`duration_seconds` é lido do state `seconds`** no momento do setTimeout, não no momento do trigger. Correto, mas fica bagunçado.
4. **Falha silenciosa** (`catch { /* silent */ }` linha 140) — se um autosave falha, o usuário não sabe. Continua tentando; se salvar tudo no final falhar, perde-se trabalho.
5. **Sem indicador de conflito** — se dois profissionais abrirem a mesma session, ambos autosalvam e o último ganha.

### 6.2 Autosave da FichaForm (aba Ficha)

```
Mudou answer ou photo
    ↓
setTimeout 900ms
    ↓
POST /api/anamnesis-modules { patient_id, module, answers, photos }
    ↓
setModuleId(data.module_id)
setSavedAt(new Date())
```

**Coleção diferente do session**. O autosave da ficha **NÃO** atualiza `attendance_sessions`. Isso significa:
- Ao finalizar, `medical_records` recebe apenas os campos do session (evolution, observations, protocols, prescriptions, products_used, photos_before, photos_after).
- **As respostas da FichaForm (altura, peso, IMC, queixa principal, alergias etc.) NUNCA são copiadas para o prontuário do medical_records.** Ficam apenas no `anamnesis_modules`.

---

## 7. FLUXO DE IA

### 7.1 Pontos de invocação

| Local | Handler | Body enviado | Onde a resposta vai |
| --- | --- | --- | --- |
| Aba Evolução → botão "Gerar evolução IA" | `generateEvolution` L193 | `{type:"evolution", patient_id, notes: obs \|\| evo \|\| "Atendimento padrão", context: procedure}` | Append em `session.evolution` |
| Aba Evolução → botão "Sugerir protocolo" | `suggestProtocol` L203 | `{type:"protocol", patient_id, notes: obs \|\| procedure, context: procedure}` | Append em `session.protocols` |
| Aba Ficha (dentro do FichaForm) → botão "Resumo IA" | `aiSummarize` FichaForm L90 | `{type:"anamnesis_summary", patient_id, notes: campos_da_ficha}` | `onAiSummary(text)` → append em `session.observations` |

### 7.2 Endpoint
- Todos usam `POST /api/ai/generate`.
- Backend: Claude Sonnet 4.5 via EMERGENT_LLM_KEY (server.py:2088+).
- Retorno: `{text: string}`.

### 7.3 Problemas identificados
1. **Cada clique gera NOVO texto anexado** — clicar 3 vezes cria 3 blocos duplicados (não substitui, não pergunta).
2. **Fallback `"Atendimento padrão"`** (L194) — se profissional não escreveu nada, IA gera evolução genérica que pode ser publicada acidentalmente.
3. **Nenhum histórico** — texto gerado pela IA é indistinguível de texto digitado manualmente. Sem auditoria "essa evolução foi 80% IA".
4. **Race condition** — se autosave do session dispara enquanto IA está calculando (10-30s), o resultado da IA pode sobrescrever alterações do usuário.
5. **Sem loading global** — `aiBusy` só desabilita botões; profissional pode continuar editando o textarea enquanto IA processa e ser surpreendido.

---

## 8. FLUXO DE IMAGENS

### 8.1 Pontos de upload
- **Aba Ficha** → PhotoUploader (fotos da avaliação) → `POST /api/uploads` + opcional `MobileUploadQR`
- **Aba Evolução** → 2 PhotoUploaders (antes/depois) → `POST /api/uploads`

### 8.2 Armazenamento
- Backend faz `put_object` no Object Storage e retorna signed URL com `?sig=…`.
- Guardado como array de strings (URLs) em:
  - `anamnesis_modules.photos` (da Ficha)
  - `attendance_sessions.photos_before` / `photos_after` (da Evolução)

### 8.3 Problemas
1. **Signed URLs expiram em 30 dias** (JWT) — depois disso é preciso reassinar; sem mecanismo automático.
2. **Sem metadata por foto** (timestamp, quem tirou, dispositivo) — só a URL.
3. **PhotoUploader não valida tamanho/formato** — pode subir 20MB e travar mobile.
4. **Sem redimensionamento** — imagens de câmera moderna (~4MB cada) inflam o payload.
5. **Fotos da Ficha não migram para o Prontuário** — ficam órfãs em `anamnesis_modules`.
6. **Sem lightbox comparativo** dentro do AttendanceDialog — usa o Lightbox só em PatientDetail.

---

## 9. FLUXO DE ASSINATURA

### 9.1 Captura
- `<SignaturePad>` (react-signature-canvas) → `value` = base64 PNG.
- Handler `onChange(v)` → `setSessionField("consent_signature" \| "evolution_signature", v)`.
- Autosave 800ms envia base64 no payload PUT do session.

### 9.2 Validação
- **Único gate:** `session.evolution_signature` deve ser truthy antes de `Concluir` (L214).
- **Não valida** se canvas está em branco (canvas vazio ainda gera base64 válido).

### 9.3 Uso no finalize
- `medical_records.signature` = `sess.evolution_signature`
- `medical_records.signed` = `bool(sess.evolution_signature)`
- **`consent_signature` do paciente é gravado no session mas NÃO é copiado para o medical_record** — fica órfão.

### 9.4 Problemas
1. TCLE do paciente coletado mas **não é usado no prontuário final** — perde-se a rastreabilidade jurídica.
2. Sem timestamp por assinatura.
3. Sem endereço IP / dispositivo.
4. Sem QR mobile para o paciente assinar no próprio celular (existe no DocumentGenerator, mas não aqui).
5. Reassinar sobrescreve; não há histórico de tentativas.

---

## 10. FLUXO DE ORÇAMENTO

### 10.1 Carregamento
```
useEffect L70 → GET /api/budgets?patient_id={id}
    ↓
Filtra .find(b => b.appointment_id === appointment.appointment_id)
    ↓
setLinkedBudget(budget)
```

### 10.2 Edição
- Aba Orçamento renderiza `<BudgetEditor>` com props → o Editor manipula seu próprio state e chama `POST/PUT /api/budgets`.
- Callback `onSaved(b)` atualiza `linkedBudget` no AttendanceDialog.

### 10.3 Uso no finalize
- `defaultTotal={appointment?.price || 0}` (L511)
- `budgetTotal={linkedBudget?.total}` (L512)
- `budgetId={linkedBudget?.budget_id}` (L513)
- CompletePaymentDialog dá **preferência** ao `budgetTotal` sobre `defaultTotal`.

### 10.4 Problemas
1. **Se profissional editar o orçamento e clicar Concluir sem salvar**, o total antigo é usado. Nenhum aviso.
2. **Se profissional criar orçamento mas fechar/reabrir o dialog**, `linkedBudget` é re-buscado corretamente. ✅
3. **Filtro em memória** (L94) — carrega TODOS os budgets do paciente e filtra no JS. Poderia usar `?appointment_id=` no backend.
4. **Sem indicação visual** se o orçamento está "aprovado", "recusado" ou "rascunho" — só o BudgetEditor mostra.

---

## 11. FLUXO FINANCEIRO

### 11.1 Onde entra
- **NÃO acontece durante o atendimento** — apenas no clique de `Concluir` (linha 502).
- CompletePaymentDialog coleta:
  - `payment_status` (pago/parcial/nao_pago)
  - `amount_total`
  - `amount_paid` (parcial)
  - `payment_method`
  - `due_date`
  - `installments` (1..48) — Fase 2.5B
  - `installment_interval_days` — Fase 2.5B

### 11.2 Chamada
```
confirmFinalize(paymentPayload)
    ↓
POST /api/attendance/{sid}/finalize (payload = paymentPayload)
    ↓
Backend cria N financial_entries + recibos PDF (Fase 2.5C)
```

### 11.3 Problemas
1. **Sem estimativa prévia** — o profissional não vê "vai gerar 6 cobranças de R$X" antes de confirmar.
2. **Sem preview do recibo**.
3. **Sem opção "cobrar entrada agora + resto depois"** com valor customizado por parcela.
4. **`amount_total=budget.total` cega** — se o orçamento estava desatualizado, cobra errado.
5. **Não permite marcar "cortesia"** ou "de nada" (0% pago sem gerar cobrança).
6. **Não vincula comissão do profissional** (não existe).

---

## 12. FLUXO DE GERAÇÃO DE RECIBO

### 12.1 Ponto de disparo
- Automático no backend `finalize_attendance` (server.py:2015) para cada entry com `paid=true`.
- Chama `_generate_receipt_for_entry(entry_id, clinic_id)` (server.py:1010).

### 12.2 Numeração
- `receipt_counters(clinic_id, year)` com `find_one_and_update` + `ReturnDocument.AFTER` → REC-YYYY-####.

### 12.3 O que o AttendanceDialog sabe sobre isso?
- **NADA.** O dialog fecha antes de saber se recibos foram gerados.
- Toast diz "Atendimento concluído e financeiro lançado" independente do resultado dos recibos.
- Se `_generate_receipt_for_entry` falhar, o log de warning é escrito no backend mas o usuário não vê.

### 12.4 Problemas
1. **Sem feedback visual** de "3 recibos gerados: REC-2026-0042, 0043, 0044".
2. **Sem opção de enviar por email/WhatsApp imediatamente** após concluir — usuário precisa ir para PatientDetail aba Financeiro.
3. **Se paciente pagou parcial, só a entrada gera recibo** — parcelas futuras só ao serem pagas depois (correto conceitualmente, mas não é comunicado).

---

## 13. FLUXO DE FINALIZAÇÃO

### 13.1 Sequência (ao clicar em "Concluir atendimento")

```
finalize() L213
    ├── Se !session.evolution_signature:
    │       toast.error + setTab("assinatura")
    │       return
    │
    ├── setBusy(true)
    ├── PUT /api/attendance/{sid} (salva rascunho final com todos os campos)
    ├── setPaymentOpen(true)  ← abre CompletePaymentDialog
    └── setBusy(false)

Usuário preenche pagamento → clica Confirmar no CompletePaymentDialog
    ↓
confirmFinalize(paymentPayload) L245
    ├── POST /api/attendance/{sid}/finalize (com payload de pagamento)
    ├── toast.success
    ├── setPaymentOpen(false)
    ├── onCompleted?.()  ← Agenda.load() re-fetch
    └── onOpenChange(false)  ← FECHA o dialog (não vai para stage="done")
```

### 13.2 Idempotência
- **NÃO idempotente**. Se o usuário clicar Confirmar duas vezes rápido (double-click), o backend cria 2 medical_records + 2N financial_entries + 2N recibos.
- Não há `Idempotency-Key` no header.
- Não há trava frontend robusta — `setBusy(true)` só cobre o PUT do rascunho, não o POST do finalize.

### 13.3 Rollback
- Se o POST `/finalize` falhar após o PUT do rascunho ter sucedido, o session fica salvo mas nada muda no medical/finance. OK.
- Se falhar depois de criar o medical_record mas antes dos financial_entries (falha parcial), **fica inconsistente**. Não há transação MongoDB.

### 13.4 Problemas
1. **Double-click cria duplicatas** (crítico).
2. **stage="done" nunca é usado** — código morto (L482-493).
3. **Após finalizar, dialog fecha sem confirmação visual** — usuário vê o toast e a agenda atualiza; sem "página de sucesso" com opções (imprimir recibo, agendar retorno, enviar TCLE).
4. **Sem transação atômica** medical + financial + budget → inconsistência possível em falhas parciais.

---

## 14. CAMPOS OBRIGATÓRIOS vs OPCIONAIS vs NUNCA USADOS

### 14.1 Obrigatórios (bloqueiam ação)
| Campo | Onde | Ação bloqueada |
| --- | --- | --- |
| `pForm.name`, `pForm.cpf`, `pForm.birth_date`, `pForm.phone`, `pForm.lgpd_consent` | stage=completion | Backend `/completeness` bloqueia iniciar atendimento |
| `session.evolution_signature` | stage=inProgress | Clique em Concluir (L214) |

### 14.2 Opcionais (podem ficar em branco)
- `session.evolution`, `observations`, `protocols`, `prescriptions`, `products_used`
- `session.photos_before`, `photos_after`
- `session.consent_signature` (TCLE do paciente — sim, opcional!)
- Todos os campos da FichaForm (Geral/Facial/Corporal/Capilar)
- `linkedBudget` (não é obrigatório ter orçamento)
- `paymentPayload.payment_status` (default: pago; mas pode escolher nao_pago)

### 14.3 Campos NUNCA usados no fluxo (código morto ou não integrado)
| Campo | Motivo |
| --- | --- |
| `stage="done"` | Bloco L482-493 nunca é atingido (confirmFinalize fecha o dialog antes) |
| `Save` icon import (L11) | Importado mas não usado |
| `X` icon import (L12) | Importado mas não usado |
| `medical_records.session_id` | Não existe no schema — não conseguimos rastrear o record até a session |
| `medical_records.consent_signature` | Só grava evolution_signature; TCLE do paciente é perdido |
| `appointment.status="em_atendimento"` | Nunca é setado — status pula direto de "confirmado" para "concluido" |
| `patient` (state) | Populado no useEffect L77, mas usado só como `patient.patient_id` (poderia ser lido do session) |
| `MODULE_OPTIONS` | Poderia estar num módulo compartilhado; hoje é declaração local |

---

## 15. COMPONENTES OBSOLETOS OU DUPLICADOS

| Elemento | Status | Observação |
| --- | --- | --- |
| `stage="done"` (L482-493) | 💀 **Código morto** | Nunca é acionado |
| Import `Save` (L11) | 💀 **Não usado** | Remover imports órfãos |
| Import `X` (L12) | 💀 **Não usado** | Remover imports órfãos |
| Tela `/anamnese` legada | ⚠️ **Duplicada** | Coexiste com anamnesis_modules — dois sistemas |
| Tela `/prontuario` manual | ⚠️ **Duplicada** | Mesmo endpoint que o auto-generated pelo finalize |
| `patient` state | ⚠️ **Redundante** | `session.patient_name` já tem parte da info |

---

## 16. CAMPOS DUPLICADOS

| Campo | Aparece em | Impacto |
| --- | --- | --- |
| `patient_name` | `appointment`, `session`, `patient` | Desnormalizado em 3 lugares — se paciente muda de nome, desatualiza |
| `procedure` | `appointment`, `session`, `medical_record`, `financial_entries.description` | 4 cópias (procedure_id opcional em cada) |
| `professional_name` | `appointment`, `session`, `medical_record` | 3 cópias |
| `duration_seconds` | `session`, `medical_record` | 2 cópias após finalize |
| `photos_before/after` | `session`, `medical_record` | Duplicados após finalize (array copiado) |
| `evolution/observations/protocols/prescriptions` | `session`, `medical_record` | Duplicados após finalize |
| `signature` (evolution) | `session.evolution_signature`, `medical_record.signature` | 2 cópias (mesmo conteúdo, nome diferente) |
| `consent_signature` | `session.consent_signature` apenas — **não copiado** | Não duplicado, mas perdido |

---

## 17. VALIDAÇÕES EXISTENTES

| Local | Validação |
| --- | --- |
| Backend `/patients/{id}/completeness` | Requer `name`, `cpf`, `birth_date`, `phone`, `lgpd_consent` |
| Frontend `finalize()` L214 | Requer `evolution_signature` |
| Frontend `savePatient()` L163 | Envia `lgpd_consent: !!pForm.lgpd_consent` |
| Backend `/attendance/start` | `forbid_recepcao_clinical` (recepção 403) |
| Backend `/attendance/{sid}` PUT | `forbid_recepcao_clinical` |
| Backend `/attendance/{sid}/finalize` | `forbid_recepcao_clinical` |
| CompletePaymentDialog | `amount_paid > total` → 400 no backend |

**Ausências notáveis:**
- Não valida canvas de assinatura vazio.
- Não valida evolution/observations mínimos.
- Não valida foto antes/depois presentes.
- Não valida FichaForm respondida.
- Não valida orçamento existente para procedimentos pagos.
- Não valida duplicidade de finalize.

---

## 18. PROBLEMAS ENCONTRADOS (CONSOLIDADO)

### 🔴 Críticos
1. **Finalize não idempotente** — double-click gera duplicatas em medical, financial e receipts.
2. **stage="done" morto** — código nunca executa.
3. **TCLE do paciente descartado** — `consent_signature` fica no session mas não copia para medical_record.
4. **Race conditions no autosave** — closure de `session` no debounce (L119) + IA competindo com autosave.
5. **FichaForm nunca copia para prontuário** — dados da anamnese modular perdidos na consolidação final.

### 🟠 Médios
6. **Botões IA anexam texto duplicado** a cada clique — sem diálogo de confirmação.
7. **Sem transação atômica** medical + financial + budget.
8. **Base64 pesado no payload de autosave** (200 KB × frequência = tráfego alto).
9. **Signed URLs de fotos expiram** — sem renovação automática.
10. **Sem preview do recibo** antes do finalize.
11. **Sem indicação visual** de progresso das abas (Ficha ✓ / Evolução ✓ / etc).
12. **appointment.status="em_atendimento"** nunca setado — agenda não sabe quem está sendo atendido agora.

### 🟡 Menores
13. Imports órfãos (`Save`, `X`).
14. Filtro de budgets em memória (poderia ser query backend).
15. `patient` state redundante.
16. Sem `useMemo`/`useCallback` — re-renders desnecessários nos filhos.
17. `MODULE_OPTIONS` local — deveria vir de módulo compartilhado.
18. Aviso "Prescrição — apenas profissionais habilitados" é meramente decorativo.
19. Sem timestamp por foto/assinatura.

---

## 19. PROPOSTA DE EVOLUÇÃO DO ATENDIMENTO

### 🟢 BAIXO RISCO (aditivo, sem quebrar nada)

| # | Melhoria | Esforço | Descrição |
| --- | --- | --- | --- |
| 1 | **Remover imports órfãos** (`Save`, `X`) | 5 min | Housekeeping |
| 2 | **Confirmação antes de finalizar** com resumo (X entries, R$Y total, N recibos) | 30 min | Modal antes de abrir CompletePaymentDialog |
| 3 | **Preview do recibo** dentro do AttendanceDialog após finalizar | 45 min | Reutiliza recipe PDF gerado |
| 4 | **Trava frontend contra double-click** — `busy` flag em ambos PUT + POST finalize | 15 min | Extender `busy` para cobrir todo o `confirmFinalize` |
| 5 | **Enviar recibo por WhatsApp** no toast pós-finalize | 30 min | Reaproveita `/finance/entries/{id}/receipt/whatsapp-link` |
| 6 | **Timestamp por assinatura** (frontend gera + envia no autosave) | 20 min | Novo campo `signature_signed_at` no session |
| 7 | **Copiar `consent_signature` para medical_record** | 15 min | Backend: 1 linha em finalize_attendance |
| 8 | **Barra de progresso das abas** (checkmarks nas TabsTriggers) | 40 min | UI-only, baseado em campos preenchidos |
| 9 | **Aviso "orçamento não salvo"** ao clicar Concluir | 20 min | Compara `linkedBudget` vs BudgetEditor state |
| 10 | **Toast pós-finalize com contagem de recibos** | 15 min | Backend já retorna array `financial_entries` |
| 11 | **Remover stage="done" morto** (limpeza) | 10 min | Deletar bloco L482-493 |
| 12 | **`useMemo` em derivados caros** (fichaModule schema, budget totals) | 30 min | Otimização puramente local |

**Total baixo risco: ~4h30 de trabalho.**

### 🟠 MÉDIO RISCO (mudanças aditivas com múltiplos pontos)

| # | Melhoria | Esforço | Descrição |
| --- | --- | --- | --- |
| 13 | **Idempotência do finalize** com `Idempotency-Key` header + índice unique parcial | 2h | Backend: aceita header, cache resultado 5 min; Frontend: gera UUID por clique |
| 14 | **Copiar FichaForm respostas para medical_record** no finalize | 1h | Backend: buscar anamnesis_modules do paciente e mesclar |
| 15 | **Diálogo de IA "Substituir ou anexar?"** antes de aplicar resultado | 1h | Impede duplicações; melhora UX |
| 16 | **`appointment.status="em_atendimento"` automático** ao criar session | 30 min | Backend: 2 linhas em `/attendance/start` |
| 17 | **Timestamp e IP em cada assinatura** (canvas + finalize) | 1h | Novo campo estruturado; backend valida |
| 18 | **Ficha visualizando alergias em vermelho no header** | 45 min | Ler `patient.allergies` + banner fixo no dialog |
| 19 | **Compressão automática de fotos** antes do upload (canvas resize) | 1h | Reduz payload 80% (4MB → 800KB) |
| 20 | **Envio automático de recibo por email** (opt-in por clínica) | 1h30 | Flag `auto_send_receipts` em clinics + hook pós-finalize |
| 21 | **Editar paciente inline** (drawer lateral no dialog) | 2h | Novo drawer + PATCH /patients |
| 22 | **Botão "Cancelar sessão"** com confirmação (delete session, mantém appointment) | 1h | Novo endpoint `DELETE /attendance/{sid}` + botão |
| 23 | **Comparador visual antes/depois** (slider) | 2h | Lightbox interno + slider |
| 24 | **Prescrição estruturada** (medicamento/posologia/duração) em vez de textarea único | 3h | Novo array `prescription_items` no session |

**Total médio risco: ~16h30 de trabalho.**

### 🔴 ALTO RISCO (mudanças estruturais)

| # | Melhoria | Esforço | Descrição |
| --- | --- | --- | --- |
| 25 | **Unificar `anamnesis` + `anamnesis_modules`** — migrar dados legados, deprecar tela `/anamnese` | 8h | Migration + coerência multi-tenant + testes |
| 26 | **Transação atômica finalize** (medical + financial + budget) via MongoDB session/transaction | 6h | MongoDB replica set necessário; requer teste extenso de rollback |
| 27 | **Versionamento de medical_records** — permitir editar após finalize com histórico | 6h | Nova coleção `medical_records_versions` + UI |
| 28 | **Módulo de comissões** por profissional | 10h | Nova coleção `commissions` + cálculo no finalize + UI de config + relatórios |
| 29 | **Lock/concurrency de sessions** (impede 2 profissionais editarem simultaneamente) | 4h | Nova coleção `session_locks` com TTL + heartbeat |
| 30 | **Detecção IA de red flags** (alergias × contraindicações do procedimento) | 8h | Base de contraindicações + prompt + UI de alerta |
| 31 | **Templates de prescrição por procedimento** | 4h | Nova coleção `prescription_templates` + seed + UI |
| 32 | **Refatorar `AttendanceDialog` em sub-componentes** (528 → 5× 100-150 linhas) | 6h | AttendanceHeader / AttendanceCompletion / AttendanceTabs / AttendancePaymentBridge — sem mudança funcional |
| 33 | **Prontuário incremental multi-sessão** (várias entries por paciente sob mesma "linha do tempo") | 12h | Redesign da coleção medical_records + UI |
| 34 | **Notificações realtime** (WebSocket) para "profissional X está atendendo Y" | 8h | Nova infraestrutura WS + UI |

**Total alto risco: ~72h de trabalho.**

---

## 20. RESUMO EXECUTIVO E RECOMENDAÇÃO

O `AttendanceDialog` é um componente **funcional e coeso** (5 abas, autosave, IA, orçamento e finalização) mas com **débitos técnicos claros**:
- Estado excessivo (13 useState + 2 useRef) em um único componente.
- Zero uso de `useMemo`/`useCallback`.
- Código morto (`stage="done"`).
- Race conditions latentes no autosave.
- Idempotência ausente no ponto mais crítico (finalize).
- Duplicação anamnesis × anamnesis_modules × FichaForm sem consolidação no prontuário.

**Recomendação de priorização (ordem de implementação sugerida):**

1. **Sprint quick-wins (4h30):** todos os itens 🟢 baixo risco. Ganho de UX imenso com esforço mínimo.
2. **Sprint hardening (6h):** itens 13 (idempotência), 16 (status em_atendimento), 17 (timestamp assinaturas), 7 (consent_signature no record). Fecha os riscos críticos.
3. **Sprint clínico (8h):** itens 14 (FichaForm → prontuário), 15 (IA substituir/anexar), 18 (alergias no header), 21 (editar paciente inline).
4. **Sprint estrutural (evolução gradual):** itens 25 (unificar anamnesis), 32 (refatorar AttendanceDialog), 28 (comissões).

Nenhum dos itens exige reescrita completa. O componente sustenta as melhorias sem colapsar.

---

**Fim da Auditoria do `AttendanceDialog` — Fev/2026.**
