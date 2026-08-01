"""Tests for Atlassian project/space listing and Server PAT auth."""

from __future__ import annotations

import unittest
from unittest.mock import AsyncMock, patch

from app import atlassian


class TestAuthHeaders(unittest.TestCase):
    def test_server_pat_only_uses_bearer(self):
        h = atlassian._auth_headers("", "my-pat-token", deployment="server")
        self.assertEqual(h["Authorization"], "Bearer my-pat-token")

    def test_server_password_uses_basic(self):
        h = atlassian._auth_headers("jdoe", "secret", deployment="server")
        self.assertTrue(h["Authorization"].startswith("Basic "))

    def test_resolve_username_pat_clears(self):
        self.assertEqual(
            atlassian.resolve_auth_username(
                {"atlassian_deployment": "server", "jira_auth_type": "pat", "jira_email": "jdoe"}
            ),
            "",
        )

    def test_resolve_username_password_keeps(self):
        self.assertEqual(
            atlassian.resolve_auth_username(
                {
                    "atlassian_deployment": "server",
                    "jira_auth_type": "password",
                    "jira_email": "jdoe",
                }
            ),
            "jdoe",
        )

    def test_resolve_username_cloud_keeps_email(self):
        self.assertEqual(
            atlassian.resolve_auth_username(
                {
                    "atlassian_deployment": "cloud",
                    "jira_auth_type": "pat",
                    "jira_email": "a@b.com",
                }
            ),
            "a@b.com",
        )

    def test_resolve_confluence_pat_clears(self):
        self.assertEqual(
            atlassian.resolve_confluence_auth_username(
                {
                    "atlassian_deployment": "server",
                    "confluence_auth_type": "pat",
                    "confluence_email": "jdoe",
                }
            ),
            "",
        )

    def test_resolve_confluence_password_keeps(self):
        self.assertEqual(
            atlassian.resolve_confluence_auth_username(
                {
                    "atlassian_deployment": "server",
                    "confluence_auth_type": "password",
                    "confluence_email": "jdoe",
                }
            ),
            "jdoe",
        )


class TestListProjects(unittest.IsolatedAsyncioTestCase):
    async def test_list_jira_projects_parses_and_sorts(self):
        payload = [
            {"key": "ZZ", "name": "Zed"},
            {"key": "AA", "name": "Alpha"},
            {"key": "", "name": "skip"},
        ]
        with patch.object(atlassian, "_request", new=AsyncMock(return_value=payload)) as req:
            out = await atlassian.list_jira_projects(
                "https://jira.example.com",
                "u",
                "t",
                deployment="server",
            )
        self.assertEqual(out, [{"key": "AA", "name": "Alpha"}, {"key": "ZZ", "name": "Zed"}])
        self.assertIn("/rest/api/2/project", req.await_args.args[1])

    async def test_list_jira_projects_cloud_search_shape(self):
        payload = {
            "values": [{"key": "B", "name": "Bee"}, {"key": "A", "name": "Aye"}],
            "isLast": True,
        }
        with patch.object(atlassian, "_request", new=AsyncMock(return_value=payload)) as req:
            out = await atlassian.list_jira_projects(
                "https://x.atlassian.net",
                "a@b.com",
                "tok",
                deployment="cloud",
            )
        self.assertEqual(out, [{"key": "A", "name": "Aye"}, {"key": "B", "name": "Bee"}])
        self.assertIn("/rest/api/3/project/search", req.await_args.args[1])


class TestListSpaces(unittest.IsolatedAsyncioTestCase):
    async def test_list_confluence_spaces_paginates(self):
        page1 = {
            "results": [{"key": "TEAM", "name": "Team"}],
            "size": 1,
            "_links": {"next": "/rest/api/space?start=1"},
        }
        page2 = {
            "results": [{"key": "DOC", "name": "Docs"}],
            "size": 1,
            "_links": {},
        }
        mock = AsyncMock(side_effect=[page1, page2])
        with patch.object(atlassian, "_request", new=mock):
            out = await atlassian.list_confluence_spaces(
                "https://conf.example.com",
                "u",
                "t",
                deployment="server",
            )
        self.assertEqual(
            out,
            [{"key": "DOC", "name": "Docs"}, {"key": "TEAM", "name": "Team"}],
        )
        self.assertEqual(mock.await_count, 2)


class TestAuthReady(unittest.TestCase):
    def test_server_password_needs_user(self):
        from app.routes import integrations

        s = {
            "atlassian_deployment": "server",
            "jira_auth_type": "password",
            "jira_email": "",
            "jira_api_token": "x",
            "confluence_auth_type": "password",
            "confluence_email": "",
            "confluence_api_token": "",
        }
        self.assertFalse(integrations._jira_auth_ready(s))
        s["jira_email"] = "jdoe"
        self.assertTrue(integrations._jira_auth_ready(s))

    def test_server_pat_token_only(self):
        from app.routes import integrations

        s = {
            "atlassian_deployment": "server",
            "jira_auth_type": "pat",
            "jira_email": "",
            "jira_api_token": "pat-x",
            "confluence_auth_type": "pat",
            "confluence_email": "",
            "confluence_api_token": "pat-c",
        }
        self.assertTrue(integrations._jira_auth_ready(s))
        self.assertTrue(integrations._confluence_auth_ready(s))

    def test_confluence_auth_independent_of_jira(self):
        from app.routes import integrations

        s = {
            "atlassian_deployment": "server",
            "jira_auth_type": "password",
            "jira_email": "",
            "jira_api_token": "",
            "confluence_auth_type": "pat",
            "confluence_email": "",
            "confluence_api_token": "conf-pat",
        }
        self.assertFalse(integrations._jira_auth_ready(s))
        self.assertTrue(integrations._confluence_auth_ready(s))


if __name__ == "__main__":
    unittest.main()
