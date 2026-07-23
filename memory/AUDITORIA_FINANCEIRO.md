# AUDITORIA DO ECOSSISTEMA FINANCEIRO — ProClinic

> **Escopo:** mapeamento _read-only_ do estado atual (Fev/2026) do módulo Financeiro e de todos os pontos de acoplamento com Pacientes, Agenda, Atendimento, Prontuário, Procedimentos, Orçamentos e Dashboards.
> **Objetivo:** servir de base para o overhaul do Ecossistema Financeiro sem introduzir regressões.
> **Regra do usuário:** _NÃO IMPLEMENTAR_ nada até este relatório ser aprovado.
> **Autor:** E1 (auditoria automatizada + leitura completa do código).
> **Referência de código:** `/app/backend/server.py` (3.884 linhas) e `/app/frontend/src/`.

---

## 1. SUMÁRIO EXECUTIVO

| Aspecto | Status atual | Nível de risco para o overhaul |
| --- | --- | --- |
| Coleção MongoDB `financial_entries` | Existe, schema mínimo, **sem índices** | 🟠 Médio — precisará de migração aditiva |
| Endpoints CRUD `/finance/*` | 5 endpoints (list/create/update/delete/summary) | 🟢 Baixo — reutilizáveis |
| Geração automática em `/attendance/{id}/finalize` | Existe (pago/parcial/nao_pago) | 🟠 Médio — precisa evoluir para parcelas N>2 |
| Vínculo `budget.installments` → parcelas reais | **INEXISTENTE** (campo salvo mas não gera parcelas) | 🔴 Alto — funcionalidade prometida no UI e não entregue |
| Vínculo com `procedure_id` (catálogo) | **INEXISTENTE** (usa string livre em `category`) | 🟠 Médio — relacional novo |
| Vínculo com `professional_id` | **INEXISTENTE** (apenas `created_by`, que é o operador) | 🟠 Médio — relacional novo |
| RBAC de `/finance/*` no backend | **INEXISTENTE** — qualquer role autenticado acessa | 🔴 Alto — vazamento entre módulos hoje |
| Frontend `Financeiro.jsx` | 190 linhas, funcional básico, sem filtros/exports/parcelas | 🟢 Baixo — precisará ser reescrito |
| Dashboard `/dashboard/stats` consumidor | Usa `/finance/summary` (mensal simples) | 🟢 Baixo — não quebra ao expandir |
| Recibos PDF (comprovantes de recebimento) | **INEXISTENTE** (só existe PDF de faturas SaaS) | 🟠 Médio — arquitetura nova |
| Projeção fluxo de caixa 30/60/90/180 | **INEXISTENTE** | 🟠 Médio — só cálculo, sem impacto em dados |
| DRE simplificado | **INEXISTENTE** | 🟠 Médio — só cálculo |
| Exports CSV/Excel/PDF | **INEXISTENTE** | 🟢 Baixo — endpoint novo |
| Log de auditoria de lançamentos | **INEXISTENTE** (só `created_by`, sem histórico de edição) | 🟠 Médio — coleção nova ou embed |
| Arquitetura fiscal (NF-e/NFSe placeholders) | **INEXISTENTE** | 🟢 Baixo — pode ser adicionada de forma isolada |
| Semeadura demo (`seed_data`) | Insere 7 entradas sem `patient_id/appointment_id/budget_id` | 🟠 Médio — precisa atualização para novo schema |

**Diagnóstico geral:** o módulo Financeiro é um MVP funcional, mas **relacionalmente pobre** (foreign keys opcionais, sem enriquecimento em queries) e **sem inteligência** (sem projeções, sem parcelas, sem recibos). A maior parte do overhaul será **aditiva** (novos campos opcionais + novos endpoints + novas coleções), sem quebrar chamadas existentes — desde que os defaults sejam preservados.

---

## 2. MAPA DE MODELOS (BACKEND — `/app/backend/server.py`)

### 2.1 `FinancialEntryIn` / `FinancialEntryOut`  (linhas 161–177)
```python
class FinancialEntryIn(BaseModel):
    type: Literal["receita", "despesa"]      # obrigatório
    category: str                            # string livre — sem taxonomia
    description: str
    amount: float
    due_date: str                            # ISO YYYY-MM-DD (string, não datetime)
    paid: bool = False
    payment_method: Optional[str] = None     # "pix" | "cartão" | "dinheiro" | "boleto" | "parcelado" (não enum)
    patient_id: Optional[str] = None
    budget_id: Optional[str] = None
    appointment_id: Optional[str] = None

class FinancialEntryOut(FinancialEntryIn):
    entry_id: str                             # prefixo "fin_" + 12 hex
    clinic_id: str
    created_at: str                           # ISO datetime
```

**Campos presentes no MongoDB mas NÃO declarados no schema Pydantic** (adicionados via `insert_one` em `finalize_attendance`, linhas 1502–1580):
- `paid_at` (string ISO) — presente quando `paid=True`
- `created_by` (user_id do operador que finalizou o atendimento)
- Nada mais.

**Campos AUSENTES que serão necessários no overhaul:**
- `procedure_id` (link com o catálogo `procedures`)
- `professional_id` (o profissional que executou — distinto do operador)
- `updated_at`, `updated_by`
- `installment_group_id` (para agrupar parcelas 1/N .. N/N)
- `installment_number`, `installment_total`
- `cost_center` (para despesas)
- `notes` (livre)
- `receipt_url` (recibo PDF armazenado)
- `fiscal_document_id` (placeholder futuro NF-e/NFSe)
- Enum forte para `payment_method` e `category`

### 2.2 `BudgetIn` / `BudgetItemIn`  (linhas 180–198)
```python
class BudgetItemIn(BaseModel):
    procedure_id: Optional[str] = None
    name: str
    quantity: int = 1
    unit_price: float = 0
    discount_percent: float = 0
    discount_value: float = 0

class BudgetIn(BaseModel):
    patient_id: str
    appointment_id: Optional[str] = None
    items: List[BudgetItemIn] = []
    notes: Optional[str] = None
    payment_method: Optional[str] = None    # inclui "parcelado" como opção
    installments: int = 1                   # ⚠️ CAMPO EXISTE MAS NÃO GERA PARCELAS
    valid_until: Optional[str] = None
    status: Literal["rascunho", "enviado", "aprovado", "recusado", "expirado"] = "rascunho"
    patient_signature: Optional[str] = None
```
**Observação crítica:** `installments` fica salvo no orçamento, mas em nenhum lugar do código (nem em `finalize_attendance`, nem em `sign_public_budget`) esse número é usado para gerar múltiplos `financial_entries`. Isso é um **débito técnico já existente** e uma das prioridades da Fase 2.5.

### 2.3 `AppointmentIn`  (linhas 105–116)
Campos relevantes ao financeiro:
- `price: Optional[float] = 0` — fallback quando não há orçamento vinculado.
- **AUSENTE:** `procedure_id` (o campo `procedure` é string livre — sem link com catálogo).

### 2.4 `ProcedureIn`  (linhas 1923–1929)
```python
class ProcedureIn(BaseModel):
    name: str
    description: Optional[str] = None
    price: float = 0
    duration_minutes: int = 60
    category: Optional[str] = None
    active: bool = True
```
Existe catálogo, mas **não é usado como FK** em `appointments`, `financial_entries` nem `budgets.items` (o `procedure_id` no item de orçamento é opcional e nunca é populado pelo UI atual do BudgetEditor — validar durante o overhaul).

### 2.5 `FinalizeAttendanceIn`  (linhas 1444–1450)
```python
class FinalizeAttendanceIn(BaseModel):
    payment_status: Optional[Literal["pago", "parcial", "nao_pago"]] = None
    amount_total: Optional[float] = None
    amount_paid: Optional[float] = None
    payment_method: Optional[str] = None
    budget_id: Optional[str] = None
    due_date: Optional[str] = None
```
Não aceita hoje: número de parcelas, datas de vencimento por parcela, entrada + N parcelas.

### 2.6 Modelos SaaS (não confundir com Financeiro clínico)
Estas coleções são **do SaaS** (Asaas) e **NÃO** devem ser mescladas com o Financeiro clínico:
- `subscriptions`, `payments` (Asaas), `invoices` (faturas SaaS), `coupons`, `webhook_events`, `plans`.
Preservar essa separação é fundamental — as receitas do SaaS pagam a **Emergent**, as receitas clínicas pagam a **clínica**.

---

## 3. COLEÇÕES MONGODB TOCADAS PELO FINANCEIRO

| Coleção | Uso pelo financeiro | Índices atuais |
| --- | --- | --- |
| `financial_entries` | **Coleção principal** — CRUD + summary + geração auto | **Nenhum índice!** (linha 916–921, apenas `users`, `patients`, `appointments` têm) |
| `budgets` | Origem de `total` e vínculo `budget_id` | Nenhum índice explícito |
| `appointments` | Origem de `price` fallback, e `appointment_id` no lançamento | `appointment_id` unique |
| `patients` | Enriquecimento `patient_name` (feito em runtime hoje) | `patient_id` unique |
| `attendance_sessions` | Ponto de disparo da geração automática | Nenhum índice |
| `medical_records` | Criado em `finalize_attendance` (paralelo ao financeiro) | Nenhum índice |
| `procedures` | Catálogo — **NÃO** referenciado hoje pelo financial_entries | Nenhum índice |
| `clinics` | Para `clinic_id` (multi-tenant) | Nenhum |

**🔴 Alerta:** a ausência total de índices em `financial_entries` é aceitável hoje (dataset pequeno), mas **será gargalo** com filtros por `due_date`, `paid`, `patient_id`, `type`, projeções agregadas. Precisa ser corrigido junto com o overhaul.

---

## 4. MAPA DE ENDPOINTS (BACKEND)

### 4.1 Endpoints Financeiros diretos
| Método | Rota | Linha | Auth | RBAC | Papel principal |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/finance/entries` | 718–723 | ✅ get_current_user | ❌ **Nenhum** | Lista todos os lançamentos da clínica ordenados por `due_date` desc |
| POST | `/api/finance/entries` | 726–737 | ✅ | ❌ **Nenhum** | Cria lançamento manual |
| PUT | `/api/finance/entries/{entry_id}` | 740–751 | ✅ | ❌ **Nenhum** | Substituição total do doc (usa `data.model_dump()`) — ⚠️ pode zerar campos extras |
| DELETE | `/api/finance/entries/{entry_id}` | 754–759 | ✅ | ❌ **Nenhum** | Hard delete |
| GET | `/api/finance/summary` | 762–791 | ✅ | ❌ **Nenhum** | Totais + chart 6 meses (calendário) |

**🔴 Riscos identificados:**
1. **RBAC ausente:** `profissional` e `marketing` podem chamar todos os endpoints hoje. O Sidebar oculta o menu, mas a API não bloqueia. Overhaul precisa aplicar `require_role({"admin","financeiro","recepcao"})`.
2. **PUT destrutivo:** `model_dump()` do Pydantic sobrescreve TUDO. Se o overhaul adicionar campos internos (`installment_group_id`, `paid_at`, `created_by`), um PUT antigo pode apagá-los. Mitigação: mudar para `$set` de campos permitidos ou usar `PatchIn`.
3. **`/finance/summary` não filtra por período:** sempre calcula tudo. Não escala.

### 4.2 Endpoints que INSEREM em `financial_entries`
| Origem | Linha | Ação | Campos preenchidos |
| --- | --- | --- | --- |
| `POST /finance/entries` | 735 | Manual | Todos do schema + `entry_id`, `clinic_id`, `created_at` |
| `POST /attendance/{session_id}/finalize` | 1547, 1562, 1571, 1580 | Auto ao concluir atendimento | + `paid_at`, `created_by`, `type=receita` fixo, `category="Procedimentos"` fixo |
| `seed_data` | 1098 | Semeadura demo | Sem `patient_id/appointment_id/budget_id` (todos null) |

### 4.3 Endpoints que LEEM `financial_entries`
| Origem | Linha | Propósito |
| --- | --- | --- |
| `/finance/entries` | 720 | Listagem principal |
| `/finance/summary` | 764 | Totalizador + chart 6 meses |
| `/dashboard/stats` | 816 | KPI "Faturamento do mês" (só receitas pagas) |
| `/admin/finance/summary` | 3287+ | Financeiro **cross-tenant** para super-admin (⚠️ analisar impacto) |

### 4.4 Endpoints tangenciais que precisam ser mapeados (não escrevem financeiro, mas alimentam contexto)
| Rota | Impacto no overhaul |
| --- | --- |
| `POST /budgets` (linha 1660) | Cria o orçamento. Overhaul deve considerar auto-gerar cobrança quando `status → aprovado` (hoje só o finalize faz isso). |
| `POST /public/budgets/{token}/sign` (linha 1768) | Paciente aprova pelo link público → orçamento vira "aprovado", **mas nenhum lançamento é criado**. Gap importante. |
| `POST /appointments` (linha 581) | Não gera financeiro. |
| `POST /procedures` (linha 1941) | Só catálogo. |
| `POST /medical-records` (linha 662) | Registro clínico independente. |

---

## 5. FLUXOS EXISTENTES DE CRIAÇÃO DE LANÇAMENTO

### 5.1 Fluxo Manual (Financeiro.jsx)
```
Usuário → /financeiro → "Novo lançamento" → Dialog
  ↓ POST /finance/entries { type, category, description, amount, due_date, paid, payment_method }
Backend cria entry SEM vínculos (patient_id/budget_id/appointment_id = null)
```
**Gap:** UI não permite escolher paciente, procedimento, orçamento ou parcelamento.

### 5.2 Fluxo Automático (Atendimento → Financeiro)
```
Agenda → clique no evento → AttendanceDialog
  ↓ atende, finaliza rascunho
  ↓ abre CompletePaymentDialog
  ↓ escolhe: "pago" | "parcial" | "nao_pago"
  ↓ POST /attendance/{session}/finalize { payment_status, amount_total, amount_paid?, payment_method, budget_id?, due_date? }
Backend (linhas 1502–1590):
  - Se "pago": 1 entry paid=True, due_date=hoje
  - Se "parcial": 2 entries (entrada paid=True + saldo paid=False com due_date custom)
  - Se "nao_pago": 1 entry paid=False, due_date=custom
  - Se budget_id: budget.status → "aprovado"
```
**Gaps:**
- Sempre `type="receita"` e `category="Procedimentos"` (hardcoded na linha 1530–1531).
- Se `payment_method="parcelado"` chega aqui, é apenas registrado como string; **não gera parcelas**.
- Não copia `procedure_id`, `professional_id` (tem `created_by`, que é o operador).
- Se o orçamento tem `installments=6`, esse número é ignorado.

### 5.3 Fluxo Orçamento Público (bug silencioso)
```
Cliente clica no link público → aprova → POST /public/budgets/{token}/sign
  ↓ budget.status = "aprovado"
  ↓ ⚠️ NENHUMA entry criada
```
Se o atendimento não for finalizado depois, a receita nunca é registrada.

### 5.4 Toggle "pago/pendente" (frontend)
```
Financeiro.jsx → clique no badge → PUT /finance/entries/{entry_id} { ...entry, paid: !entry.paid }
```
**Problemas:**
1. Não seta `paid_at`.
2. PUT destrutivo (ver 4.1).
3. Sem log de auditoria de quem/quando alterou.

---

## 6. MAPA DE FRONTEND

### 6.1 `pages/Financeiro.jsx`  (190 linhas)
- **Consome:** `GET /finance/entries`, `GET /finance/summary`, `POST /finance/entries`, `PUT /finance/entries/{id}`.
- **UI:** 4 KPIs (receitas pagas / despesas pagas / saldo / a receber) + chart 6 meses (BarChart) + lista simples de lançamentos.
- **Ausente:** filtros (período, status, tipo, paciente), busca, paginação, ordenação, colunas de vínculo (paciente/procedimento), exports, ações em lote, dialog de detalhes.

### 6.2 `pages/Dashboard.jsx`  (linha 47–58)
- Consome `/finance/summary` para AreaChart de 6 meses + KPI de saldo.
- Nenhum acesso direto a `entries`. Reescrita do `/finance/summary` deve **preservar o formato de resposta** (`{receitas, despesas, saldo, a_receber, a_pagar, chart: [{mes, receita, despesa}]}`).

### 6.3 `components/CompletePaymentDialog.jsx`  (140 linhas)
- Aciona `onConfirm(payload)` → o AttendanceDialog faz `POST /attendance/{session}/finalize`.
- Payload aceita: `payment_status`, `amount_total`, `amount_paid`, `payment_method`, `due_date`, `budget_id`.
- **Ausente:** número de parcelas, vencimentos por parcela, entrada + N parcelas.

### 6.4 `components/AttendanceDialog.jsx`  (528 linhas)
- Linha 247: chama `finalize` com o payload do CompletePaymentDialog.
- Após sucesso, notifica `"Atendimento concluído e financeiro lançado"`.

### 6.5 `components/BudgetEditor.jsx`  (283 linhas)
- Salva `installments` mas não vincula a nenhum fluxo de geração de parcelas.
- **UI já tem select de `payment_method` com opção "parcelado"** — inconsistência: promete parcelamento, não entrega.

### 6.6 `pages/PatientDetail.jsx`  (359 linhas)
- Aba "Orçamentos" existe. **Aba "Financeiro"/"Histórico Financeiro" do paciente NÃO existe.**
- Timeline consolida `appointments`, mas não mostra pendências financeiras.

### 6.7 `components/Sidebar.jsx`  (linha 21)
- Menu Financeiro visível para `admin | financeiro | recepcao`.
- ⚠️ `recepcao` tem acesso à página Financeiro no frontend, mas em muitas clínicas isso é intencional. Manter.

### 6.8 `pages/Login.jsx` / `pages/Equipe.jsx`
- Papel `financeiro` já é reconhecido em cadastro/gestão de equipe.

### 6.9 Rotas React
```
App.js: <Route path="financeiro" element={<Financeiro />} />
```
Nenhuma rota `/financeiro/:id`, `/financeiro/parcelas`, `/financeiro/relatorios` existe.

---

## 7. RBAC — MATRIZ ATUAL vs. NECESSÁRIA

### 7.1 Papéis suportados no sistema (linha 53, 2249)
`admin`, `financeiro`, `recepcao`, `profissional`, `marketing`, `paciente`, `super_admin`

### 7.2 Backend — proteção **atual** dos endpoints financeiros
| Endpoint | Auth | Role check |
| --- | --- | --- |
| `GET/POST/PUT/DELETE /finance/entries*` | ✅ | ❌ **Nenhum** |
| `GET /finance/summary` | ✅ | ❌ **Nenhum** |
| `POST /attendance/{id}/finalize` (gera entries) | ✅ | ✅ `forbid_recepcao_clinical` (recepção NÃO pode) — mas admin/financeiro/marketing SIM |

### 7.3 Frontend — visibilidade **atual**
| Papel | Vê menu Financeiro? | Pode chamar API financeira? |
| --- | --- | --- |
| admin | Sim | Sim |
| financeiro | Sim | Sim |
| recepcao | Sim | Sim |
| profissional | Não (Sidebar oculta) | **Sim (backend permite)** ← vazamento |
| marketing | Não (Sidebar oculta) | **Sim (backend permite)** ← vazamento |
| super_admin | Não (rota bloqueada por ProtectedRoute) | Não |
| paciente | Não | Não |

### 7.4 RBAC **necessária** para o overhaul
- **Leitura completa:** admin, financeiro, recepcao (com filtros para não vazar despesas se o cliente quiser).
- **Escrita/Edição/Delete:** admin, financeiro.
- **Marcar como pago (recebimento no caixa):** admin, financeiro, recepcao.
- **Ver DRE/relatórios gerenciais:** admin, financeiro.
- **Profissional:** apenas o próprio faturamento (novo endpoint `/finance/entries/mine` — se aprovado).

---

## 8. INTEGRAÇÕES E DEPENDÊNCIAS EXTERNAS

| Dependência | Impacto no overhaul |
| --- | --- |
| **Asaas (SaaS)** | Separado. Coleções `payments`/`invoices`/`subscriptions` **não devem** ser mescladas com Financeiro clínico. |
| **xhtml2pdf / reportlab** | Já instalado — será reutilizado para gerar Recibos PDF. |
| **openpyxl / xlsxwriter** | **Não instalado** — precisará ser adicionado para export Excel. |
| **csv (stdlib)** | Disponível — sem custo. |
| **Emergent Object Storage** | Já usado para fotos/faturas — reutilizável para armazenar recibos PDF com signed URLs. |
| **Resend** | Já configurado — poderá enviar recibo por email ao paciente (opcional). |
| **Evolution API (WhatsApp)** | Ainda futuro (P2). |

---

## 9. PONTOS DE ACOPLAMENTO — ONDE INJETAR OS NOVOS VÍNCULOS

Estes são os locais **exatos** onde o overhaul precisa tocar:

### 9.1 Model layer (`server.py` ~linha 161)
- Adicionar novos campos opcionais em `FinancialEntryIn/Out` — todos com default `None` para preservar payloads antigos.

### 9.2 Endpoint de finalização (`server.py` ~linha 1502)
- Estender `FinalizeAttendanceIn` para aceitar `installments: int = 1`, `installment_first_due: str`, `installment_interval_days: int = 30`.
- Gerar N `financial_entries` com `installment_group_id` compartilhado, `installment_number` e `installment_total`.
- Copiar `procedure_id` a partir de `appointment.procedure_id` (⚠️ campo hoje ausente em `AppointmentIn` — decisão: adicionar como opcional).
- Copiar `professional_id` a partir de `appointment.professional_id`.

### 9.3 Endpoint de aprovação pública de orçamento (`server.py` ~linha 1768)
- Se `budget.installments > 1` e `budget.status → aprovado`, criar as N entries automaticamente (ou marcar `pending_charge_generation=True` para revisão manual — decisão do usuário).

### 9.4 Auto-lançamento cross-source
- Criar helper `_create_financial_entries_from_context(patient_id, procedure_id, professional_id, appointment_id, budget_id, total, installments, payment_method, ...)` — chamado em: `finalize_attendance`, `sign_public_budget`, futuros pontos.

### 9.5 Frontend
- `Financeiro.jsx`: reescrita com filtros, tabela avançada, ações em lote, dialog de detalhes, aba de parcelas.
- `PatientDetail.jsx`: adicionar aba "Financeiro" mostrando entries do paciente.
- `CompletePaymentDialog.jsx`: adicionar UI de parcelamento (nº parcelas + primeiro vencimento + intervalo).
- Novo componente: `FinancialEntryDialog.jsx` (criação/edição rica com autocomplete de paciente/procedimento).
- Novo componente: `CashFlowProjection.jsx` (30/60/90/180 dias).
- Novo componente: `SimpleDRE.jsx` (Receitas – Custos Diretos – Despesas Operacionais).

---

## 10. GAPS FUNCIONAIS vs. ESCOPO DO OVERHAUL

| Requisito do usuário | Existe hoje? | Complexidade estimada |
| --- | --- | --- |
| Vincular finanças a paciente/agenda/procedimento/orçamento | Parcial (paciente/agenda/orçamento sim; procedimento não) | 🟡 Média |
| Parcelamento inteligente (status + vencimento por parcela) | ❌ Não | 🔴 Alta |
| Geração auto de cobrança na conclusão de atendimento | ✅ Sim (básico) | 🟢 Baixa (evolução) |
| Geração auto na venda/aprovação de procedimento (orçamento) | ❌ Parcial (só marca aprovado) | 🟡 Média |
| Projeção fluxo de caixa 30/60/90/180 | ❌ Não | 🟡 Média |
| DRE simplificado | ❌ Não | 🟡 Média |
| Recibos PDF | ❌ Não | 🟡 Média |
| Arquitetura fiscal (interfaces NF-e/NFSe) | ❌ Não | 🟢 Baixa (só placeholders) |
| Export CSV/Excel/PDF | ❌ Não | 🟡 Média |
| Filtros avançados na listagem | ❌ Não | 🟢 Baixa |
| Auditoria (log de edições) | ❌ Não | 🟡 Média |
| RBAC no backend | ❌ **Vulnerabilidade atual** | 🟢 Baixa (aplicar decorators) |
| Índices MongoDB | ❌ Nenhum | 🟢 Baixa |

---

## 11. ESTRATÉGIA DE MIGRAÇÃO SEM REGRESSÃO

### 11.1 Regras invioláveis
1. **Toda alteração de schema deve ser aditiva.** Novos campos com default `None` ou `[]`. Documentos antigos continuam válidos.
2. **`GET /finance/entries` e `GET /finance/summary` mantêm o contrato de resposta atual** para não quebrar `Dashboard.jsx` e o `Financeiro.jsx` legado durante a transição.
3. **`PUT /finance/entries/{id}` deve deixar de ser destrutivo.** Substituir por `$set` seletivo antes de qualquer novo campo interno ser adicionado.
4. **Novos endpoints devem coexistir:** `/finance/entries/v2`, `/finance/installments`, `/finance/reports/cashflow`, `/finance/reports/dre`, `/finance/receipts/{id}/pdf`, `/finance/export`.
5. **Backfill opcional** de documentos antigos: rodar migração idempotente que popula `installment_group_id=entry_id`, `installment_number=1`, `installment_total=1` para entries pré-existentes.
6. **RBAC deve ser aplicado em passo separado** (uma PR só de segurança) para facilitar rollback se algo quebrar.

### 11.2 Ordem sugerida de implementação (para discussão)
1. Índices MongoDB + RBAC nos endpoints atuais (baixo risco, ganho imediato). 🟢
2. Extensão do schema `FinancialEntry` com novos campos opcionais + PUT não-destrutivo. 🟢
3. `installment_group_id` + geração de parcelas em `finalize_attendance`. 🟡
4. Vínculo `procedure_id` + `professional_id` end-to-end (Appointments → Attendance → Financial). 🟡
5. Auto-lançamento em `sign_public_budget`. 🟡
6. Endpoints de projeção (cashflow 30/60/90/180) + DRE. 🟡
7. Recibos PDF + arquitetura fiscal (placeholders). 🟡
8. Exports CSV/Excel/PDF. 🟢
9. Refatoração completa do `Financeiro.jsx` com filtros/ações. 🟡
10. Aba "Financeiro" em `PatientDetail.jsx`. 🟢
11. Log de auditoria (coleção `financial_audit_logs`). 🟢

Cada etapa termina com **regressão automatizada** via testing agent, focando em:
- `/finance/summary` produz mesmos totais antes/depois.
- `dashboard/stats.revenue_month` inalterado.
- Fluxo do atendimento continua criando entries corretamente.

---

## 12. RISCOS ESPECÍFICOS DO OVERHAUL

| Risco | Probabilidade | Impacto | Mitigação |
| --- | --- | --- | --- |
| Perda de dados em PUT destrutivo com novo schema | Alta se não corrigir antes | Crítico | Corrigir PUT **antes** de adicionar campos |
| Dashboard.jsx quebrar com novo formato de summary | Média | Alto | Manter contrato do `/finance/summary` legado |
| RBAC introduzido quebrar fluxos usados por outros papéis | Média | Alto | Aplicar em coleção de endpoints separada, testar cada role |
| `financial_entries` sem índice → timeout com filtros novos | Alta em dados reais | Alto | Criar índices `(clinic_id, due_date)`, `(clinic_id, patient_id)`, `(clinic_id, paid, type)` no início |
| Backfill de `installment_group_id` corromper entries existentes | Baixa | Alto | Idempotência + verificação `if not doc.get("installment_group_id")` |
| Geração duplicada de entries no atendimento (dupla finalização) | Média | Médio | Adicionar `unique_key = f"{session_id}:{group}"` + índice sparse unique |
| Frontend novo consumir endpoints antigos + novos misturado | Média | Baixo | Feature flag ou route split (`/financeiro` legado, `/financeiro-v2` novo) |

---

## 13. CHECKLIST DE APROVAÇÃO PARA O USUÁRIO

Antes de escrever qualquer código, precisamos alinhar:

1. **Segurança primeiro?** OK aplicar RBAC + índices **antes** de qualquer feature nova? (Recomendação: sim, ~30 min de trabalho, elimina vulnerabilidade e prepara terreno.)
2. **PUT não-destrutivo antes de tudo?** OK converter `PUT /finance/entries/{id}` para atualização seletiva? (Recomendação: sim, evita perda de dados quando novos campos entrarem.)
3. **Escopo do parcelamento:** parcelas iguais com intervalo fixo (30d), ou também suportar valores/datas customizadas por parcela na criação? (Recomendação: começar com igual + intervalo, deixar customização como P1.)
4. **Auto-lançamento na aprovação do orçamento público:** criar entries automaticamente ou apenas marcar `pending_charge_generation` para revisão manual pela clínica? (Recomendação: revisão manual — orçamento aprovado pelo paciente ≠ atendimento realizado.)
5. **Categoria "Procedimentos" hoje é string livre**: manter livre + adicionar `procedure_id` opcional, ou migrar para taxonomia normalizada? (Recomendação: manter livre + adicionar `procedure_id`; usuários gostam de categoria livre para casos edge.)
6. **DRE simplificado**: incluir depreciação/imposto/prolabore ou apenas Receitas – Despesas por categoria? (Recomendação: começar simples — Receitas / Custo direto (produtos vendidos) / Despesas operacionais / Resultado líquido.)
7. **Recibos PDF**: numeração sequencial por clínica ou aleatória? (Recomendação: sequencial `REC-YYYY-####` — profissionalismo + rastreabilidade.)
8. **Exports**: enviar por email (assíncrono via Resend) ou download imediato? (Recomendação: começar com download imediato; adicionar envio por email quando datasets ficarem grandes.)

---

## 14. RESUMO — O QUE PRECISAMOS DA APROVAÇÃO DO USUÁRIO

- ✅ Auditoria confirma que o módulo Financeiro atual é **funcional mas relacionalmente pobre**.
- ✅ Existem 2 débitos técnicos críticos já latentes: **RBAC ausente no backend** e **PUT destrutivo**.
- ✅ 90% do overhaul pode ser **aditivo** e não quebra o legado — desde que os defaults sejam preservados.
- ✅ O único fluxo que **hoje já promete parcelamento mas não entrega** é o orçamento com `installments > 1`.
- ⏳ Aguardando respostas do usuário nas 8 perguntas do checklist (seção 13) para começar a Fase 2.5A.

---

**Fim da Auditoria — Fev/2026.**
