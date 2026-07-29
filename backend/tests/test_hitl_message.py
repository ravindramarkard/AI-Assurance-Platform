import unittest

from app.hitl_message import HITL_SYSTEM_MESSAGE


class TestHitlMessage(unittest.TestCase):
    def test_mentions_tool_and_otp(self):
        self.assertIn("request_human_input", HITL_SYSTEM_MESSAGE)
        self.assertIn("OTP", HITL_SYSTEM_MESSAGE)
        self.assertIn("Never invent", HITL_SYSTEM_MESSAGE)


if __name__ == "__main__":
    unittest.main()
