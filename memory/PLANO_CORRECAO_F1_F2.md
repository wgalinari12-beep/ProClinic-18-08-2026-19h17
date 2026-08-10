# PLANO TÉCNICO — CORREÇÃO F1 (Fotos QR) e F2 (Assinaturas QR)
**Data:** 10/06/2026 · **Status:** AGUARDANDO APROVAÇÃO — nada implementado
**Base:** Auditoria `/app/memory/AUDITORIA_QRCODE_ASSINATURAS_FOTOS.md`

---

# F1 — FOTOS VIA QR

## 1. Arquivos alterados
| Arquivo | Tipo de mudança |
|---|---|
| `/app/backend/server.py` | 2 endpoints novos + 2 funções ajustadas |
| `/app/frontend/src/components/FichaForm.jsx` | autosave e handlers de foto |
| `/app/frontend/src/components/PhotoUploader.jsx` | 2 props novas OPCIONAIS (retrocompatível) |

## 2. Funções alteradas
**Backend (`server.py`):**
- `save_anamnesis_module` (linha ~2100): no UPDATE de módulo existente, o campo `photos` é REMOVIDO do `$set` — o autosave nunca mais toca em fotos. No INSERT (módulo novo), `photos` continua aceito (default `[]`).
- `mobile_upload_upload` (linha ~4017): troca `$push` por `$addToSet` (idempotente) e passa a verificar `matched_count` — se o módulo não existir, loga warning e retorna erro 404 claro em vez de sucesso falso.
- **NOVO** `POST /api/anamnesis-modules/{module_id}/photos` — body `{"url": "..."}` → `$addToSet {photos: url}`. Retorna array `photos` atualizado do banco.
- **NOVO** `DELETE /api/anamnesis-modules/{module_id}/photos` — body `{"url": "..."}` → `$pull {photos: url}`. Retorna array atualizado.
- Ambos com: `forbid_recepcao_clinical`, filtro `clinic_id` (e `created_by` p/ role profissional — mesmo RBAC do módulo), `updated_at` atualizado.

**Frontend (`FichaForm.jsx`):**
- `useEffect` de autosave (linhas 69-86): remove `photos` do payload E das dependências → passa a depender só de `[answers]`.
- Novo handler `addPhotos(urls)`: chama o endpoint POST para cada URL e usa a resposta do servidor como novo estado (`setPhotos(resp.photos)`).
- Novo handler `removePhoto(url)`: chama o DELETE e usa a resposta do servidor.
- `onMobileUploaded` (linhas 111-118): mantido (refetch) — continua atualizando a tela em tempo real.
- Caso de borda: se `moduleId === null` (ficha nunca salva) e o usuário adiciona foto pelo desktop → primeiro cria o módulo (`POST /anamnesis-modules` só com answers), obtém `module_id`, depois adiciona a foto. (O botão QR já é desabilitado sem moduleId — comportamento mantido.)

**Frontend (`PhotoUploader.jsx`):**
- Novas props OPCIONAIS `onAdd(urls)` e `onRemove(url)`. Se fornecidas, são usadas no lugar de `onChange` com array completo. Se ausentes, comportamento atual 100% preservado → **AttendanceDialog (fotos antes/depois) não é afetado.**

## 3. Como a sobrescrita é eliminada
O array `photos` deixa de existir como "estado que o desktop escreve por inteiro". Passa a ser um **conjunto gerenciado somente por operações atômicas no servidor**:
- Celular adiciona → `$addToSet`
- Desktop adiciona → `$addToSet` (via novo endpoint)
- Desktop remove → `$pull` (URL específica)
- Autosave → **não envia fotos, nunca**
Não existe mais nenhum caminho de código que faça `$set` do array completo → a corrida desaparece por construção, não por sincronização.

## 4. Estratégia $addToSet / $pull / atomicidade
- `$addToSet`: adiciona a URL apenas se ainda não existir — cliques duplos, reenvios do celular e retries de rede tornam-se idempotentes.
- `$pull`: remove exatamente a URL indicada — remover a foto A não interfere na foto B adicionada em paralelo pelo celular.
- Ambas são operações atômicas de documento no MongoDB: duas escritas concorrentes (celular + desktop) são serializadas pelo engine sem perda, sem necessidade de lock ou versionamento.

## 5. Garantias
| Garantia | Como |
|---|---|
| Fotos do celular nunca apagadas | Nenhum código restante escreve o array inteiro; deleção só por `$pull` explícito de 1 URL pelo usuário |
| Autosave continua funcionando | Intocado para `answers` (mesmo endpoint, mesmo debounce de 900ms); apenas deixa de carregar `photos` |
| Fichas existentes não afetadas | Zero migração; leitura (`GET /anamnesis-modules`) inalterada; `photos` existentes permanecem como estão; snapshot no finalize (server.py:2402) inalterado |

## 6. Riscos
| Risco | Severidade | Mitigação |
|---|---|---|
| PhotoUploader é compartilhado com AttendanceDialog | Média | Props novas opcionais; sem props → comportamento idêntico ao atual; teste de regressão específico |
| Foto adicionada antes do módulo existir | Baixa | Criação do módulo antes do add (sequência garantida no handler) |
| Duplicidade de URL | Nula | `$addToSet` é idempotente |
| Remoção acidental em cascata | Nula | `$pull` remove só a URL clicada |

## 7. Rollback
- Mudanças 100% aditivas + 1 remoção de campo em payload. **Sem migração de dados, sem alteração de schema.**
- Rollback = restaurar os 3 arquivos ao commit anterior (a plataforma Emergent cria checkpoint a cada etapa; o usuário pode usar a opção de rollback gratuita do chat).
- Os endpoints novos podem permanecer no banco de rotas sem efeito colateral caso apenas o frontend seja revertido.

---

# F2 — ASSINATURAS VIA QR

## 1. Arquivos alterados
| Arquivo | Mudança |
|---|---|
| `/app/backend/server.py` | `public_sign_patient` + `_build_patient_timeline` |
| `/app/frontend/src/components/DocumentGenerator.jsx` | polling + prop `documentId` (modo retomar) |
| `/app/frontend/src/pages/PatientDetail.jsx` | botão "Continuar" + reabrir doc existente |
| `/app/frontend/src/pages/Documentos.jsx` | botão "Continuar" no histórico |
| `/app/frontend/src/components/PatientClinicalTimeline.jsx` | seção "Documentos do paciente" (docs sem atendimento) |

## 2. Endpoints alterados
- `POST /api/public/documents/{token}/sign-patient` (linha ~4676): passa a buscar o doc e atualizar `status` → `"aguardando_profissional"` se ainda não houver assinatura do profissional (espelhando o endpoint autenticado da linha 4505). Nada mais muda no contrato.
- `GET /api/patients/{id}/timeline` (`_build_patient_timeline`, linha ~3218): além do bloco atual por sessão (mantido), adiciona campo novo na resposta: `patient_documents` = docs do paciente com `appointment_id` nulo (projeção leve: document_id, template_name, status, pdf_url, created_at, signed_patient_at, signed_professional_at). Campo ADITIVO — consumidores antigos ignoram.
- **Nenhum endpoint novo é necessário para o polling**: o `GET /api/documents/{document_id}` existente já retorna as assinaturas.

## 3-6. Polling (funcionamento, intervalo, encerramento, atualização do desktop)
- **Onde:** `DocumentGenerator.jsx`, novo `useEffect`.
- **Quando ativa:** `step === "review"` E dialog aberto E `!doc.patient_signature` (independe de a aba QR estar visível — cobre o caso do profissional trocar de aba enquanto o paciente assina).
- **Intervalo:** **3 segundos** (mesma ordem de grandeza do polling de fotos já existente de 2,5s; carga desprezível: 1 find_one por tick).
- **Chamada:** `GET /documents/{doc.document_id}`.
- **Encerramento (qualquer um):**
  1. `signed_patient_at` detectado → para imediatamente;
  2. dialog fechado / componente desmontado → `clearInterval` no cleanup;
  3. mudança de step (finalized/pick) → para.
- **Atualização do desktop:** ao detectar assinatura → `setDoc(dadosDoServidor)` → a aba "Assinatura paciente" renderiza automaticamente o card verde "Paciente assinou em ..." (código já existente, linhas 191-195), o botão "Finalizar e gerar PDF" destrava assim que o profissional também assinar, e um toast avisa: "✅ Assinatura do paciente recebida pelo celular".

## 7. Atualização do status
Fluxo de status passa a ser consistente nos dois caminhos (desktop e QR público):
```
rascunho → (paciente assina, qualquer via) → aguardando_profissional
         → (profissional assina)           → aguardando_paciente (se paciente ainda não assinou)
         → (ambos + finalize)              → finalizado (com PDF)
```

## 8. Botão "Continuar"
- `DocumentGenerator` ganha prop opcional `documentId`:
  - **Com** `documentId`: em vez de criar doc novo, faz `GET /documents/{id}`, entra direto no step "review" com as assinaturas já registradas visíveis. QR usa o `public_token` já existente do doc (GET /documents/{id} retorna o doc completo, incluindo public_token).
  - **Sem** `documentId`: fluxo atual (escolher template → criar).
- `PatientDetail.jsx` (linhas 270-290) e `Documentos.jsx` (linhas 149-167): em linhas com `status !== "finalizado"`, nova ação **"Continuar"** que abre o DocumentGenerator com `documentId` (e `patientId = d.patient_id`). Ao fechar, a listagem é recarregada (mecanismo já existente no PatientDetail:327-331).
- Efeito colateral positivo: elimina a criação de rascunhos duplicados órfãos (auditoria, Etapa 5).

## 9. Vínculos (patient_id / appointment_id / document_id)
- `patient_id`: já é gravado SEMPRE na criação (server.py:4456) — sem mudança.
- `appointment_id`: já é gravado quando o doc é gerado dentro do atendimento (AttendanceDialog passa `appointmentId`, linha 911) — sem mudança. Docs gerados pela ficha do paciente continuam com `appointment_id=null` **por definição correta** (não há atendimento) e passam a ser visíveis via `patient_documents` (item 10).
- `document_id`: chave imutável usada pelo polling e pelo "Continuar".
- **Nenhuma migração de dados é necessária.**

## 10. Timeline
- Seção por sessão "Documentos assinados" (filtro por `appointment_id`): **mantida como está**.
- Nova seção no topo da timeline: **"Documentos do paciente"** (fonte: `patient_documents`), exibindo nome, status (badge), datas de assinatura e link do PDF quando existir. Assim, TODO documento do paciente fica visível no prontuário — com ou sem atendimento vinculado.

## 11. Compatibilidade com documentos antigos
- Docs `finalizado` antigos: nenhum campo tocado; continuam aparecendo igual (PDF, listagens, timeline por sessão).
- Docs `rascunho` antigos (inclusive os "perdidos" com assinatura salva, como o `doc_3c8d1cfb59f5` do teste): tornam-se **recuperáveis** — aparecem em `patient_documents` e podem ser retomados/finalizados pelo botão "Continuar". A assinatura já persistida no banco é exibida imediatamente.
- `public_token` antigo (validade 180 dias): reutilizado como está; docs com token expirado geram novo QR? **Não nesta fase** — se detectarmos token expirado ao reabrir, exibiremos aviso (regeração de token fica para F4/backlog, se aprovado).
- Resposta da timeline: campo novo é aditivo; nenhum consumidor quebra.

## 12. Rollback
- Todas as mudanças são aditivas (1 campo de resposta, 1 prop, 1 status update, botões novos). **Sem migração, sem alteração de schema.**
- Rollback = checkpoint da plataforma (opção rollback do chat) ou reversão dos 5 arquivos.
- O status `aguardando_profissional` gravado por docs assinados durante a vigência da correção já é um status legítimo do sistema (STATUS_LABEL existente) — rollback não gera estado inválido.

---

# PLANO DE TESTES (executado só após implementação aprovada)

## TESTES FOTOS (F1)
| # | Cenário | Resultado esperado |
|---|---|---|
| TF1 | Celular envia foto via QR com ficha aberta no desktop | Foto aparece no desktop em ≤3s e permanece no banco |
| TF2 | **Cenário da perda (reprodução da auditoria):** celular envia foto → desktop edita campo da ficha → autosave dispara | Foto CONTINUA no banco (contagem inalterada) — antes era apagada |
| TF3 | Celular envia foto APÓS fechar o dialog QR no desktop → profissional edita ficha | Foto continua no banco; aparece ao reabrir a ficha |
| TF4 | Desktop adiciona foto pelo botão "Adicionar" | `$addToSet` grava; array retornado pelo servidor vira o estado |
| TF5 | Desktop remove foto X (existem X e Y, Y veio do celular) | Só X removida (`$pull`); Y intacta |
| TF6 | Upload duplicado da mesma URL (retry de rede) | Sem duplicata (`$addToSet`) |
| TF7 | Adicionar foto com ficha nunca salva (moduleId null) | Módulo criado primeiro, foto adicionada em seguida |
| TF8 | Finalizar atendimento → `ficha_snapshot` | Fotos (desktop + celular) presentes no medical_record e na timeline |
| TF9 | QR expirado (>20 min) | Página mobile mostra "QR inválido/expirado"; nada gravado |

## TESTES ASSINATURAS (F2)
| # | Cenário | Resultado esperado |
|---|---|---|
| TA1 | Gerar doc no atendimento → QR → paciente assina no celular | Desktop atualiza sozinho em ≤3s ("Paciente assinou em..." + toast); status no banco = `aguardando_profissional` |
| TA2 | Profissional assina + Finalizar | PDF gerado, status `finalizado`, `pdf_url` válido |
| TA3 | Profissional FECHA o dialog antes da assinatura chegar → paciente assina → "Continuar" (Documentos ou ficha do paciente) | Doc reabre com assinatura do paciente visível; finalize possível |
| TA4 | Polling encerra ao fechar dialog | Sem requisições após fechar (verificação de rede/logs) |
| TA5 | Doc criado pela ficha do paciente (sem atendimento) | Aparece em "Documentos do paciente" na timeline com status correto |
| TA6 | Doc criado dentro do atendimento | Continua aparecendo na seção da sessão (por appointment_id) |
| TA7 | Doc rascunho ANTIGO com assinatura salva (doc_3c8d1cfb59f5 da auditoria) | Recuperável via "Continuar"; assinatura exibida |
| TA8 | Assinatura desktop (sem QR) | Fluxo atual inalterado (regressão do caminho autenticado) |
| TA9 | Token público expirado ao reabrir doc | Aviso claro; sem crash |

## TESTES DE REGRESSÃO
| # | Área | Verificação |
|---|---|---|
| TR1 | AttendanceDialog fotos antes/depois | Upload/remoção continuam via onChange (props novas não usadas); persistem no autosave da sessão e no finalize |
| TR2 | Autosave da ficha (answers) | Debounce 900ms, salva answers normalmente, sem enviar photos |
| TR3 | Autosave da sessão de atendimento | Intocado (AbortController/op_id) — sem regressão |
| TR4 | Assinaturas do atendimento (TCLE/evolução no pad desktop) | `POST /attendance/{id}/sign` + metadados forenses + cópia ao medical_record intactos |
| TR5 | Finalize do atendimento | Idempotência, financeiro, recibos, snapshot — inalterados |
| TR6 | RBAC | recepção continua bloqueada nos novos endpoints de fotos; profissional só acessa próprios módulos |
| TR7 | Documentos finalizados antigos | Listagens, PDF e validação pública inalterados |
| TR8 | Timeline | Sessões, financeiro, ficha snapshot e assinaturas de atendimento renderizam como antes; campo novo não quebra nada |
| TR9 | Página pública DocumentoPublico | Assinar 2x / reabrir link já assinado → mostra "Assinatura registrada" |

**Método:** testes backend via curl + verificação direta no MongoDB (como na auditoria) e fluxo E2E via testing agent (frontend + backend), incluindo simulação do celular (página pública em segunda aba).

---
**PRÓXIMO PASSO:** aguardando aprovação do usuário para executar F1 + F2 conforme este plano.
