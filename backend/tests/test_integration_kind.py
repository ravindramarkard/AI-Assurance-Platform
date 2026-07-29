import unittest

from app.integration_actions import integration_kind


class TestIntegrationKind(unittest.TestCase):
    def test_explicit_jira(self):
        self.assertEqual(integration_kind("Log this to Jira: session summary"), "jira")
        self.assertEqual(integration_kind("create a jira ticket for the failure"), "jira")
        self.assertEqual(integration_kind("file a ticket in Jira"), "jira")

    def test_explicit_confluence(self):
        self.assertEqual(
            integration_kind("Create a Confluence page with this summary"),
            "confluence",
        )

    def test_quality_issues_not_jira(self):
        """Bare 'issue(s)' without Jira must not hijack browser tasks."""
        self.assertIsNone(integration_kind("Create test cases for quality issues"))
        self.assertIsNone(integration_kind("Report AI quality testing issues in the doc"))
        self.assertIsNone(integration_kind("Open the issues list on the page"))
        self.assertIsNone(integration_kind("file an issue about hallucination"))

    def test_unrelated(self):
        self.assertIsNone(integration_kind("Get the latest news headlines"))
        self.assertIsNone(integration_kind(""))


if __name__ == "__main__":
    unittest.main()
