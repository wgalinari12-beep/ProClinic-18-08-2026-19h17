#!/usr/bin/env python3
"""
ProClinic Backend Test Suite - Fase 6 (Lote 1)
Tests attendance finalization lock, reopen with audit trail, and regression checks.
"""

import requests
import json
import sys
from typing import Dict, Any, Optional

# Backend URL from frontend/.env
BASE_URL = "https://medical-hub-131.preview.emergentagent.com/api"

# Test credentials from /app/memory/test_credentials.md
ADMIN_EMAIL = "admin@proclinic.com"
ADMIN_PASSWORD = "admin123"

# Test state
token: Optional[str] = None
appointment_id: Optional[str] = None
patient_id: Optional[str] = None
session_id: Optional[str] = None
record_id: Optional[str] = None
session_number: Optional[str] = None

# Test results
test_results = []


def log_test(name: str, passed: bool, details: str = ""):
    """Log test result"""
    status = "✅ PASS" if passed else "❌ FAIL"
    result = f"{status} | {name}"
    if details:
        result += f"\n    Details: {details}"
    test_results.append((name, passed, details))
    print(result)


def make_request(method: str, endpoint: str, data: Any = None, expected_status: int = 200) -> tuple[bool, Any, int]:
    """Make HTTP request and return (success, response_data, status_code)"""
    url = f"{BASE_URL}{endpoint}"
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    
    try:
        if method == "GET":
            resp = requests.get(url, headers=headers, timeout=30)
        elif method == "POST":
            resp = requests.post(url, headers=headers, json=data, timeout=30)
        elif method == "PUT":
            resp = requests.put(url, headers=headers, json=data, timeout=30)
        elif method == "DELETE":
            resp = requests.delete(url, headers=headers, timeout=30)
        else:
            return False, {"error": f"Unknown method: {method}"}, 0
        
        status_ok = resp.status_code == expected_status
        try:
            response_data = resp.json()
        except Exception:
            response_data = {"text": resp.text, "status": resp.status_code}
        
        return status_ok, response_data, resp.status_code
    except Exception as e:
        return False, {"error": str(e)}, 0


def test_1_login():
    """Test 1: Login as admin and obtain JWT token"""
    global token
    
    success, data, status = make_request(
        "POST", 
        "/auth/login",
        {"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        200
    )
    
    if success and data.get("token"):
        token = data["token"]
        log_test("1. Login admin", True, f"Token obtained, user: {data.get('name')}, role: {data.get('role')}")
        return True
    else:
        log_test("1. Login admin", False, f"Status: {status}, Response: {data}")
        return False


def test_2_get_appointment():
    """Test 2: Get an appointment that's not 'concluido' or 'cancelado'"""
    global appointment_id, patient_id
    
    success, data, status = make_request("GET", "/appointments", None, 200)
    
    if not success:
        log_test("2. Get appointment", False, f"Failed to fetch appointments. Status: {status}")
        return False
    
    appointments = data if isinstance(data, list) else []
    
    # Find suitable appointment
    suitable = None
    for apt in appointments:
        if apt.get("status") not in ["concluido", "cancelado"]:
            suitable = apt
            break
    
    if suitable:
        appointment_id = suitable["appointment_id"]
        patient_id = suitable["patient_id"]
        log_test(
            "2. Get appointment", 
            True, 
            f"Found appointment {appointment_id[:8]}... status: {suitable.get('status')}, patient: {suitable.get('patient_name')}"
        )
        return True
    else:
        log_test("2. Get appointment", False, "No suitable appointment found (all are concluido/cancelado)")
        return False


def test_3_start_attendance():
    """Test 3: Start attendance session"""
    global session_id
    
    success, data, status = make_request(
        "POST",
        "/attendance/start",
        {"appointment_id": appointment_id},
        200
    )
    
    if success and data.get("session_id"):
        session_id = data["session_id"]
        log_test(
            "3. Start attendance",
            True,
            f"Session {session_id[:8]}... created, status: {data.get('status')}"
        )
        return True
    else:
        log_test("3. Start attendance", False, f"Status: {status}, Response: {data}")
        return False


def test_4_finalize_attendance():
    """Test 4: Finalize attendance with payment info"""
    global record_id, session_number
    
    success, data, status = make_request(
        "POST",
        f"/attendance/{session_id}/finalize",
        {
            "payment_status": "pago",
            "amount_total": 500.0,
            "payment_method": "pix"
        },
        200
    )
    
    if success and data.get("ok") and data.get("record_id"):
        record_id = data["record_id"]
        session_number = data.get("session_number")
        log_test(
            "4. Finalize attendance",
            True,
            f"Finalized successfully. Record: {record_id[:8]}..., Session#: {session_number}, Financial entries: {len(data.get('financial_entries', []))}"
        )
        return True
    else:
        log_test("4. Finalize attendance", False, f"Status: {status}, Response: {data}")
        return False


def test_5_validate_lock():
    """Test 5: Validate that PUT /attendance/{session_id} returns 423 (locked)"""
    
    success, data, status = make_request(
        "PUT",
        f"/attendance/{session_id}",
        {
            "patient_id": patient_id,
            "evolution": "Tentativa de editar após finalizar"
        },
        423  # Expected: 423 Locked
    )
    
    if success:
        log_test(
            "5. Validate lock (PUT returns 423)",
            True,
            f"Correctly blocked with 423. Message: {data.get('detail', '')}"
        )
        return True
    else:
        log_test(
            "5. Validate lock (PUT returns 423)",
            False,
            f"Expected 423, got {status}. Response: {data}"
        )
        return False


def test_6_validate_readonly():
    """Test 6: Validate that starting attendance again returns read_only=true"""
    
    success, data, status = make_request(
        "POST",
        "/attendance/start",
        {"appointment_id": appointment_id},
        200
    )
    
    if success and data.get("read_only") is True:
        log_test(
            "6. Validate read_only on start",
            True,
            f"Session returned with read_only=true, status: {data.get('status')}"
        )
        return True
    else:
        log_test(
            "6. Validate read_only on start",
            False,
            f"Expected read_only=true, got: {data.get('read_only')}. Status: {status}"
        )
        return False


def test_7_validate_reason_required():
    """Test 7: Validate that reopen without reason returns 400"""
    
    # Test with empty reason
    success, data, status = make_request(
        "POST",
        f"/attendance/{session_id}/reopen",
        {"reason": ""},
        400  # Expected: 400 Bad Request
    )
    
    if success:
        log_test(
            "7. Validate reason required (empty reason → 400)",
            True,
            f"Correctly rejected with 400. Message: {data.get('detail', '')}"
        )
        return True
    else:
        log_test(
            "7. Validate reason required (empty reason → 400)",
            False,
            f"Expected 400, got {status}. Response: {data}"
        )
        return False


def test_8_reopen_with_reason():
    """Test 8: Reopen attendance with valid reason"""
    
    success, data, status = make_request(
        "POST",
        f"/attendance/{session_id}/reopen",
        {"reason": "Correção de evolução conforme auditoria médica"},
        200
    )
    
    if success and data.get("status") == "rascunho":
        reopen_history = data.get("reopen_history", [])
        has_history = len(reopen_history) > 0
        log_test(
            "8. Reopen with valid reason",
            True,
            f"Reopened successfully. Status: {data.get('status')}, Reopen events: {len(reopen_history)}"
        )
        return True
    else:
        log_test(
            "8. Reopen with valid reason",
            False,
            f"Status: {status}, Response: {data}"
        )
        return False


def test_9_edit_after_reopen():
    """Test 9: Validate that editing works after reopen"""
    
    success, data, status = make_request(
        "PUT",
        f"/attendance/{session_id}",
        {
            "patient_id": patient_id,
            "evolution": "Evolução corrigida após reabertura: paciente apresentou melhora significativa no quadro clínico."
        },
        200
    )
    
    if success and data.get("evolution"):
        log_test(
            "9. Edit after reopen",
            True,
            f"Edit successful. Evolution updated: {data.get('evolution')[:50]}..."
        )
        return True
    else:
        log_test(
            "9. Edit after reopen",
            False,
            f"Status: {status}, Response: {data}"
        )
        return False


def test_10_refinalize_no_duplication():
    """Test 10: Re-finalize and check no duplication of medical_record or financial_entries"""
    
    # Re-finalize
    success, data, status = make_request(
        "POST",
        f"/attendance/{session_id}/finalize",
        {
            "payment_status": "pago",
            "amount_total": 500.0,
            "payment_method": "pix"
        },
        200
    )
    
    if not success:
        log_test(
            "10. Re-finalize (no duplication)",
            False,
            f"Re-finalize failed. Status: {status}, Response: {data}"
        )
        return False
    
    # Check medical_records for duplication
    success_mr, mr_data, mr_status = make_request(
        "GET",
        f"/medical-records?patient_id={patient_id}",
        None,
        200
    )
    
    if not success_mr:
        log_test(
            "10. Re-finalize (no duplication)",
            False,
            f"Failed to fetch medical records. Status: {mr_status}"
        )
        return False
    
    records = mr_data if isinstance(mr_data, list) else []
    session_records = [r for r in records if r.get("session_id") == session_id]
    
    # Should be exactly 1 medical_record for this session
    if len(session_records) != 1:
        log_test(
            "10. Re-finalize (no duplication)",
            False,
            f"Expected 1 medical_record for session {session_id[:8]}..., found {len(session_records)}"
        )
        return False
    
    # Check financial_entries for duplication
    success_fin, fin_data, fin_status = make_request(
        "GET",
        "/finance/entries",
        None,
        200
    )
    
    if not success_fin:
        log_test(
            "10. Re-finalize (no duplication)",
            False,
            f"Failed to fetch financial entries. Status: {fin_status}"
        )
        return False
    
    entries = fin_data if isinstance(fin_data, list) else []
    session_entries = [e for e in entries if e.get("session_id") == session_id]
    
    # Should be exactly 1 financial entry for this session (pago = single entry)
    if len(session_entries) != 1:
        log_test(
            "10. Re-finalize (no duplication)",
            False,
            f"Expected 1 financial entry for session {session_id[:8]}..., found {len(session_entries)}"
        )
        return False
    
    log_test(
        "10. Re-finalize (no duplication)",
        True,
        f"No duplication detected. Medical records: 1, Financial entries: 1"
    )
    return True


def test_11_validate_audit_trail():
    """Test 11: Validate that medical_record contains reopen_history"""
    
    success, data, status = make_request(
        "GET",
        f"/medical-records?patient_id={patient_id}",
        None,
        200
    )
    
    if not success:
        log_test(
            "11. Validate audit trail in medical_record",
            False,
            f"Failed to fetch medical records. Status: {status}"
        )
        return False
    
    records = data if isinstance(data, list) else []
    session_record = None
    for r in records:
        if r.get("session_id") == session_id:
            session_record = r
            break
    
    if not session_record:
        log_test(
            "11. Validate audit trail in medical_record",
            False,
            f"Medical record for session {session_id[:8]}... not found"
        )
        return False
    
    reopen_history = session_record.get("reopen_history", [])
    
    if len(reopen_history) > 0:
        event = reopen_history[0]
        has_required_fields = all(
            key in event for key in ["reopened_by", "reopened_by_name", "reason", "reopened_at", "ip"]
        )
        log_test(
            "11. Validate audit trail in medical_record",
            True,
            f"Audit trail present. Events: {len(reopen_history)}, Reason: '{event.get('reason', '')[:50]}...', User: {event.get('reopened_by_name')}"
        )
        return True
    else:
        log_test(
            "11. Validate audit trail in medical_record",
            False,
            f"No reopen_history found in medical_record"
        )
        return False


def test_regression_normal_flow():
    """Regression Test: Validate normal flow (start + finalize) still creates record + financial entry correctly"""
    
    print("\n" + "="*80)
    print("REGRESSION TEST: Normal flow (first finalization)")
    print("="*80)
    
    # Get another appointment
    success, data, status = make_request("GET", "/appointments", None, 200)
    if not success:
        log_test("REGRESSION: Get appointment", False, "Failed to fetch appointments")
        return False
    
    appointments = data if isinstance(data, list) else []
    suitable = None
    for apt in appointments:
        if apt.get("status") not in ["concluido", "cancelado", "em_atendimento"]:
            suitable = apt
            break
    
    if not suitable:
        log_test("REGRESSION: Get appointment", False, "No suitable appointment for regression test")
        return False
    
    reg_appointment_id = suitable["appointment_id"]
    reg_patient_id = suitable["patient_id"]
    log_test("REGRESSION: Get appointment", True, f"Found appointment {reg_appointment_id[:8]}...")
    
    # Start attendance
    success, data, status = make_request(
        "POST",
        "/attendance/start",
        {"appointment_id": reg_appointment_id},
        200
    )
    
    if not success or not data.get("session_id"):
        log_test("REGRESSION: Start attendance", False, f"Failed. Status: {status}")
        return False
    
    reg_session_id = data["session_id"]
    log_test("REGRESSION: Start attendance", True, f"Session {reg_session_id[:8]}... created")
    
    # Finalize
    success, data, status = make_request(
        "POST",
        f"/attendance/{reg_session_id}/finalize",
        {
            "payment_status": "pago",
            "amount_total": 350.0,
            "payment_method": "cartao"
        },
        200
    )
    
    if not success or not data.get("record_id"):
        log_test("REGRESSION: Finalize", False, f"Failed. Status: {status}")
        return False
    
    reg_record_id = data["record_id"]
    reg_fin_entries = data.get("financial_entries", [])
    
    # Validate medical_record was created
    success_mr, mr_data, mr_status = make_request(
        "GET",
        f"/medical-records?patient_id={reg_patient_id}",
        None,
        200
    )
    
    if not success_mr:
        log_test("REGRESSION: Validate medical_record", False, "Failed to fetch records")
        return False
    
    records = mr_data if isinstance(mr_data, list) else []
    reg_record = None
    for r in records:
        if r.get("record_id") == reg_record_id:
            reg_record = r
            break
    
    if not reg_record:
        log_test("REGRESSION: Validate medical_record", False, "Medical record not found")
        return False
    
    log_test("REGRESSION: Validate medical_record", True, f"Record {reg_record_id[:8]}... created")
    
    # Validate financial_entry was created
    success_fin, fin_data, fin_status = make_request(
        "GET",
        "/finance/entries",
        None,
        200
    )
    
    if not success_fin:
        log_test("REGRESSION: Validate financial_entry", False, "Failed to fetch entries")
        return False
    
    entries = fin_data if isinstance(fin_data, list) else []
    reg_entries = [e for e in entries if e.get("session_id") == reg_session_id]
    
    if len(reg_entries) != 1:
        log_test("REGRESSION: Validate financial_entry", False, f"Expected 1 entry, found {len(reg_entries)}")
        return False
    
    log_test("REGRESSION: Validate financial_entry", True, f"Financial entry created, amount: {reg_entries[0].get('amount')}")
    
    return True


def main():
    """Run all tests"""
    print("="*80)
    print("ProClinic Backend Test Suite - Fase 6 (Lote 1)")
    print("Testing: Attendance lock, reopen with audit, and regression")
    print("="*80)
    print()
    
    # Run tests in sequence
    tests = [
        test_1_login,
        test_2_get_appointment,
        test_3_start_attendance,
        test_4_finalize_attendance,
        test_5_validate_lock,
        test_6_validate_readonly,
        test_7_validate_reason_required,
        test_8_reopen_with_reason,
        test_9_edit_after_reopen,
        test_10_refinalize_no_duplication,
        test_11_validate_audit_trail,
    ]
    
    for test_func in tests:
        result = test_func()
        if not result:
            print(f"\n⚠️  Test failed: {test_func.__name__}")
            print("Continuing with remaining tests...\n")
    
    # Run regression test
    test_regression_normal_flow()
    
    # Summary
    print("\n" + "="*80)
    print("TEST SUMMARY")
    print("="*80)
    
    passed = sum(1 for _, p, _ in test_results if p)
    failed = sum(1 for _, p, _ in test_results if not p)
    total = len(test_results)
    
    print(f"Total: {total} | Passed: {passed} | Failed: {failed}")
    print()
    
    if failed > 0:
        print("FAILED TESTS:")
        for name, passed, details in test_results:
            if not passed:
                print(f"  ❌ {name}")
                if details:
                    print(f"     {details}")
    
    print("="*80)
    
    # Exit with appropriate code
    sys.exit(0 if failed == 0 else 1)


if __name__ == "__main__":
    main()
