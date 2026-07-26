from __future__ import annotations

import glob
import json
import logging
import os
import shlex
import shutil
import signal
import socket
import subprocess
import sys
import time
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

logger = logging.getLogger(__name__)

BrowserEngine = Literal["chromium", "chrome", "custom"]

# session_id -> process handle
_PROCS: dict[str, Any] = {}


class PidProc:
    """Handle for a process we only know by pid (e.g. launched via osascript)."""

    def __init__(self, pid: int):
        self.pid = pid

    def poll(self) -> int | None:
        try:
            os.kill(self.pid, 0)
            return None
        except OSError:
            return 1

    def terminate(self) -> None:
        try:
            os.killpg(self.pid, signal.SIGTERM)
        except Exception:
            try:
                os.kill(self.pid, signal.SIGTERM)
            except Exception:
                pass

    def kill(self) -> None:
        try:
            os.killpg(self.pid, signal.SIGKILL)
        except Exception:
            try:
                os.kill(self.pid, signal.SIGKILL)
            except Exception:
                pass

    def wait(self, timeout: float | None = None) -> int | None:
        deadline = time.time() + (timeout if timeout is not None else 30)
        while time.time() < deadline:
            code = self.poll()
            if code is not None:
                return code
            time.sleep(0.1)
        raise TimeoutError(f"pid {self.pid} still running")

    def wait(self, timeout: float | None = None) -> int | None:
        deadline = time.time() + (timeout or 0)
        while True:
            if self.poll() is not None:
                return 1
            if timeout is not None and time.time() >= deadline:
                raise subprocess.TimeoutExpired(cmd=str(self.pid), timeout=timeout or 0)
            time.sleep(0.1)


def _home_globs(patterns: list[str]) -> list[str]:
    found: list[str] = []
    for pattern in patterns:
        found.extend(sorted(glob.glob(pattern), reverse=True))
    return found


def find_headless_shell() -> str | None:
    hs = os.environ.get("CHROME_HEADLESS_SHELL")
    if hs and Path(hs).exists():
        return hs
    paths = _home_globs(
        [
            str(
                Path.home()
                / "Library/Caches/ms-playwright/chromium_headless_shell-*/chrome-headless-shell-mac-*/chrome-headless-shell"
            ),
            str(
                Path.home()
                / "Library/Caches/ms-playwright/chromium_headless_shell-*/chrome-headless-shell-linux*/chrome-headless-shell"
            ),
        ]
    )
    return paths[0] if paths else None


def find_chrome_for_testing() -> str | None:
    override = os.environ.get("CHROME_FOR_TESTING")
    if override and Path(override).exists():
        return override
    paths = _home_globs(
        [
            str(
                Path.home()
                / "Library/Caches/ms-playwright/chromium-*/chrome-mac*/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
            ),
            str(Path.home() / "Library/Caches/ms-playwright/chromium-*/chrome-linux*/chrome"),
        ]
    )
    return paths[0] if paths else None


def find_system_chrome() -> str | None:
    mac = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    if Path(mac).exists():
        return mac
    for name in ("google-chrome", "google-chrome-stable", "chromium", "chromium-browser"):
        p = shutil.which(name)
        if p:
            return p
    return None


def detect_browsers() -> dict[str, str | None]:
    return {
        "chromium": find_chrome_for_testing(),
        "headless_shell": find_headless_shell(),
        "chrome": find_system_chrome(),
    }


def resolve_executable(
    engine: str,
    *,
    custom_path: str | None = None,
    headless: bool = True,
) -> tuple[str, bool]:
    """
    Return (executable_path, is_headless_shell).

    engine:
      - chromium: Playwright Chrome-for-Testing (or headless-shell when headless)
      - chrome:   installed Google Chrome / Chromium
      - custom:   user-declared path in custom_path / CHROME_PATH
    """
    engine = (engine or "chromium").lower().strip()
    detected = detect_browsers()

    if engine == "custom":
        path = (custom_path or os.environ.get("CHROME_PATH") or "").strip()
        if not path or not Path(path).exists():
            raise RuntimeError(
                "Browser engine is 'custom' but no valid path was set. "
                "Set Browser executable in Settings (or CHROME_PATH in .env)."
            )
        is_shell = "headless-shell" in Path(path).name
        return path, is_shell

    if engine == "chrome":
        path = detected["chrome"]
        if not path:
            raise RuntimeError(
                "Local Chrome not found. Install Google Chrome, or choose Chromium / custom path."
            )
        return path, False

    # chromium (default)
    if headless and detected["headless_shell"]:
        return detected["headless_shell"], True
    path = detected["chromium"] or detected["headless_shell"]
    if not path:
        raise RuntimeError(
            "Playwright Chromium not found. Run: cd backend && uv run browser-use install"
        )
    return path, "headless-shell" in Path(path).name


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])


def _wait_cdp(port: int, timeout: float = 30.0) -> dict:
    url = f"http://127.0.0.1:{port}/json/version"
    deadline = time.time() + timeout
    last_err: Exception | None = None
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=1.5) as resp:
                return json.loads(resp.read().decode())
        except Exception as e:
            last_err = e
            time.sleep(0.25)
    raise RuntimeError(f"Chrome CDP not ready on :{port}: {last_err}")


def under_cursor() -> bool:
    if os.environ.get("CURSOR_TRACE_ID") or os.environ.get("VSCODE_PID"):
        return True
    try:
        import psutil

        p = psutil.Process()
        for _ in range(12):
            p = p.parent()
            if p is None:
                break
            name = (p.name() or "").lower()
            cmdline = " ".join(p.cmdline() or []).lower()
            if "cursor" in name or "cursor" in cmdline:
                return True
    except Exception:
        pass
    return False


@dataclass
class LaunchedBrowser:
    cdp_url: str
    proc: Any
    executable: str
    engine: str


def _build_args(exe: str, port: int, profile: Path, *, headless: bool, is_shell: bool) -> list[str]:
    args = [
        exe,
        f"--remote-debugging-port={port}",
        f"--user-data-dir={str(profile)}",
        "--remote-allow-origins=*",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-extensions",
        "--disable-background-networking",
        "--disable-sync",
        "--disable-dev-shm-usage",
        "--disable-features=TranslateUI,ChromeWhatsNewUI,Crashpad",
        "--disable-crash-reporter",
        "--password-store=basic",
        "--use-mock-keychain",
        # Suppress "unsupported command-line flag" / automation infobars
        "--test-type",
        "--disable-infobars",
        "about:blank",
    ]
    # --no-sandbox triggers the yellow/gray warning banner; only use where needed.
    # macOS Local Chrome runs fine without it.
    force_no_sandbox = os.environ.get("AGENTBROWSER_NO_SANDBOX", "").lower() in (
        "1",
        "true",
        "yes",
    )
    if force_no_sandbox or sys.platform.startswith("linux"):
        args.insert(-1, "--no-sandbox")
    if headless and not is_shell:
        args.insert(-1, "--headless=new")
        args.insert(-1, "--disable-gpu")
    return args


def _launch_via_osascript(script_path: Path) -> int:
    cmd = (
        "do shell script "
        + json.dumps(f"nohup {shlex.quote(str(script_path))} >/dev/null 2>&1 & echo $!")
    )
    out = subprocess.check_output(["osascript", "-e", cmd], text=True).strip()
    return int(out.splitlines()[-1].strip())


def _launch_via_popen(args: list[str], log_path: Path) -> subprocess.Popen:
    env = os.environ.copy()
    for key in list(env):
        if key.startswith("ELECTRON_") or key.startswith("CURSOR_") or key.startswith("VSCODE_"):
            env.pop(key, None)
    with open(log_path, "ab") as logf:
        return subprocess.Popen(
            args,
            stdout=logf,
            stderr=subprocess.STDOUT,
            stdin=subprocess.DEVNULL,
            start_new_session=True,
            env=env,
            close_fds=True,
        )


def _looks_like_cursor_chromium_crash(log_tail: str) -> bool:
    t = (log_tail or "").lower()
    return (
        "permission denied" in t
        or "crashpad" in t
        or "received signal 6" in t
        or "sigabrt" in t
    )


def launch_chrome_cdp(
    session_dir: Path,
    *,
    headless: bool = True,
    engine: str = "chromium",
    custom_path: str | None = None,
    _retried: bool = False,
) -> LaunchedBrowser:
    session_dir.mkdir(parents=True, exist_ok=True)
    profile = session_dir / "chrome-profile"
    for name in ("SingletonLock", "SingletonCookie", "SingletonSocket"):
        try:
            (profile / name).unlink(missing_ok=True)
        except Exception:
            pass
    profile.mkdir(parents=True, exist_ok=True)

    # Headed runs under Cursor: prefer Local Chrome (Playwright Chromium often SIGABRTs).
    if (
        not _retried
        and sys.platform == "darwin"
        and under_cursor()
        and not headless
        and engine == "chromium"
        and detect_browsers().get("chrome")
    ):
        logger.info("Under Cursor + headed: using Local Chrome instead of Playwright Chromium")
        engine = "chrome"

    exe, is_shell = resolve_executable(engine, custom_path=custom_path, headless=headless)
    port = _free_port()
    args = _build_args(exe, port, profile, headless=headless, is_shell=is_shell)
    log_path = session_dir / "chrome-launch.log"
    log_path.write_text("")

    cursor = under_cursor()
    force_external = os.environ.get("AGENTBROWSER_EXTERNAL_CHROME", "").lower() in (
        "1",
        "true",
        "yes",
    ) or (sys.platform == "darwin" and cursor)

    logger.info(
        "Launching browser engine=%s exe=%s headless=%s shell=%s port=%s external=%s",
        engine,
        exe,
        headless,
        is_shell,
        port,
        force_external,
    )

    launch_script = session_dir / "launch-chrome.sh"
    launch_script.write_text(
        "#!/bin/bash\n"
        f"exec {' '.join(shlex.quote(a) for a in args)} "
        f">>{shlex.quote(str(log_path))} 2>&1\n"
    )
    launch_script.chmod(0o755)

    proc: Any
    if force_external and sys.platform == "darwin":
        try:
            pid = _launch_via_osascript(launch_script)
            proc = PidProc(pid)
            logger.info("Launched browser outside Cursor via osascript pid=%s", pid)
        except Exception as e:
            logger.warning("osascript launch failed (%s); falling back to Popen", e)
            proc = _launch_via_popen(args, log_path)
    else:
        proc = _launch_via_popen(args, log_path)

    try:
        for _ in range(150):
            if proc.poll() is not None:
                raise RuntimeError(f"Browser exited early with code {proc.poll()}")
            try:
                _wait_cdp(port, timeout=0.35)
                break
            except Exception:
                time.sleep(0.2)
        else:
            _wait_cdp(port, timeout=1.0)
    except Exception as e:
        try:
            proc.terminate()
        except Exception:
            pass
        try:
            proc.kill()
        except Exception:
            pass
        tail = ""
        try:
            tail = log_path.read_text(errors="replace")[-2000:]
        except Exception:
            pass
        # Auto-retry headed Local Chrome after Playwright Chromium crashpad failures.
        if (
            not _retried
            and engine == "chromium"
            and not headless
            and detect_browsers().get("chrome")
            and _looks_like_cursor_chromium_crash(tail)
        ):
            logger.warning(
                "Chromium failed under Cursor (%s); retrying with Local Chrome headed",
                type(e).__name__,
            )
            return launch_chrome_cdp(
                session_dir,
                headless=False,
                engine="chrome",
                custom_path=None,
                _retried=True,
            )
        hint = (
            "\n\nIf this keeps failing under Cursor on macOS, start AI Assurance Platform from Terminal:\n"
            "  cd ~/browser-use && ./start.sh\n"
            "Or double-click start-in-terminal.command\n"
            "Tip: Settings → Browser engine → Local Chrome, Headless off.\n"
        )
        raise RuntimeError(
            f"Browser failed to start (engine={engine}, pid={getattr(proc, 'pid', '?')}, exe={exe}).{hint}\nLog:\n{tail}"
        ) from e

    return LaunchedBrowser(
        cdp_url=f"http://127.0.0.1:{port}",
        proc=proc,
        executable=exe,
        engine=engine,
    )


def _kill_chrome_by_profile(profile: Path) -> None:
    """Best-effort kill of Chrome launched with --user-data-dir=<profile>."""
    needle = str(profile)
    try:
        out = subprocess.check_output(["ps", "aux"], text=True, errors="replace")
    except Exception:
        return
    for line in out.splitlines():
        if needle not in line:
            continue
        # Prefer killing the main browser process (not helpers).
        if "--type=" in line:
            continue
        try:
            pid = int(line.split()[1])
            os.kill(pid, signal.SIGTERM)
        except Exception:
            pass
    time.sleep(0.4)
    try:
        out = subprocess.check_output(["ps", "aux"], text=True, errors="replace")
    except Exception:
        return
    for line in out.splitlines():
        if needle not in line or "--type=" in line:
            continue
        try:
            pid = int(line.split()[1])
            os.kill(pid, signal.SIGKILL)
        except Exception:
            pass


def stop_browser(session_id: str, session_path: Path | None = None) -> None:
    proc = _PROCS.pop(session_id, None)
    if proc:
        try:
            proc.terminate()
        except Exception:
            pass
        try:
            proc.wait(timeout=3)
        except Exception:
            try:
                proc.kill()
            except Exception:
                pass
    # Always sweep by profile — osascript / keep_alive can leave orphans.
    if session_path is None:
        from .config import settings

        session_path = settings.data_dir / "sessions" / session_id
    profile = session_path / "chrome-profile"
    if profile.exists():
        _kill_chrome_by_profile(profile)


def build_browser(
    session_dir: Path,
    *,
    headless: bool = True,
    session_id: str | None = None,
    engine: str = "chromium",
    custom_path: str | None = None,
):
    """Create a browser-use Browser attached to our CDP endpoint."""
    from browser_use import Browser

    launched = launch_chrome_cdp(
        session_dir,
        headless=headless,
        engine=engine,
        custom_path=custom_path,
    )
    if session_id:
        _PROCS[session_id] = launched.proc

    logger.info(
        "CDP ready at %s (engine=%s pid=%s)",
        launched.cdp_url,
        launched.engine,
        launched.proc.pid,
    )
    return Browser(cdp_url=launched.cdp_url, is_local=True, keep_alive=True)
