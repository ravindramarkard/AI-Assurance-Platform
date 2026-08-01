import asyncio
import base64
import io
import tempfile
import unittest
from pathlib import Path

from PIL import Image

from app import agent_runner


def _tiny_png_b64() -> str:
    buf = io.BytesIO()
    Image.new("RGB", (8, 8), color=(10, 20, 30)).save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode("ascii")


class TestScreenshotSave(unittest.TestCase):
    def test_save_latest_does_not_create_live_files(self):
        with tempfile.TemporaryDirectory() as td:
            shots = Path(td)
            b64 = _tiny_png_b64()
            rel = asyncio.run(agent_runner._save_latest(shots, b64))
            self.assertEqual(rel, "screenshots/latest.png")
            self.assertTrue((shots / "latest.png").is_file())
            self.assertEqual(list(shots.glob("live_*.png")), [])

    def test_save_shot_creates_numbered_step_and_latest(self):
        with tempfile.TemporaryDirectory() as td:
            shots = Path(td)
            b64 = _tiny_png_b64()
            rel = asyncio.run(agent_runner._save_shot(shots, "step", b64))
            self.assertEqual(rel, "screenshots/step_0000.png")
            self.assertTrue((shots / "latest.png").is_file())
            self.assertTrue((shots / "step_0000.png").is_file())
            rel2 = asyncio.run(agent_runner._save_shot(shots, "step", b64))
            self.assertEqual(rel2, "screenshots/step_0001.png")


if __name__ == "__main__":
    unittest.main()
