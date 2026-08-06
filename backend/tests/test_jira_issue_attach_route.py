import tempfile
import unittest
from pathlib import Path
from unittest.mock import ANY, AsyncMock, patch

from app.models import JiraIssueRequest
from app.routes.integrations import (
    attach_session_failure_screenshots,
    create_jira_issue,
)


class TestAttachSessionFailures(unittest.IsolatedAsyncioTestCase):
    async def test_attaches_collected_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            png = Path(tmp) / "step_0002.png"
            png.write_bytes(b"\x89PNG")
            with (
                patch(
                    "app.routes.integrations.db.list_events",
                    new_callable=AsyncMock,
                    return_value=[],
                ) as list_events,
                patch("app.routes.integrations.session_dir", return_value=Path(tmp)),
                patch(
                    "app.routes.integrations.collect_failed_screenshot_files",
                    return_value=[png],
                ),
                patch(
                    "app.routes.integrations.atlassian.attach_jira_file",
                    new_callable=AsyncMock,
                    return_value={"ok": True, "filename": "step_0002_fail.png"},
                ) as attach,
            ):
                settings = {
                    "jira_base_url": "https://jira.example",
                    "jira_api_token": "t",
                    "jira_email": "u@x",
                    "jira_auth_type": "password",
                    "atlassian_deployment": "server",
                }

                summary = await attach_session_failure_screenshots(
                    "sess1", "AB-9", settings
                )

                self.assertEqual(summary["attached"], ["step_0002_fail.png"])
                self.assertEqual(summary["skipped"], [])
                self.assertEqual(summary["errors"], [])
                list_events.assert_awaited_once_with("sess1", limit=5000)
                attach.assert_awaited_once_with(
                    base_url="https://jira.example",
                    username="u@x",
                    token="t",
                    issue_key="AB-9",
                    filename="step_0002_fail.png",
                    content=b"\x89PNG",
                    deployment="server",
                )

    async def test_attach_error_does_not_raise(self):
        with tempfile.TemporaryDirectory() as tmp:
            png = Path(tmp) / "step_0002.png"
            png.write_bytes(b"\x89PNG")
            with (
                patch(
                    "app.routes.integrations.db.list_events",
                    new_callable=AsyncMock,
                    return_value=[],
                ),
                patch("app.routes.integrations.session_dir", return_value=Path(tmp)),
                patch(
                    "app.routes.integrations.collect_failed_screenshot_files",
                    return_value=[png],
                ),
                patch(
                    "app.routes.integrations.atlassian.attach_jira_file",
                    new_callable=AsyncMock,
                    side_effect=RuntimeError("boom"),
                ),
            ):
                settings = {
                    "jira_base_url": "https://jira.example",
                    "jira_api_token": "t",
                    "jira_email": "u@x",
                    "jira_auth_type": "password",
                    "atlassian_deployment": "server",
                }

                summary = await attach_session_failure_screenshots(
                    "sess1", "AB-9", settings
                )

                self.assertEqual(summary["attached"], [])
                self.assertEqual(summary["skipped"], [])
                self.assertEqual(summary["errors"], ["step_0002.png: boom"])

    async def test_create_issue_returns_attachment_summary_and_records_it(self):
        settings = {
            "jira_base_url": "https://jira.example",
            "jira_api_token": "t",
            "jira_email": "u@x",
            "jira_auth_type": "password",
            "jira_project_key": "AB",
            "atlassian_deployment": "server",
        }
        summary = {
            "attached": ["step_0002_fail.png"],
            "skipped": [],
            "errors": [],
        }
        with (
            patch(
                "app.routes.integrations.effective_settings",
                new_callable=AsyncMock,
                return_value=settings,
            ),
            patch(
                "app.routes.integrations.db.get_session",
                new_callable=AsyncMock,
                return_value=None,
            ),
            patch(
                "app.routes.integrations.db.list_messages",
                new_callable=AsyncMock,
                return_value=[],
            ),
            patch(
                "app.routes.integrations.atlassian.create_jira_issue",
                new_callable=AsyncMock,
                return_value={"key": "AB-9", "url": "https://jira.example/browse/AB-9"},
            ),
            patch(
                "app.routes.integrations.attach_session_failure_screenshots",
                new_callable=AsyncMock,
                return_value=summary,
            ) as attach,
            patch(
                "app.routes.integrations.db.add_message", new_callable=AsyncMock
            ) as add_message,
            patch(
                "app.routes.integrations.db.add_event", new_callable=AsyncMock
            ) as add_event,
        ):
            result = await create_jira_issue(
                JiraIssueRequest(summary="Broken flow", session_id="sess1")
            )

        self.assertEqual(result["attachments"], summary)
        attach.assert_awaited_once_with("sess1", "AB-9", ANY)
        self.assertIn("Attached: step_0002_fail.png.", add_message.await_args.args[2])
        self.assertEqual(add_event.await_args.args[2]["attachments"], summary)


if __name__ == "__main__":
    unittest.main()
