import asyncio
import unittest

from app.human_input import HumanInputCancelled, begin_wait, cancel, get_pending, submit


class TestHumanInputWaiter(unittest.IsolatedAsyncioTestCase):
    async def test_submit_resolves_wait(self):
        async def waiter():
            rid, value = await begin_wait("s1", "Enter OTP", "otp")
            return rid, value

        task = asyncio.create_task(waiter())
        await asyncio.sleep(0.05)
        pending = get_pending("s1")
        self.assertIsNotNone(pending)
        self.assertEqual(pending["prompt"], "Enter OTP")
        self.assertEqual(pending["input_type"], "otp")
        ok = submit("s1", " 654321 ", pending["request_id"])
        self.assertTrue(ok)
        rid, value = await task
        self.assertEqual(value, "654321")
        self.assertIsNone(get_pending("s1"))

    async def test_empty_submit_rejected(self):
        async def waiter():
            return await begin_wait("s2", "code")

        task = asyncio.create_task(waiter())
        await asyncio.sleep(0.05)
        self.assertFalse(submit("s2", "   "))
        self.assertTrue(submit("s2", "ok"))
        _, value = await task
        self.assertEqual(value, "ok")

    async def test_cancel_raises(self):
        async def waiter():
            return await begin_wait("s3", "code")

        task = asyncio.create_task(waiter())
        await asyncio.sleep(0.05)
        self.assertTrue(cancel("s3"))
        with self.assertRaises(HumanInputCancelled):
            await task
        self.assertIsNone(get_pending("s3"))

    def test_submit_without_pending(self):
        self.assertFalse(submit("missing", "x"))


if __name__ == "__main__":
    unittest.main()
