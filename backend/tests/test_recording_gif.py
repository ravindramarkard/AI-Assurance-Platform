import tempfile
import unittest
from pathlib import Path

from PIL import Image

from app.recording_gif import build_recording_gif


def _write_png(path: Path, color: tuple[int, int, int]) -> None:
    Image.new("RGB", (32, 24), color=color).save(path, format="PNG")


class TestRecordingGif(unittest.TestCase):
    def test_builds_from_step_frames_only(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            shots = root / "screenshots"
            shots.mkdir()
            _write_png(shots / "step_0000.png", (255, 0, 0))
            _write_png(shots / "step_0001.png", (0, 255, 0))
            meta = build_recording_gif(root, duration_ms=100)
            self.assertEqual(meta["path"], "screenshots/recording.gif")
            self.assertEqual(meta["frames"], 2)
            self.assertTrue((shots / "recording.gif").is_file())

    def test_error_mentions_step_frames(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            (root / "screenshots").mkdir()
            with self.assertRaises(FileNotFoundError) as ctx:
                build_recording_gif(root)
            self.assertIn("step_", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
