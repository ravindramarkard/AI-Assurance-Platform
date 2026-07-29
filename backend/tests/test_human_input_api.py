import unittest

from app.models import HumanInputRequest


class TestHumanInputRequestModel(unittest.TestCase):
    def test_requires_value(self):
        m = HumanInputRequest(value="123456")
        self.assertEqual(m.value, "123456")
        self.assertIsNone(m.request_id)

    def test_with_request_id(self):
        m = HumanInputRequest(value="1", request_id="abc")
        self.assertEqual(m.request_id, "abc")


if __name__ == "__main__":
    unittest.main()
