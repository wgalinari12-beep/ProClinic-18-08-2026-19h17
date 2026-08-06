#====================================================================================================
# START - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================

# THIS SECTION CONTAINS CRITICAL TESTING INSTRUCTIONS FOR BOTH AGENTS
# BOTH MAIN_AGENT AND TESTING_AGENT MUST PRESERVE THIS ENTIRE BLOCK

# Communication Protocol:
# If the `testing_agent` is available, main agent should delegate all testing tasks to it.
#
# You have access to a file called `test_result.md`. This file contains the complete testing state
# and history, and is the primary means of communication between main and the testing agent.
#
# Main and testing agents must follow this exact format to maintain testing data. 
# The testing data must be entered in yaml format Below is the data structure:
# 
## user_problem_statement: {problem_statement}
## backend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.py"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## frontend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.js"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## metadata:
##   created_by: "main_agent"
##   version: "1.0"
##   test_sequence: 0
##   run_ui: false
##
## test_plan:
##   current_focus:
##     - "Task name 1"
##     - "Task name 2"
##   stuck_tasks:
##     - "Task name with persistent issues"
##   test_all: false
##   test_priority: "high_first"  # or "sequential" or "stuck_first"
##
## agent_communication:
##     -agent: "main"  # or "testing" or "user"
##     -message: "Communication message between agents"

# Protocol Guidelines for Main agent
#
# 1. Update Test Result File Before Testing:
#    - Main agent must always update the `test_result.md` file before calling the testing agent
#    - Add implementation details to the status_history
#    - Set `needs_retesting` to true for tasks that need testing
#    - Update the `test_plan` section to guide testing priorities
#    - Add a message to `agent_communication` explaining what you've done
#
# 2. Incorporate User Feedback:
#    - When a user provides feedback that something is or isn't working, add this information to the relevant task's status_history
#    - Update the working status based on user feedback
#    - If a user reports an issue with a task that was marked as working, increment the stuck_count
#    - Whenever user reports issue in the app, if we have testing agent and task_result.md file so find the appropriate task for that and append in status_history of that task to contain the user concern and problem as well 
#
# 3. Track Stuck Tasks:
#    - Monitor which tasks have high stuck_count values or where you are fixing same issue again and again, analyze that when you read task_result.md
#    - For persistent issues, use websearch tool to find solutions
#    - Pay special attention to tasks in the stuck_tasks list
#    - When you fix an issue with a stuck task, don't reset the stuck_count until the testing agent confirms it's working
#
# 4. Provide Context to Testing Agent:
#    - When calling the testing agent, provide clear instructions about:
#      - Which tasks need testing (reference the test_plan)
#      - Any authentication details or configuration needed
#      - Specific test scenarios to focus on
#      - Any known issues or edge cases to verify
#
# 5. Call the testing agent with specific instructions referring to test_result.md
#
# IMPORTANT: Main agent must ALWAYS update test_result.md BEFORE calling the testing agent, as it relies on this file to understand what to test next.

#====================================================================================================
# END - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================



#====================================================================================================
# Testing Data - Main Agent and testing sub agent both should log testing data below this section
#====================================================================================================

user_problem_statement: |
  Lote 1 da auditoria ProClinic: (Fase 6) Travar atendimento FINALIZADO como imutável,
  com função de REABRIR exigindo justificativa obrigatória e registro permanente no prontuário
  (data/hora/usuário/IP). (Fase 1) Corrigir drag&drop da agenda. (Fase 2) Sistema único de cores de status.
  Nenhuma funcionalidade existente pode sofrer regressão.

backend:
  - task: "Fase 6 — Travar atendimento finalizado (PUT /attendance/{id} bloqueado quando concluido)"
    implemented: true
    working: true
    file: "backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "update_attendance agora retorna 423 se a sessão está 'concluido'. /attendance/start retorna read_only=true para sessão concluída (sem reabrir o appointment)."
        -working: true
        -agent: "testing"
        -comment: "✅ TESTED & WORKING. PUT /attendance/{session_id} correctly returns 423 (Locked) when session is 'concluido'. POST /attendance/start correctly returns read_only=true for finalized sessions. Lock message: 'Atendimento finalizado. Reabra o atendimento (com justificativa) para editar.'"

  - task: "Fase 6 — Reabrir atendimento com justificativa obrigatória + auditoria no prontuário"
    implemented: true
    working: true
    file: "backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "Novo POST /attendance/{session_id}/reopen. reason obrigatório (>=3 chars, senão 400). Só reabre se status=='concluido' (senão 400). Registra reopen_history na sessão E no medical_record (permanente no prontuário) com user/role/reason/ip/timestamp. Volta sessão para 'rascunho', appointment para 'em_atendimento', limpa finalized_result. Re-finalização não duplica medical_record nem lançamentos financeiros (dedupe por session_id)."
        -working: true
        -agent: "testing"
        -comment: "✅ TESTED & WORKING. POST /attendance/{session_id}/reopen correctly validates: (1) Empty/missing reason returns 400 with message 'Justificativa de reabertura é obrigatória.', (2) Valid reason reopens session to 'rascunho' status, (3) Audit trail (reopen_history) is permanently recorded in medical_record with all required fields: reopened_by, reopened_by_name, reopened_by_role, reason, reopened_at, ip, previous_finalized_at, session_number. (4) After reopen, PUT /attendance/{session_id} works correctly for editing. (5) Re-finalization does NOT duplicate medical_record or financial_entries (verified: exactly 1 record and 1 financial entry per session)."

  - task: "Regressão — finalize idempotente e criação de prontuário/financeiro"
    implemented: true
    working: true
    file: "backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "finalize agora usa replace_one por session_id (preserva record_id e reopen_history) e pula criação financeira se já existirem entries da sessão. Verificar que finalize normal (primeira vez) continua criando record + entries corretamente."
        -working: true
        -agent: "testing"
        -comment: "✅ TESTED & WORKING. Regression test passed: Normal flow (start + finalize first time) correctly creates medical_record and financial_entry. Re-finalization after reopen does NOT duplicate records (verified: exactly 1 medical_record and 1 financial_entry per session_id). Idempotency working correctly."

frontend:
  - task: "Fase 6 UI — modo somente-leitura + botão Reabrir (AttendanceDialog)"
    implemented: true
    working: "NA"
    file: "frontend/src/components/AttendanceDialog.jsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "Aguardando permissão do usuário para testar frontend."

  - task: "Fase 1 — Drag&drop overlay corrigido / Fase 2 — cores de status"
    implemented: true
    working: "NA"
    file: "frontend/src/pages/Agenda.jsx"
    stuck_count: 0
    priority: "medium"
    needs_retesting: false
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "Aguardando permissão do usuário para testar frontend."

metadata:
  created_by: "main_agent"
  version: "1.0"
  test_sequence: 1
  run_ui: false

test_plan:
  current_focus: []
  stuck_tasks: []
  test_all: false
  test_priority: "high_first"

agent_communication:
    -agent: "main"
    -message: |
      Testar SOMENTE o backend do Lote 1 (Fase 6). Credenciais em /app/memory/test_credentials.md
      (admin@proclinic.com / admin123). Fluxo sugerido:
      1) Login admin. Pegar um appointment (GET /api/appointments) e iniciar atendimento (POST /api/attendance/start).
      2) Finalizar (POST /api/attendance/{session_id}/finalize com payment_status ex.: 'pago' e amount_total).
      3) Confirmar que PUT /api/attendance/{session_id} agora retorna 423 (bloqueado).
      4) Confirmar que POST /api/attendance/start (mesmo appointment) retorna read_only=true.
      5) Testar reopen SEM reason -> 400; reopen com reason valido -> 200 e sessão volta a 'rascunho'.
      6) Após reopen, PUT /attendance/{id} deve funcionar novamente (editar evolução).
      7) Re-finalizar e garantir que NÃO duplicou medical_record nem financial_entries (mesmo session_id).
      8) Confirmar reopen_history presente no medical_record (GET /api/medical-records?patient_id=...).
      NÃO testar frontend agora.
    -agent: "testing"
    -message: |
      ✅ ALL BACKEND TESTS PASSED (15/15)
      
      Comprehensive testing completed for Fase 6 (Lote 1):
      
      CRITICAL FLOW TESTS (11 tests):
      1. ✅ Login admin - Token obtained successfully
      2. ✅ Get appointment - Found suitable appointment (not concluido/cancelado)
      3. ✅ Start attendance - Session created with status 'rascunho'
      4. ✅ Finalize attendance - Medical record + financial entry created (Session#: ATT-2026-000004)
      5. ✅ Validate lock - PUT /attendance/{session_id} correctly returns 423 (Locked)
      6. ✅ Validate read_only - POST /attendance/start returns read_only=true for finalized session
      7. ✅ Validate reason required - POST /attendance/{session_id}/reopen with empty reason returns 400
      8. ✅ Reopen with valid reason - Session reopened to 'rascunho', reopen_history recorded
      9. ✅ Edit after reopen - PUT /attendance/{session_id} works correctly after reopening
      10. ✅ Re-finalize no duplication - Exactly 1 medical_record and 1 financial_entry per session_id
      11. ✅ Validate audit trail - reopen_history present in medical_record with all required fields
      
      REGRESSION TESTS (4 tests):
      12. ✅ Get appointment for regression test
      13. ✅ Start attendance (normal flow)
      14. ✅ Validate medical_record created on first finalization
      15. ✅ Validate financial_entry created on first finalization
      
      ALL FEATURES WORKING CORRECTLY. No critical issues found.
