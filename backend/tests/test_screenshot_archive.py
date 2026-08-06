import tempfile
import unittest
from pathlib import Path

from app.screenshot_archive import (
    apply_headless_archive_default,
    archive_decision,
    collect_failed_screenshot_files,
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


class TestCollectFailedScreenshots(unittest.TestCase):
    def test_collects_last_failed_pngs(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            shots = root / "screenshots"
            shots.mkdir()
            for name in ("step_0001.png", "step_0002.png", "step_0003.png"):
                (shots / name).write_bytes(b"\x89PNG")
            events = [
                {
                    "type": "step",
                    "payload": {
                        "actions": ["Click ok"],
                        "thought": "ok",
                        "screenshot": "screenshots/step_0001.png",
                    },
                },
                {
                    "type": "step",
                    "payload": {
                        "actions": ["error: a"],
                        "thought": "Failed.",
                        "screenshot": "screenshots/step_0002.png",
                    },
                },
                {
                    "type": "step",
                    "payload": {
                        "actions": ["error: b"],
                        "thought": "Failed.",
                        "screenshot": "screenshots/step_0003.png",
                    },
                },
            ]
            got = collect_failed_screenshot_files(events, root, max_files=5)
            self.assertEqual([p.name for p in got], ["step_0002.png", "step_0003.png"])

    def test_caps_to_last_five(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            shots = root / "screenshots"
            shots.mkdir()
            events = []
            for i in range(1, 8):
                name = f"step_{i:04d}.png"
                (shots / name).write_bytes(b"x")
                events.append(
                    {
                        "type": "step",
                        "payload": {
                            "actions": ["error: x"],
                            "thought": "Failed.",
                            "screenshot": f"screenshots/{name}",
                        },
                    }
                )
            got = collect_failed_screenshot_files(events, root, max_files=5)
            self.assertEqual(len(got), 5)
            self.assertEqual(got[0].name, "step_0003.png")
            self.assertEqual(got[-1].name, "step_0007.png")

    def test_max_files_six_still_caps_at_five(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            shots = root / "screenshots"
            shots.mkdir()
            events = []
            for i in range(1, 8):
                name = f"step_{i:04d}.png"
                (shots / name).write_bytes(b"x")
                events.append(
                    {
                        "type": "step",
                        "payload": {
                            "actions": ["error: x"],
                            "thought": "Failed.",
                            "screenshot": f"screenshots/{name}",
                        },
                    }
                )
            got = collect_failed_screenshot_files(events, root, max_files=6)
            self.assertEqual(len(got), 5)

    def test_max_files_zero_returns_empty(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            shots = root / "screenshots"
            shots.mkdir()
            (shots / "step_0001.png").write_bytes(b"x")
            events = [
                {
                    "type": "step",
                    "payload": {
                        "actions": ["error: x"],
                        "thought": "Failed.",
                        "screenshot": "screenshots/step_0001.png",
                    },
                },
            ]
            self.assertEqual(collect_failed_screenshot_files(events, root, max_files=0), [])

    def test_skips_missing_and_latest(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "screenshots").mkdir()
            events = [
                {
                    "type": "step",
                    "payload": {
                        "actions": ["error: x"],
                        "thought": "Failed.",
                        "screenshot": "screenshots/latest.png",
                    },
                },
                {
                    "type": "step",
                    "payload": {
                        "actions": ["error: y"],
                        "thought": "Failed.",
                        "screenshot": "screenshots/missing.png",
                    },
                },
            ]
            self.assertEqual(collect_failed_screenshot_files(events, root), [])


if __name__ == "__main__":
    unittest.main()
