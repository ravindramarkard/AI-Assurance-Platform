import unittest

from app.screenshot_archive import (
    apply_headless_archive_default,
    archive_decision,
    normalize_screenshot_archive,
    resolve_screenshot_archive,
    should_archive_step_screenshot,
    step_looks_failed,
    suggest_screenshot_archive,
)


class TestScreenshotArchive(unittest.TestCase):
    def test_normalize(self):
        self.assertEqual(normalize_screenshot_archive("ALWAYS"), "always")
        self.assertEqual(normalize_screenshot_archive("on_failure"), "on_failure")
        self.assertEqual(normalize_screenshot_archive("never"), "never")
        self.assertIsNone(normalize_screenshot_archive("nope"))
        self.assertIsNone(normalize_screenshot_archive(None))

    def test_resolve_defaults(self):
        self.assertEqual(resolve_screenshot_archive(None, headless=True), "on_failure")
        self.assertEqual(resolve_screenshot_archive(None, headless=False), "always")
        self.assertEqual(resolve_screenshot_archive("bogus", headless=True), "on_failure")
        self.assertEqual(resolve_screenshot_archive("never", headless=True), "never")

    def test_suggest_and_apply(self):
        self.assertEqual(suggest_screenshot_archive(headless=True), "on_failure")
        self.assertEqual(suggest_screenshot_archive(headless=False), "always")
        self.assertEqual(
            apply_headless_archive_default(headless=True, archive="always", user_set=False),
            "on_failure",
        )
        self.assertEqual(
            apply_headless_archive_default(headless=True, archive="never", user_set=True),
            "never",
        )

    def test_step_failed(self):
        self.assertTrue(step_looks_failed(actions=["error: timeout"], thought=None))
        self.assertTrue(step_looks_failed(actions=["Click x"], thought="Failed. Selector missing"))
        self.assertFalse(step_looks_failed(actions=["Click — #ok"], thought="Done."))

    def test_should_archive(self):
        self.assertTrue(should_archive_step_screenshot("always", failed=False))
        self.assertTrue(should_archive_step_screenshot("on_failure", failed=True))
        self.assertFalse(should_archive_step_screenshot("on_failure", failed=False))
        self.assertFalse(should_archive_step_screenshot("never", failed=True))

    def test_archive_decision(self):
        self.assertFalse(archive_decision("always", failed=False, has_b64=False))
        self.assertTrue(archive_decision("always", failed=False, has_b64=True))
        self.assertFalse(archive_decision("on_failure", failed=False, has_b64=True))
        self.assertTrue(archive_decision("on_failure", failed=True, has_b64=True))
        self.assertFalse(archive_decision("never", failed=True, has_b64=True))


if __name__ == "__main__":
    unittest.main()
