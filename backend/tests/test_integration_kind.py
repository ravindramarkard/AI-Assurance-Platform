import unittest

from app.integration_actions import _search_jql, integration_kind


class TestIntegrationKind(unittest.TestCase):
    def test_jira_create(self):
        self.assertEqual(integration_kind("Log this to Jira: session summary"), "jira_create")
        self.assertEqual(integration_kind("create a jira ticket for the failure"), "jira_create")
        self.assertEqual(integration_kind("file a ticket in Jira"), "jira_create")

    def test_jira_search(self):
        self.assertEqual(integration_kind("search Jira for login bug"), "jira_search")
        self.assertEqual(integration_kind("find my open issues in Jira"), "jira_search")

    def test_jira_comment(self):
        self.assertEqual(
            integration_kind("comment on PROJ-12: still failing on Safari"),
            "jira_comment",
        )

    def test_jira_transition(self):
        self.assertEqual(integration_kind("set PROJ-12 to Done"), "jira_transition")
        self.assertEqual(
            integration_kind("transition AUT-9 to In Progress"),
            "jira_transition",
        )

    def test_confluence_create(self):
        self.assertEqual(
            integration_kind("Create a Confluence page with this summary"),
            "confluence_create",
        )

    def test_confluence_report(self):
        self.assertEqual(
            integration_kind("post result report to Confluence"),
            "confluence_report",
        )
        self.assertEqual(
            integration_kind("Publish the report on Confluence"),
            "confluence_report",
        )

    def test_quality_issues_not_jira(self):
        self.assertIsNone(integration_kind("Create test cases for quality issues"))
        self.assertIsNone(integration_kind("Report AI quality testing issues in the doc"))
        self.assertIsNone(integration_kind("Open the issues list on the page"))
        self.assertIsNone(integration_kind("file an issue about hallucination"))

    def test_unrelated(self):
        self.assertIsNone(integration_kind("Get the latest news headlines"))
        self.assertIsNone(integration_kind(""))

    def test_search_jql(self):
        jql = _search_jql("search Jira for login timeout", "AUT")
        self.assertIn("project = AUT", jql)
        self.assertIn("login timeout", jql)
        open_jql = _search_jql("find my open issues in Jira", "AUT")
        self.assertIn("currentUser()", open_jql)


if __name__ == "__main__":
    unittest.main()
