"""Chat vs browser gate — web intent for QA-style tasks."""

import unittest

from app.chat_gate import browser_decision, has_web_intent, is_chat_only


class TestChatGateWebIntent(unittest.TestCase):
    def test_test_scenarios_for_app_needs_browser(self):
        task = "cover all test scenarios and test each scenarios for chat app"
        self.assertTrue(has_web_intent(task))
        self.assertFalse(is_chat_only(task))
        want, reason = browser_decision(task)
        self.assertTrue(want)
        self.assertNotEqual(reason, "chat only")

    def test_test_scenario_variants_need_browser(self):
        for task in (
            "test scenarios for the chat app",
            "run all test cases on the login page",
            "cover test cases for the application",
            "test each scenario for the app",
            "verify all scenarios on the site",
        ):
            with self.subTest(task=task):
                self.assertTrue(has_web_intent(task), task)
                self.assertTrue(browser_decision(task)[0], task)

    def test_greeting_stays_chat_only(self):
        self.assertTrue(is_chat_only("hi"))
        self.assertFalse(browser_decision("hi")[0])

    def test_existing_test_case_still_needs_browser(self):
        self.assertTrue(has_web_intent("write a test case for checkout"))
        self.assertTrue(browser_decision("go to example.com and list links")[0])


if __name__ == "__main__":
    unittest.main()
