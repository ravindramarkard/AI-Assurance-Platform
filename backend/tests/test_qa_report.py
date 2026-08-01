import tempfile
import unittest
from pathlib import Path

from app.api_test.allure_report import write_html_report
from app.api_test.qa_report import (
    QA_TABLE_HEADERS,
    actual_result_from_evidence,
    api_priority,
    build_api_observations,
    build_api_qa_rows,
    format_tc_id,
)


class TestQaHelpers(unittest.TestCase):
    def test_headers(self):
        self.assertEqual(
            QA_TABLE_HEADERS,
            [
                "TC ID",
                "Feature",
                "Test Scenario",
                "Preconditions",
                "Test Steps",
                "Expected Result",
                "Actual Result",
                "Priority",
            ],
        )

    def test_format_tc_id(self):
        self.assertEqual(format_tc_id("API", 1), "API-TC-001")
        self.assertEqual(format_tc_id("AB", 12), "AB-TC-012")

    def test_api_priority(self):
        self.assertEqual(api_priority("security"), "High")
        self.assertEqual(api_priority("contract"), "Medium")
        self.assertEqual(api_priority("e2e"), "Medium")
        self.assertEqual(api_priority("edge"), "Low")
        self.assertEqual(api_priority("negative"), "Low")
        self.assertEqual(api_priority("load"), "Low")
        self.assertEqual(api_priority(None), "Medium")

    def test_actual_result(self):
        self.assertEqual(
            actual_result_from_evidence("pass", "HTTP 200", executed=True),
            "Pass — HTTP 200",
        )
        self.assertEqual(
            actual_result_from_evidence("fail", "HTTP 500", executed=True),
            "Fail — HTTP 500",
        )
        self.assertEqual(
            actual_result_from_evidence(None, None, executed=False),
            "Not executed",
        )
        self.assertEqual(
            actual_result_from_evidence(None, None, executed=True),
            "N/A",
        )

    def test_build_rows_from_step(self):
        steps = [
            {
                "flow": "contract GET /pets",
                "status": "pass",
                "detail": {
                    "kind": "contract",
                    "method": "GET",
                    "path": "/pets",
                    "operation_id": "listPets",
                    "expected_status": [200, 201],
                    "status_code": 200,
                    "status": "pass",
                    "skip_auth": False,
                },
            }
        ]
        rows = build_api_qa_rows(steps, base_url="https://api.example")
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["TC ID"], "API-TC-001")
        self.assertIn("Contract", rows[0]["Feature"])
        self.assertIn("GET", rows[0]["Test Steps"])
        self.assertIn("200", rows[0]["Expected Result"])
        self.assertIn("Pass", rows[0]["Actual Result"])
        self.assertEqual(rows[0]["Priority"], "Medium")
        self.assertIn("https://api.example", rows[0]["Preconditions"])

    def test_observations_with_failure(self):
        insights = {
            "primary_root_cause": "Auth missing",
            "primary_solution": "Send Bearer token",
            "themes": [
                {
                    "title": "401 Unauthorized",
                    "root_cause": "No token",
                    "solution": "Add Authorization header",
                    "count": 2,
                }
            ],
            "failures": [{"endpoint": "GET /secure"}],
        }
        obs, rec = build_api_observations(insights)
        self.assertTrue(any("Auth missing" in o or "401" in o for o in obs))
        self.assertTrue(any("Bearer" in r or "Authorization" in r for r in rec))

    def test_observations_clean_suite(self):
        obs, rec = build_api_observations({"failures": [], "themes": []})
        self.assertTrue(obs)
        self.assertTrue(rec)


class TestApiHtmlReport(unittest.TestCase):
    def test_html_has_qa_sections(self):
        steps = [
            {
                "flow": "security GET /admin",
                "status": "fail",
                "detail": {
                    "kind": "security",
                    "method": "GET",
                    "path": "/admin",
                    "operation_id": "admin",
                    "expected_status": [401, 403],
                    "status_code": 200,
                    "status": "fail",
                },
            }
        ]
        summary = {"passed": 0, "failed": 1, "avg_latency_ms": 12, "spectrum": {"security": 1}}
        with tempfile.TemporaryDirectory() as td:
            out = write_html_report(
                report_dir=Path(td),
                project_name="Demo",
                base_url="https://api.example",
                openapi_url="https://api.example/openapi.json",
                run_id="run-1",
                steps=steps,
                summary=summary,
                spectrum_counts={"security": 1},
            )
            html = out.read_text(encoding="utf-8")
            self.assertIn("Executive Summary", html)
            self.assertIn("Observations & Recommendations", html)
            for h in QA_TABLE_HEADERS:
                self.assertIn(h, html)
            self.assertIn("API-TC-001", html)
            self.assertNotIn("Failed steps (detail)", html)
            self.assertNotIn(">Flows<", html)


if __name__ == "__main__":
    unittest.main()
