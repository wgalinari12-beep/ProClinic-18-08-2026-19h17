# AUDITORIA COMPLETA DO FLUXO DE ATENDIMENTO — ProClinic

> **Escopo:** mapeamento _read-only_ do fluxo atual (Fev/2026) do módulo de atendimento clínico, desde o clique no horário até a finalização.
> **Regra do usuário:** SEM CÓDIGO, SEM ALTERAÇÕES, SEM REFATORAÇÕES. Apenas documentar o que existe.
> **Referências:** `/app/backend/server.py` (4.433 linhas), `/app/frontend/src/pages/Agenda.jsx`, `/app/frontend/src/components/AttendanceDialog.jsx`, `/app/frontend/src/components/FichaForm.jsx`, `/app/frontend/src/components/CompletePaymentDialog.jsx`.

---

## 1. FLUXOGRAMA COMPLETO DO ATENDIMENTO

```
[1] Login usuário (admin | profissional | recepcao)
    ↓
[2] Sidebar → /agenda
    ↓
[3] Página Agenda.jsx (visão semanal ou "por profissional")
    ↓
    ├── Clique em CÉLULA VAZIA (dia + hora)
    │       ↓
    │   Dialog "Novo agendamento" (dialogMode = "new")
    │       ↓
    │   Selecionar paciente OU pré-cadastrar novo (Dialog prereg-dialog)
    │       ↓
    │   Preencher procedure, duration, professional, room, price, notes
    │       ↓
    │   POST /api/appointments
    │       ↓
    │   Salvo em `appointments` (status="agendado")
    │       ↓
    │   load() → agenda re-renderiza com bloco novo
    │
    └── Clique em BLOCO EXISTENTE (ApptBlock)
            ↓
        Dialog "Detalhe do agendamento" (dialogMode = "detail")
            ↓
        Ações disponíveis:
          • Confirmar (PUT status=confirmado)
          • WhatsApp (envia link público de confirmação — /api/messages)
          • Cancelar (PUT status=cancelado)
          • Excluir (DELETE)
          • ▶ INICIAR ATENDIMENTO  ← este é o gatilho principal
                ↓
[4] startAttendance() em Agenda.jsx (linha 347)
    ├── closeDialog() do dialogMode="detail"
    └── setTimeout 50ms → setAttendance({open:true, appointment:apt})
        ↓
[5] Componente <AttendanceDialog> monta com stage="loading"
        ↓
[6] useEffect (linha 70) dispara:
        ↓
    (6.a) GET /api/patients/{id}/completeness
          ├── Se INCOMPLETO → stage="completion"
          │       ↓ formulário obrigando: name, cpf, birth_date, phone, lgpd_consent
          │       ↓ clique "Salvar e iniciar" → PUT /api/patients/{id} + POST /api/attendance/start
          │       ↓ stage="inProgress"
          │
          └── Se COMPLETO → segue direto
        ↓
    (6.b) POST /api/attendance/start { appointment_id }
          ├── Backend valida appointment existe
          ├── Backend checa se já existe attendance_sessions (idempotente — retorna o existente)
          ├── Se não: cria doc novo em `attendance_sessions` (status="rascunho")
          └── Retorna session para o frontend
        ↓
    (6.c) GET /api/budgets?patient_id={id}
          ├── Filtra orçamentos vinculados a este appointment_id
          └── Se encontrado, seta linkedBudget
        ↓
    (6.d) stage="inProgress"
        ↓
[7] Timer inicia (setInterval 1s → seconds++) — mostrado no header
        ↓
[8] Usuário navega pelas 5 abas:
    ┌────────────────────────────────────────────────────────────┐
    │  (a) Ficha       — FichaForm (Geral/Facial/Corporal/Capilar)│
    │        ↓ autosave POST /api/anamnesis-modules              │
    │  (b) Evolução    — observations + evolution + protocols +  │
    │        products_used + PhotoUploader antes/depois          │
    │        ↓ autosave PUT /api/attendance/{session_id}         │
    │        ↓ botões IA: "Gerar evolução IA", "Sugerir protocolo"│
    │           → POST /api/ai/generate                          │
    │  (c) Prescrição  — textarea prescriptions                  │
    │        ↓ autosave PUT /api/attendance/{session_id}         │
    │  (d) Orçamento   — <BudgetEditor> embedado                 │
    │        ↓ POST/PUT /api/budgets (com appointment_id linkado)│
    │  (e) Assinatura  — 2 <SignaturePad>:                       │
    │        consent_signature + evolution_signature             │
    │        ↓ autosave PUT /api/attendance/{session_id}         │
    └────────────────────────────────────────────────────────────┘
        ↓
[9] Autosave dispara a cada 800ms de inatividade — badge "Rascunho salvo HH:MM"
        ↓
[10] (opcional) Botão "Documento" abre <DocumentGenerator>
        → POST /api/documents (termos, TCLE etc — pode assinar em canvas ou QR mobile)
        ↓
[11] Clique "Concluir atendimento" (linha 502)
    ├── Validação: evolution_signature obrigatório → senão erro + tab="assinatura"
    ├── Se OK: PUT /api/attendance/{session_id} (salva rascunho final)
    └── Abre <CompletePaymentDialog>
        ↓
[12] Usuário informa:
    ├── payment_status: "pago" | "parcial" | "nao_pago"
    ├── amount_total (auto-preenchido: budget.total OU appt.price)
    ├── amount_paid (se parcial)
    ├── payment_method: pix|cartão|dinheiro|boleto|parcelado
    ├── due_date (para saldo/parcelas)
    ├── installments (1..48)
    └── installment_interval_days
        ↓
[13] confirmFinalize() chama POST /api/attendance/{session_id}/finalize
    ↓
[14] Backend `finalize_attendance` (server.py:1841) executa em sequência:
    (14.a) Cria doc em `medical_records`:
            {record_id, patient_id, procedure, professional_name,
             evolution, observations, protocols, prescriptions,
             photos_before, photos_after, signed, signature,
             duration_seconds, created_by, created_at}
    (14.b) UPDATE attendance_sessions {status:"concluido", finalized_at}
    (14.c) UPDATE appointments {status:"concluido"}
    (14.d) Gera N financial_entries conforme payment_status + installments:
            • "pago"      → 1 entry paid=true (auto-gera REC-YYYY-####)
            • "parcial"   → 1 entrada paid=true (REC gerado) + N parcelas paid=false
            • "nao_pago"  → N parcelas paid=false, sem receipt
            Todas com: patient_id, appointment_id, budget_id?, procedure_id (do appt),
            professional_id (do appt), installment_group_id compartilhado,
            installment_number/total.
    (14.e) Se budget_id fornecido: budgets.status="aprovado"
    (14.f) Para cada entry paid=true → chama _generate_receipt_for_entry:
            • incrementa receipt_counters(clinic_id, year)
            • gera PDF via _build_receipt_pdf
            • armazena em Object Storage
            • grava receipt_number/receipt_url no doc
    (14.g) Retorna {ok:true, record_id, financial_entries:[...]}
        ↓
[15] Frontend: toast "Atendimento concluído e financeiro lançado"
    ├── setPaymentOpen(false)
    ├── onCompleted?.() → Agenda.load() re-fetch
    └── onOpenChange(false) → fecha AttendanceDialog
        ↓
[16] Bloco na agenda passa para estilo "concluido" (cinza)
    Prontuário do paciente ganha 1 novo registro
    Financeiro ganha N novas entries + M recibos PDF
    Orçamento (se linkado) muda para status="aprovado"
```

---

## 2. TELAS ENVOLVIDAS

### 2.1 Agenda (ponto de entrada)
| Item | Valor |
| --- | --- |
| Nome | Agenda |
| Arquivo | `/app/frontend/src/pages/Agenda.jsx` (812 linhas) |
| Rota | `/agenda` |
| Objetivo | Visualizar/criar/mover/finalizar agendamentos da semana |
| Botões principais | "Novo pré-cadastro" (linha 686), setas de navegação (Chevron L/R), toggle "Todos vs Por profissional", célula vazia (novo), bloco (detalhe) |
| Ações | onEmptyClick, onApptClick, onDragEnd (drag&drop reposiciona), updateStatus, deleteAppointment, sendWhatsappConfirmation, startAttendance |
| Dados carregados no `load()` | `/api/appointments?start&end`, `/api/patients`, `/api/procedures?active_only=true`, `/api/users/professionals-public` |
| Dados salvos | POST/PUT/DELETE `/api/appointments`, POST `/api/patients` (pré-cadastro), POST `/api/messages` (WhatsApp) |

### 2.2 AttendanceDialog (tela principal do atendimento — modal fullscreen)
| Item | Valor |
| --- | --- |
| Nome | AttendanceDialog |
| Arquivo | `/app/frontend/src/components/AttendanceDialog.jsx` (528 linhas) |
| Rota | Não tem — é overlay/modal sobre `/agenda` |
| Objetivo | Executar o atendimento clínico completo em 4 etapas: completion → inProgress (5 abas) → done |
| Botões (header) | Timer visível, "Documento" (abre DocumentGenerator), badge "Rascunho salvo HH:MM" |
| Botões (footer) | "Salvar rascunho e sair", "Concluir atendimento" |
| 5 abas | Ficha, Evolução, Prescrição, Orçamento, Assinatura |
| Ações executadas | Autosave a cada 800ms, IA generate, IA suggest protocol, capture signatures, launch payment dialog, launch document generator |
| Dados carregados | `/api/patients/{id}/completeness`, `/api/attendance/start`, `/api/budgets?patient_id`, `/api/anamnesis-modules?patient_id` (via FichaForm) |
| Dados salvos | PUT `/api/attendance/{sid}`, POST `/api/attendance/{sid}/finalize`, POST `/api/anamnesis-modules`, POST `/api/ai/generate`, POST `/api/documents`, POST `/api/uploads` (fotos), POST `/api/budgets` |

### 2.3 CompletePaymentDialog (sub-dialog no final)
| Item | Valor |
| --- | --- |
| Nome | CompletePaymentDialog |
| Arquivo | `/app/frontend/src/components/CompletePaymentDialog.jsx` (172 linhas) |
| Rota | Sub-modal dentro de AttendanceDialog |
| Objetivo | Coletar dados de pagamento para o lançamento financeiro automático |
| Botões | 3 status buttons (pago/parcial/nao_pago), "Cancelar", "Confirmar" |
| Ações | onConfirm callback → dispara `POST /api/attendance/{sid}/finalize` |
| Dados salvos indiretamente | Financial_entries + budget status via finalize endpoint |

### 2.4 Prontuário (tela paralela — visualização)
| Item | Valor |
| --- | --- |
| Nome | Prontuário Digital |
| Arquivo | `/app/frontend/src/pages/Prontuario.jsx` (178 linhas) |
| Rota | `/prontuario` |
| Objetivo | Listar e criar `medical_records` manualmente (fora do fluxo de atendimento) |
| Dados carregados | GET `/api/medical-records`, `/api/patients` |
| Dados salvos | POST `/api/medical-records` (criação manual — não passa pelo AttendanceDialog) |
| **Relação com atendimento** | Este é o local onde ficam TODOS os prontuários — inclusive os criados automaticamente pelo `finalize_attendance` |

### 2.5 Anamnese (tela paralela)
| Item | Valor |
| --- | --- |
| Nome | Anamnese |
| Arquivo | `/app/frontend/src/pages/Anamnese.jsx` (151 linhas) |
| Rota | `/anamnese` |
| Objetivo | Anamneses assinadas (fora do fluxo de atendimento) |
| **Diferença crucial** | A aba "Ficha" do AttendanceDialog usa `/api/anamnesis-modules` (schema por módulo Geral/Facial/Corporal/Capilar), enquanto `/anamnese` usa `/api/anamnesis` (schema legado com `template_name` + `answers` + `signature`). **DOIS sistemas paralelos coexistem hoje.** |

### 2.6 PatientDetail (perfil do paciente)
| Item | Valor |
| --- | --- |
| Nome | Detalhe do Paciente |
| Arquivo | `/app/frontend/src/pages/PatientDetail.jsx` (374 linhas) |
| Rota | `/pacientes/:id` |
| Objetivo | Ver perfil consolidado; aba "Timeline" mostra os appointments |
| Abas visíveis (por role) | Timeline, Prontuário, Anamnese, Orçamentos, Documentos, **Financeiro** (nova em Fase 2.5C) |
| **Relação com atendimento** | Só visualização. Não permite iniciar atendimento a partir daqui — precisa ir para a Agenda. |

---

## 3. COMPONENTES ENVOLVIDOS

### 3.1 `AttendanceDialog` (principal)
- **Função:** orquestrador de todo o fluxo clínico.
- **Props:** `{appointment, open, onOpenChange, onCompleted}`.
- **Estado interno:** `stage` (loading|completion|inProgress|done), `patient`, `session`, `tab`, `fichaModule`, `seconds`, `linkedBudget`, `paymentOpen`, `docGenOpen`.
- **Dependências:** `PhotoUploader`, `SignaturePad`, `FichaForm`, `BudgetEditor`, `CompletePaymentDialog`, `DocumentGenerator`.

### 3.2 `FichaForm` (Ficha clínica — dentro da aba Ficha)
- **Arquivo:** `/app/frontend/src/components/FichaForm.jsx` (231 linhas).
- **Função:** renderiza formulário dinâmico conforme schema (Geral/Facial/Corporal/Capilar), autosalva em `/api/anamnesis-modules`, computa IMC automaticamente, permite upload de fotos com QR mobile.
- **Props:** `{module, schema, patientId, onSaved, onAiSummary}`.
- **Eventos:** autosave 900ms; onAiSummary quando gera resumo IA.
- **Dependências:** `PhotoUploader`, `MobileUploadQR`, `SCHEMA_GERAL/FACIAL/CORPORAL/CAPILAR` (`/app/frontend/src/components/ficha-schemas.js`).

### 3.3 `PhotoUploader`
- **Arquivo:** `/app/frontend/src/components/PhotoUploader.jsx`.
- **Função:** upload múltiplo de imagens; usa `/api/uploads` + `/api/mobile-upload/init` + signed URLs.
- **Props:** `{label, testid, value, onChange, accent}`.

### 3.4 `SignaturePad`
- **Arquivo:** `/app/frontend/src/components/SignaturePad.jsx`.
- **Função:** canvas de assinatura (react-signature-canvas), retorna base64 PNG.
- **Props:** `{testid, value, onChange}`.

### 3.5 `BudgetEditor`
- **Arquivo:** `/app/frontend/src/components/BudgetEditor.jsx` (283 linhas).
- **Função:** editor de orçamento; permite adicionar itens, descontos, forma de pagamento, parcelas, link público.
- **Props:** `{patientId, appointmentId, budgetId, onSaved}`.

### 3.6 `CompletePaymentDialog`
- **Arquivo:** já mapeado em 2.3.
- **Props:** `{open, onOpenChange, defaultTotal, budgetTotal, budgetId, onConfirm}`.

### 3.7 `DocumentGenerator`
- **Arquivo:** `/app/frontend/src/components/DocumentGenerator.jsx`.
- **Função:** gera Termos de Consentimento, Contratos etc, com variáveis dinâmicas + assinatura via canvas ou QR mobile.
- **Props:** `{open, onOpenChange, patientId, appointmentId, procedure, procedureValue}`.

### 3.8 `MobileUploadQR`
- **Arquivo:** `/app/frontend/src/components/MobileUploadQR.jsx`.
- **Função:** gera QR code para upload de fotos via celular do paciente/profissional.

### 3.9 `ApptBlock` (interno em Agenda.jsx)
- **Função:** bloco visual arrastável do agendamento; usa `useDraggable` do @dnd-kit.

### 3.10 `DayHourCell` / `ProHourCell` (internos em Agenda.jsx)
- **Função:** células soltáveis da grade horária; usam `useDroppable`.

---

## 4. DADOS DO AGENDAMENTO CARREGADOS AO ABRIR ATENDIMENTO

**Ao clicar em "Iniciar atendimento" — a partir do bloco `apt` que está em memória:**

Campos exibidos (header do modal):
- `appointment.patient_name` — nome do paciente
- `appointment.procedure` — nome do procedimento
- `appointment.professional_name` — profissional
- `appointment.price` — valor (usado como fallback no CompletePaymentDialog)

Campos carregados INTERNAMENTE (não visíveis no header):
- `appointment.appointment_id` — usado para POST /attendance/start
- `appointment.patient_id` — usado para completeness check + budgets query
- `appointment.professional_id` — copiado para financial_entries no finalize
- `appointment.procedure_id` (se existir) — copiado para financial_entries
- `appointment.start` / `appointment.end` — não usados dentro do dialog
- `appointment.status` — atualizado no finalize
- `appointment.room` / `appointment.notes` — não usados
- `appointment.professional_color` — não usado dentro do dialog

Da chamada `GET /api/patients/{id}/completeness`, backend retorna:
- `patient` completo: name, cpf, birth_date, phone, email, address, allergies, notes, photo_url, lgpd_consent, is_pre_registered, etc.
- `complete` (bool), `missing` (lista de campos faltando)

Da chamada `POST /api/attendance/start`, backend retorna a session existente ou cria nova com:
- session_id, appointment_id, patient_id, patient_name, procedure, professional_name, clinic_id, status="rascunho", campos vazios de evolution/observations/etc, duration_seconds=0, started_at.

Da chamada `GET /api/budgets?patient_id=...`, filtra em memória o orçamento cujo `appointment_id === appointment.appointment_id`.

---

## 5. BOTÃO "INICIAR ATENDIMENTO"

| Item | Valor |
| --- | --- |
| Localização | Dialog "Detalhe do agendamento" (dialogMode="detail") na Agenda |
| Arquivo | `/app/frontend/src/pages/Agenda.jsx`, linhas **766-768** |
| data-testid | `start-attendance-btn` |
| Handler | `startAttendance` (linha 347) |
| Ação 1 | `closeDialog()` — fecha o dialog de detalhe |
| Ação 2 | `setTimeout 50ms` — aguarda o dialog desmontar |
| Ação 3 | `setAttendance({open:true, appointment:apt})` — abre o AttendanceDialog |
| **NÃO faz** | Nenhuma chamada de API própria; nenhum update de status do appointment; nenhum lock/reserva. Toda a lógica de start está DENTRO do AttendanceDialog. |
| Mudança de status do appointment | **Não muda para "em_atendimento" automaticamente.** O status só muda para "concluido" no finalize. O status "em_atendimento" existe no enum (`AppointmentIn.status`) mas nunca é setado por nenhum código atual. |
| Integração com outros módulos (indireta) | Nenhuma até o AttendanceDialog rodar. |

---

## 6. TELA DE ATENDIMENTO (AttendanceDialog)

### Estados possíveis (`stage`)
1. `loading` — spinner enquanto carrega completeness + session.
2. `completion` — formulário de complementação de cadastro (quando `is_pre_registered` ou faltam campos obrigatórios).
3. `inProgress` — abas de atendimento (95% do tempo aqui).
4. `done` — tela de sucesso após finalizar (aparentemente nunca é acionada — o dialog fecha antes via `onOpenChange(false)`).

### Header (visível o tempo todo em inProgress)
- Nome do paciente (title)
- Procedimento + profissional (description)
- **Timer HH:MM:SS** (data-testid=attendance-timer) rodando a cada 1s
- Botão "Documento" — abre DocumentGenerator
- Badge "Rascunho salvo HH:MM" quando autosave termina

### 5 Abas (stage=inProgress)

#### 6.1 Aba Ficha (data-testid=tab-ficha)
- Sub-abas: **Geral | Facial | Corporal | Capilar**
- Renderiza `<FichaForm>` conforme schema.
- Campos dinâmicos (definidos em `ficha-schemas.js`): altura, peso (com IMC auto-computado), queixa principal, histórico, alergias, medicações, hábitos, expectativas, contra-indicações, etc.
- Upload de "Fotos da Avaliação" com QR mobile.
- Autosave em `/api/anamnesis-modules` (a cada 900ms).
- Botão IA "Resumir" (dentro de FichaForm) → alimenta observations do session via `onAiSummary`.

#### 6.2 Aba Evolução (data-testid=tab-evolucao)
- **Observações da sessão** (textarea) — obs livres do profissional
- Botões IA: "Gerar evolução IA" + "Sugerir protocolo" → chama `POST /api/ai/generate` (Claude 4.5 Sonnet)
- **Evolução clínica** (textarea grande)
- **Protocolo aplicado** (textarea)
- **Produtos utilizados (lote/qtd)** (input)
- 2 PhotoUploaders: "Antes" e "Depois"
- Todos autosave 800ms via `setSessionField`

#### 6.3 Aba Prescrição (data-testid=tab-prescricao)
- Alerta: apenas profissionais habilitados devem prescrever medicamentos
- Textarea único "Orientações / Receituário"
- Autosave em `session.prescriptions`

#### 6.4 Aba Orçamento (data-testid=tab-orcamento)
- `<BudgetEditor>` embedado com `appointmentId` linkado
- Salvamento cria/atualiza doc em `budgets` com `appointment_id` vinculado
- `linkedBudget` fica no state; `budget.total` alimenta `CompletePaymentDialog` depois

#### 6.5 Aba Assinatura (data-testid=tab-assinatura)
- **Termo de Consentimento** (paciente) — SignaturePad → `consent_signature`
- **Assinatura de Evolução** (profissional) — SignaturePad → `evolution_signature`
- Base64 salvos em `attendance_sessions`

### Campos obrigatórios (validação atual)
- Aba Assinatura: `evolution_signature` OBRIGATÓRIO para clicar "Concluir atendimento" (validação em `finalize()`, linha 214).
- Nada mais é obrigatório — profissional pode concluir com evolução em branco, sem fotos, sem consent_signature, sem observations.

### Campos opcionais
Tudo mais: observations, evolution, protocols, prescriptions, products_used, photos_before, photos_after, consent_signature.

### Salvamento automático
- Todos os campos das abas Evolução, Prescrição e Assinatura autosave a cada 800ms.
- FichaForm autosave a cada 900ms.
- BudgetEditor: manual (botão "Salvar orçamento").
- Documentos: manual (botão dentro do DocumentGenerator).

### Ação manual necessária
- Capturar assinatura de evolução (obrigatório).
- Clicar "Concluir atendimento".
- Preencher CompletePaymentDialog (status, valor, forma de pagamento, parcelas).
- Clicar "Confirmar" no dialog de pagamento.

---

## 7. PRONTUÁRIO (medical_records)

### Como é criado durante o atendimento
- **Automaticamente** no `POST /api/attendance/{sid}/finalize` (server.py:1866-1881).
- Copia da `attendance_sessions`: patient_id, procedure, professional_name, evolution, observations, protocols, prescriptions, photos_before, photos_after, evolution_signature (como `signature`), duration_seconds.
- Marca `signed=True` se houver `evolution_signature`.

### Atualiza prontuário existente?
- **Não.** Cada finalize gera um NOVO `medical_records` doc (record_id novo). Nunca atualiza um existente.

### Registros independentes?
- **Sim.** A tela `/prontuario` também permite `POST /api/medical-records` manualmente (fora do fluxo de atendimento) — cria doc independente sem attendance_sessions vinculado.

### Vínculo fraco com sessão
- `medical_records` **NÃO** guarda o `session_id` da attendance session que o originou. Se o prontuário for editado depois, não há como voltar à sessão original.

---

## 8. PROCEDIMENTOS (`procedures`)

### Vinculação ao atendimento
- Catálogo em `/api/procedures` (nome, description, price, duration_minutes, category, active).
- **NÃO é FK forte:** `appointment.procedure` é uma STRING LIVRE (não vincula ao `procedure_id`). O campo `AppointmentIn.procedure_id` foi adicionado (opcional) na Fase 2.5 mas o UI da Agenda ainda cria appointments sem preenchê-lo (linha 191 usa `procedure: "Botox"` string).
- Da lista de procedures o Agenda usa apenas: `procedures` state para exibir o dropdown de seleção (não vinculado por ID).

### Armazenamento
- Coleção `procedures` em MongoDB — CRUD via `/api/procedures`.
- Não guarda histórico de aplicações por paciente.

### Recuperação
- Frontend chama `/api/procedures?active_only=true` no load da Agenda.
- Não há endpoint tipo `/api/patients/{id}/procedures-history` — o histórico é derivado de `appointments` + `medical_records`.

### Impacto no histórico do paciente
- Aparece na Timeline de `PatientDetail.jsx` via `appointments`.
- Aparece em `medical_records` via campo `procedure` (string).
- Aparece em `financial_entries` via campo `procedure_id` (novo) e `category="Procedimentos"` (hardcoded no finalize).

---

## 9. RELACIONAMENTO COM PACIENTES

### Dados utilizados
- **Leitura completa (via `/patients/{id}/completeness`):** name, cpf, birth_date, phone, email, address, allergies, medications, notes, photo_url, lgpd_consent, is_pre_registered, gender, profession, marital_status, emergency_contact, e todos os demais campos de `PatientIn`.
- Do appointment: apenas `patient_id` + `patient_name` (denormalizado).

### Dados alteráveis durante o atendimento
- **No stage="completion"**: name, cpf, birth_date, phone, lgpd_consent (via PUT /patients/{id}). Fora daí, o paciente NÃO é editável dentro do AttendanceDialog.
- **Indiretamente**: cadastro de anamnesis_modules (que ficam vinculados ao paciente) via FichaForm autosave.

### Dados apenas leitura
- Todos os demais campos do paciente (allergies, medications, etc). Se o profissional descobrir uma alergia nova durante o atendimento, precisa sair do dialog e ir para o cadastro do paciente para atualizar — **fluxo quebrado atualmente.**

---

## 10. RELACIONAMENTO COM FINANCEIRO

### Existe integração? **SIM — via `POST /api/attendance/{sid}/finalize`.**

### Ponto único de contato
Toda a integração financeira acontece exclusivamente no endpoint `finalize_attendance` (server.py:1841-2027). Não há outro ponto onde o atendimento gere lançamentos.

### O que é gerado
1. **Cobranças (financial_entries)** — sempre `type="receita"`, `category="Procedimentos"` (hardcoded).
2. **Parcelamentos inteligentes** — se `installments > 1`, gera N docs com `installment_group_id` compartilhado.
3. **Recibos PDF (REC-YYYY-####)** — auto-gerados para cada entry `paid=true`.
4. **Aprovação de orçamento** — se `budget_id` fornecido, `budgets.status="aprovado"`.

### Vinculação
- `financial_entries.patient_id` ← copiado da session
- `financial_entries.appointment_id` ← copiado da session
- `financial_entries.budget_id` ← do payload
- `financial_entries.procedure_id` ← do appointment (opcional)
- `financial_entries.professional_id` ← do appointment
- `financial_entries.created_by` ← usuário que executou finalize

### Comissões
- **NÃO EXISTE** módulo de comissões hoje.
- Nenhum código gera `commission_entries` ou similar.
- Os campos `professional_id` em financial_entries permitem cálculo FUTURO, mas nenhuma UI ou endpoint expõe isso.

### Orçamentos
- Vínculo forte: `attendance_sessions` → `budgets` via campo `appointment_id` na aba "Orçamento".
- Botão "Concluir atendimento" oferece o `budget.total` como default no CompletePaymentDialog.
- Aprovação pública de orçamento (sign_public_budget) NÃO gera lançamentos — só marca `pending_charge_generation=true` (Fase 2.5B).

### Cobranças
- Frontend `/financeiro` mostra a lista global. Perfil do paciente (`/pacientes/:id` aba Financeiro) mostra as do paciente.

### Pagamentos
- No momento do finalize, se `payment_status="pago"`, marca `paid=true` + `paid_at`.
- Não há workflow de "receber depois" além do toggle manual no Financeiro (PUT paid=true).

### Parcelamentos
- Fase 2.5B implementou: `installments` (1..48) + `installment_interval_days` (default 30d) no payload do finalize.

---

## 11. RELACIONAMENTO COM IA CLÍNICA

### Onde ocorre
- **Aba Evolução do AttendanceDialog** (linhas 402-408):
  - "Gerar evolução IA" (`generateEvolution`, linha 193)
  - "Sugerir protocolo" (`suggestProtocol`, linha 203)
- **FichaForm** (aba Ficha): botão "Resumir" (dentro do componente) que passa texto ao `onAiSummary` do AttendanceDialog, que injeta em `session.observations`.

### Endpoint
- `POST /api/ai/generate` com body `{type, patient_id, notes, context}`.
- Backend `/api/ai/generate` (não conferido em detalhe nesta auditoria, mas o `/api/ai/chat` (server.py:942) usa Claude Sonnet 4.5 via EMERGENT_LLM_KEY).

### Dados enviados
- `type`: "evolution" | "protocol" | "session_summary" | "anamnesis_summary"
- `patient_id`: contexto do paciente
- `notes`: observações atuais da sessão (`session.observations` ou `session.evolution`)
- `context`: procedimento do appointment

### Respostas retornadas
- Texto em Português, formatado, para ser mesclado no campo:
  - Evolução IA → append em `session.evolution`
  - Protocolo IA → append em `session.protocols`
  - Resumo IA → append em `session.observations`

### Armazenamento
- Não há armazenamento separado das respostas IA — são apenas mescladas no `session` e persistidas no autosave do PUT `/attendance/{sid}`.
- Sem histórico "essa evolução foi gerada por IA".
- `db.ai_messages` guarda apenas o histórico do `POST /api/ai/chat` (assistente conversacional), não do `/api/ai/generate`.

---

## 12. BANCO DE DADOS — COLEÇÕES ENVOLVIDAS

### 12.1 `appointments`
| Campo | Objetivo |
| --- | --- |
| appointment_id | Chave única (unique index) |
| clinic_id | Multi-tenant |
| patient_id | FK → patients |
| patient_name | Denormalizado |
| procedure | String livre |
| procedure_id | FK opcional → procedures (Fase 2.5, ainda não populado) |
| professional_id / professional_name / professional_color | Denormalizado |
| start / end | ISO datetime |
| status | agendado \| confirmado \| concluido \| cancelado \| encaixe \| em_atendimento |
| room, notes | Livres |
| price | Fallback para financeiro |
| created_at | Timestamp |

### 12.2 `attendance_sessions`
| Campo | Objetivo |
| --- | --- |
| session_id | Chave única (prefix `att_`) |
| clinic_id | Multi-tenant |
| appointment_id | FK → appointments (1:1 idempotente) |
| patient_id / patient_name / procedure / professional_name | Denormalizado |
| status | rascunho \| concluido |
| evolution / observations / protocols / prescriptions / products_used | Textos livres |
| photos_before / photos_after | Arrays de URLs |
| consent_signature / evolution_signature | Base64 PNG |
| duration_seconds | Cronômetro |
| started_at / updated_at / finalized_at | Timestamps |

### 12.3 `medical_records`
| Campo | Objetivo |
| --- | --- |
| record_id | Chave única (prefix `rec_`) |
| clinic_id | Multi-tenant |
| patient_id / patient_name / procedure / professional_name | Denormalizado |
| evolution / observations / protocols / prescriptions | Textos |
| photos_before / photos_after | Arrays |
| signed | Bool |
| signature | Base64 PNG (só a de evolução) |
| duration_seconds | Copiado da session |
| created_by / created_by_name / created_at | Auditoria |
| **AUSENTE** | session_id (não vincula à session originadora) |

### 12.4 `anamnesis_modules` (Fichas do AttendanceDialog)
| Campo | Objetivo |
| --- | --- |
| module_id | Chave única (prefix `anm_`) |
| clinic_id | Multi-tenant |
| patient_id / patient_name | Denormalizado |
| module | geral \| facial \| corporal \| capilar |
| answers | Dict{question_key: answer} |
| photos | Array de URLs |
| created_by / created_by_name / updated_by / created_at / updated_at | Auditoria |

### 12.5 `anamnesis` (tela `/anamnese` legada)
| Campo | Objetivo |
| --- | --- |
| anamnesis_id, clinic_id, patient_id | Identificação |
| template_name | Ex: "Estética Geral" |
| answers | Dict |
| signature | Base64 |
| signed | Bool |
| created_at | Timestamp |
| **Observação** | Coexiste com anamnesis_modules — dois sistemas paralelos |

### 12.6 `budgets`
Já mapeado na auditoria financeira. Vínculo com atendimento: `budget.appointment_id`.

### 12.7 `financial_entries`
Já mapeado na auditoria financeira. Vínculos: patient_id, appointment_id, budget_id, procedure_id, professional_id.

### 12.8 `documents`
Termos, contratos e TCLE gerados via DocumentGenerator. Vínculos: `patient_id`, `appointment_id`, `procedure`, `procedure_value`.

### 12.9 `patients`
Cadastro completo. Lido pelo `completeness check`; editável só no stage="completion".

### 12.10 `receipt_counters`
Contador atômico por (clinic_id, year) — usado no auto-recibo.

### 12.11 `files`
Metadados de arquivos armazenados em Object Storage (fotos + PDFs).

### 12.12 `ai_messages`
Histórico do assistente conversacional (`/api/ai/chat`) — NÃO guarda respostas de `/api/ai/generate`.

---

## 13. APIs UTILIZADAS NO FLUXO DE ATENDIMENTO

| Método | Rota | Payload | Resposta | Objetivo |
| --- | --- | --- | --- | --- |
| GET | `/api/appointments?start&end` | — | `[appointment]` | Lista appointments da semana |
| POST | `/api/appointments` | `AppointmentIn` | `appointment` | Criar novo agendamento |
| PUT | `/api/appointments/{id}` | `AppointmentIn` | `appointment` | Editar/mover/status |
| DELETE | `/api/appointments/{id}` | — | `{ok:true}` | Excluir |
| GET | `/api/appointments/{id}/confirmation-link` | — | `{token}` | Link público de confirmação |
| POST | `/api/messages` | `MessageIn` | `{ok:true}` | Enfileira WhatsApp/SMS/email |
| GET | `/api/patients` | — | `[patient]` | Lista pacientes para dropdown |
| POST | `/api/patients` | `PatientIn` | `patient` | Pré-cadastro rápido |
| PUT | `/api/patients/{id}` | `PatientIn` | `patient` | Complementar cadastro |
| GET | `/api/patients/{id}/completeness` | — | `{complete, missing, patient}` | Checa se paciente pode ser atendido |
| GET | `/api/procedures?active_only=true` | — | `[procedure]` | Catálogo para dropdown |
| GET | `/api/users/professionals-public` | — | `[user]` | Lista profissionais |
| POST | `/api/attendance/start` | `{appointment_id}` | `session` | Cria/resume session |
| PUT | `/api/attendance/{sid}` | `AttendanceSessionIn` | `session` | Autosave draft |
| POST | `/api/attendance/{sid}/finalize` | `FinalizeAttendanceIn` | `{ok, record_id, financial_entries}` | Conclui atendimento (cria prontuário + financeiro + recibos) |
| GET | `/api/attendance/by-appointment/{id}` | — | `session` | Consulta session existente |
| GET | `/api/anamnesis-modules?patient_id` | — | `[module]` | Fichas do paciente |
| POST | `/api/anamnesis-modules` | `AnamnesisModuleIn` | `module` | Upsert de ficha |
| POST | `/api/ai/generate` | `{type, patient_id, notes, context}` | `{text}` | IA gera evolução/protocolo |
| GET | `/api/budgets?patient_id` | — | `[budget]` | Orçamentos do paciente |
| POST | `/api/budgets` | `BudgetIn` | `budget` | Criar orçamento |
| PUT | `/api/budgets/{id}` | `BudgetIn` | `budget` | Editar |
| POST | `/api/uploads` | multipart | `{file_id, url, sig}` | Upload de fotos |
| POST | `/api/mobile-upload/init` | `{context_type, context_id}` | `{token, qr_url}` | Init upload mobile |
| GET | `/api/mobile-upload/files/{token}` | — | `[files]` | Polling de fotos mobile |
| POST | `/api/documents` | `SignedDocumentIn` | `document` | Gerar termo/contrato |
| GET | `/api/finance/entries` | filtros | `[entry]` | Consulta pós-finalize |
| POST | `/api/finance/entries/{id}/receipt/email` | `{email?}` | `{ok, email_id}` | Envia recibo por email |
| GET | `/api/finance/entries/{id}/receipt/whatsapp-link` | — | `{whatsapp_url}` | Link wa.me pronto |

---

## 14. REGRAS DE NEGÓCIO IDENTIFICADAS

### Regras aplicadas hoje
1. **Paciente incompleto bloqueia atendimento** — `/api/patients/{id}/completeness` verifica name+cpf+birth_date+phone+lgpd_consent. Se incompleto, `stage="completion"` obriga preencher antes.
2. **Assinatura de evolução obrigatória para concluir** — validação frontend em `finalize()` (linha 214).
3. **Session é idempotente por appointment** — `POST /attendance/start` retorna a existente se já criada; nunca duplica.
4. **Recepção não pode iniciar atendimento** — `forbid_recepcao_clinical` bloqueia recepcao em `/attendance/*` (403).
5. **Sessão só é gravada como "concluido" no finalize** — updates intermediários mantêm `status="rascunho"`.
6. **Prontuário só é criado no finalize** — nada é escrito em `medical_records` durante o autosave.
7. **Financial_entries só são criados no finalize** — o `payment_status` do payload determina se gera 1, N ou 0 entries.
8. **Recibos são idempotentes por entry** — auto-gerados no `paid=true` transition, não regeneram sem `?force=true`.
9. **Autosave via debounce** — 800ms na aba Evolução, 900ms na FichaForm.
10. **Timer não bloqueia nada** — apenas exibido; `duration_seconds` é salvo no session e depois no medical_record.
11. **Aprovação pública de orçamento NÃO gera cobranças** — só marca `pending_charge_generation=true`.
12. **Appointment.status="concluido" é setado no finalize** — não há estado intermediário "em_atendimento" acionado automaticamente (embora exista no enum).
13. **Profissional só vê próprios orçamentos/prontuários** — `role_record_filter` filtra por `created_by=user_id` quando `role="profissional"`.
14. **Multi-tenant estrito** — todas as queries filtram por `clinic_id`.
15. **Anamnesis por profissional** — cada profissional tem sua própria `anamnesis_module` para o mesmo paciente + módulo; admin compartilha (server.py:1717-1719).

### Regras AUSENTES (não implementadas hoje — apenas documentar)
- Não obriga registrar procedimento com `procedure_id` (aceita string livre).
- Não obriga observations/evolution preenchidos para finalizar.
- Não bloqueia finalizar duas vezes (idempotência do finalize não é forte — segundo POST criaria novo medical_record e novos financial_entries).
- Não gera comissão automática para o profissional.
- Não marca `appointment.status="em_atendimento"` ao clicar iniciar.
- Não versiona edições no medical_record após finalize (imutável).
- Não avisa se o paciente tem cobrança em aberto antes de iniciar novo atendimento.
- Não avisa se há orçamento aprovado pendente de execução.

---

## 15. INTEGRAÇÕES EXISTENTES (mapeadas em pontos anteriores)

| Sistema | Onde | Fluxo |
| --- | --- | --- |
| **Financeiro** | finalize_attendance | Cria N `financial_entries` com parcelamento inteligente + recibos PDF |
| **Prontuário** | finalize_attendance | Cria doc em `medical_records` |
| **Orçamentos** | Aba Orçamento + finalize | Vincula `appointment_id`; aprova no finalize se `budget_id` no payload |
| **IA Clínica** | Aba Evolução + FichaForm | Claude 4.5 Sonnet via `/api/ai/generate` |
| **Documentos jurídicos** | Botão "Documento" no header | TCLE/Termos com QR mobile signing |
| **Object Storage** | PhotoUploader + Recibos | Fotos e PDFs com signed URLs |
| **Resend (email)** | Recibos | Envio pós-finalize opcional (aba Financeiro do paciente) |
| **WhatsApp (wa.me)** | Recibos | Link nativo (sem Evolution API ainda) |
| **Anamnesis Modules** | Aba Ficha | Autosave dinâmico por módulo |

---

## 16. RISCOS IDENTIFICADOS (READ-ONLY — documentando, sem propor solução)

1. 🔴 **Finalize não idempotente** — POST duplo em `/attendance/{sid}/finalize` criaria novo medical_record + novos financial_entries. Não há trava.
2. 🔴 **appointment.status="em_atendimento" nunca é setado** — status pula direto de "agendado/confirmado" para "concluido". Impossível saber "quem está sendo atendido agora" apenas pela agenda.
3. 🟠 **medical_records sem session_id** — perde-se o vínculo com a sessão original. Não se sabe se um prontuário nasceu de uma session ou foi criado manualmente.
4. 🟠 **anamnesis vs anamnesis_modules** — dois sistemas coexistem. `/anamnese` (legado) e AttendanceDialog (Ficha) escrevem em coleções diferentes.
5. 🟠 **procedure_id inconsistente** — aceito no schema mas o UI da Agenda ainda cria appointments com `procedure` (string livre) sem `procedure_id`. FK "fantasma".
6. 🟠 **evolution_signature única obrigatoriedade** — apenas a assinatura do profissional é obrigatória. TCLE do paciente é opcional.
7. 🟠 **RBAC frágil em `/attendance/*`** — `forbid_recepcao_clinical` bloqueia só a recepção; marketing consegue acessar.
8. 🟠 **Nenhum campo do paciente é editável dentro do atendimento** exceto na completion. Se descobrir alergia nova, precisa sair.
9. 🟡 **IA sem histórico dedicado** — respostas do `/api/ai/generate` não são logadas por si; só sobrevivem se salvas no session.
10. 🟡 **Fotos before/after sem timestamp** — arrays de URLs sem metadata (data/hora captura).
11. 🟡 **Nenhum lock/concurrency** — dois profissionais podem abrir o mesmo appointment em paralelo; o segundo simplesmente pega a session existente.
12. 🟡 **Toolbar de documentos no header não retorna feedback ao dialog** — se gerar TCLE no meio do atendimento, o dialog não sabe.

---

## 17. OPORTUNIDADES DE MELHORIA

### 17.1 Melhorias de UX
- **Bloco "em atendimento agora"** no header da Agenda — indicando qual paciente está com session ativa.
- **Timer com pausa manual** — permitir pausar o cronômetro (ex: paciente saiu para banheiro).
- **Editar dados do paciente dentro do dialog** — link/botão que abre PatientEdit em drawer lateral.
- **Prévia do prontuário** antes de finalizar — modal com o que será gravado.
- **Aviso de pendências financeiras** ao abrir o AttendanceDialog (paciente com R$ X vencido).
- **Sugestão de próxima consulta** no fim do fluxo (agendar retorno em N dias).
- **Barra de progresso das abas** (Ficha ✓ / Evolução ✓ / Prescrição — / Orçamento — / Assinatura ✓).
- **Confirmação forte antes de "Concluir"** — resumo do que será gerado.

### 17.2 Melhorias clínicas
- **Alertas de alergia visíveis no header** — puxando `patient.allergies` sempre.
- **Prontuário incremental** — permitir editar o record após finalize com log de versões (`medical_records_versions`).
- **Vincular session_id ao medical_record** — para rastrear origem.
- **Checklists pré-procedimento** por tipo de procedimento (Botox → jejum? gestante? etc).
- **Timeline pré-atendimento** — mostrar últimos 3 records do paciente na sidebar do dialog.
- **Comparador antes/depois visual** — slider entre `photos_before` e `photos_after`.

### 17.3 Melhorias operacionais
- **Idempotência do finalize** — chave `Idempotency-Key` no header ou `finalized_at` como trava.
- **Status "em_atendimento" real** — setar automaticamente ao entrar no AttendanceDialog.
- **Bloqueio contra double-booking do profissional** ao mover appointments (drag&drop atual permite conflitos).
- **Unificar anamnesis + anamnesis_modules** — decidir por uma das duas coleções e migrar a outra.
- **Auditoria de edições** em medical_records/attendance_sessions.
- **Cancelar sessão em andamento** — hoje só há "Salvar rascunho e sair" — não há "Descartar".

### 17.4 Melhorias financeiras
- **Módulo de comissões** — split do valor do finalize entre clínica e profissional (usa `professional_id` já populado).
- **Cobrança pré-atendimento** — no clique "Iniciar", perguntar se recepção já cobrou entrada.
- **Aviso "pagamento vencido"** — bloquear novo atendimento se paciente com R$ vencido > R$X.
- **Pacotes de sessões** — venda de "10 sessões de laser" com débito automático por atendimento.

### 17.5 Melhorias de automação
- **Envio automático de recibo por WhatsApp/Email** após finalize (hoje é manual na aba Financeiro).
- **Agendamento de retorno automático** baseado no procedimento (Botox → 4 meses).
- **Lembrete de anamnese vencida** (> 12 meses) no cabeçalho do dialog.
- **Auto-marcar appointment como "em atendimento"** quando session_id é criada.
- **Fechar automaticamente sessions "abandonadas"** (started_at > 24h e status=rascunho).

### 17.6 Melhorias de IA
- **Sugestão de evolução baseada nas respostas da FichaForm** — hoje IA usa só `observations`; poderia usar toda a anamnesis_module.
- **Detecção de red flags** (contraindicações do procedimento vs allergies do paciente).
- **Comparação IA de fotos antes/depois** — score de melhoria estimada.
- **Resumo executivo pós-atendimento** — 1 parágrafo em PT-BR gerado ao finalizar.
- **Sugestão automática de procedimento complementar** baseada no histórico.
- **Salvar histórico de respostas IA** em coleção dedicada (`ai_generations`) com session_id + type + prompt + response.

---

## 18. RESUMO EXECUTIVO

O fluxo de atendimento do ProClinic é **funcionalmente completo e coeso**, com integrações fortes com Prontuário, Financeiro, Orçamentos e IA. A arquitetura de sessions com autosave é sólida e o handoff Ficha→Evolução→Prescrição→Orçamento→Assinatura→Pagamento→Finalize é bem estruturado.

Os **maiores gaps** estão em:
- **Rastreabilidade** (session_id não vincula ao medical_record, sem histórico de IA, sem versionamento de records).
- **Idempotência** (finalize duplo criaria dados fantasmas).
- **Status intermediário** ("em_atendimento" nunca ativado — a agenda não sabe quem está sendo atendido em tempo real).
- **Duplicação anamnesis vs anamnesis_modules** (débito técnico).
- **Comissões / financeiro pré-atendimento** (não existe).
- **Edição de paciente durante o atendimento** (impossível hoje sem sair do fluxo).

A base é sólida para evoluir para uma experiência clínica premium com pequenos ajustes cirúrgicos — nenhum dos gaps exige reescrita.

---

**Fim da Auditoria — Fev/2026.**
