import unittest

from app.hitl_message import HITL_SYSTEM_MESSAGE, human_input_result_payload


class TestHitlMessage(unittest.TestCase):
    def test_mentions_tool_and_otp(self):
        self.assertIn("request_human_input", HITL_SYSTEM_MESSAGE)
        self.assertIn("OTP", HITL_SYSTEM_MESSAGE)
        self.assertIn("Never invent", HITL_SYSTEM_MESSAGE)

    def test_requires_json_after_value(self):
        self.assertIn("AgentOutput JSON", HITL_SYSTEM_MESSAGE)

    def test_payload_keeps_value_across_retries(self):
        p = human_input_result_payload(" 654321 ")
        self.assertIn("654321", p["extracted_content"])
        self.assertIn("654321", p["long_term_memory"])
        self.assertFalse(p["include_extracted_content_only_once"])
        self.assertIn("AgentOutput JSON", p["extracted_content"])


if __name__ == "__main__":
    unittest.main()
