import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from app import atlassian


class TestAttachJiraFile(unittest.IsolatedAsyncioTestCase):
    async def test_attach_posts_multipart(self):
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.content = b'[{"filename":"step_0001_fail.png"}]'
        mock_resp.json.return_value = [{"filename": "step_0001_fail.png", "id": "1"}]
        mock_resp.text = "ok"

        mock_client = AsyncMock()
        mock_client.__aenter__.return_value = mock_client
        mock_client.__aexit__.return_value = None
        mock_client.post = AsyncMock(return_value=mock_resp)

        with patch("app.atlassian.httpx.AsyncClient", return_value=mock_client):
            result = await atlassian.attach_jira_file(
                base_url="https://jira.example",
                username="u",
                token="t",
                issue_key="AB-1",
                filename="step_0001_fail.png",
                content=b"\x89PNG",
                deployment="server",
            )
        self.assertTrue(result["ok"])
        self.assertEqual(result["issue_key"], "AB-1")
        mock_client.post.assert_awaited()
        args, kwargs = mock_client.post.await_args
        self.assertIn("/issue/AB-1/attachments", args[0])
        self.assertEqual(kwargs["headers"].get("X-Atlassian-Token"), "no-check")
        self.assertIn("file", kwargs["files"])

    async def test_attach_requires_key_and_bytes(self):
        with self.assertRaises(ValueError):
            await atlassian.attach_jira_file(
                base_url="https://jira.example",
                username="u",
                token="t",
                issue_key="",
                filename="a.png",
                content=b"x",
            )
        with self.assertRaises(ValueError):
            await atlassian.attach_jira_file(
                base_url="https://jira.example",
                username="u",
                token="t",
                issue_key="AB-1",
                filename="a.png",
                content=b"",
            )


if __name__ == "__main__":
    unittest.main()
