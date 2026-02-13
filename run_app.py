from __future__ import annotations

import argparse
import importlib.util
import os
import shutil
import socket
import subprocess
import sys
import time
from pathlib import Path
from typing import Iterable


def _pick_port(
    preferred: int | None = None,
    start: int = 8501,
    end: int = 8519,
) -> int:
    def _is_free(port: int) -> bool:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            return sock.connect_ex(("127.0.0.1", port)) != 0

    if preferred and _is_free(preferred):
        return preferred
    for port in range(start, end + 1):
        if _is_free(port):
            return port
    raise SystemExit(f"No free port found between {start}-{end}.")


def _wait_for_port(port: int, timeout_s: float = 15.0) -> bool:
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.settimeout(0.5)
            if sock.connect_ex(("127.0.0.1", port)) == 0:
                return True
        time.sleep(0.2)
    return False


def _open_in_safari(url: str) -> None:
    try:
        subprocess.run(["open", "-a", "Safari", url], check=False)
    except Exception:
        # Fall back to default browser if Safari cannot be opened.
        subprocess.run(["open", url], check=False)


def _build_streamlit_cmd(
    app_path: Path, port: int | None, extra_args: Iterable[str]
) -> list[str]:
    cmd = [
        sys.executable,
        "-m",
        "streamlit",
        "run",
        str(app_path),
        "--server.headless",
        "true",
        "--browser.gatherUsageStats",
        "false",
    ]
    if port is not None:
        cmd.extend(["--server.port", str(port)])
    cmd.extend(extra_args)
    return cmd


def _require_command(name: str, hint: str) -> None:
    if shutil.which(name):
        return
    raise SystemExit(f"Missing required command '{name}'. {hint}")


def _run_pip_install(requirements_path: Path) -> None:
    result = subprocess.call(
        [sys.executable, "-m", "pip", "install", "-r", str(requirements_path)]
    )
    if result != 0:
        raise SystemExit("Failed to install Python dependencies.")


def _ensure_backend_deps(backend_dir: Path, allow_install: bool) -> None:
    if importlib.util.find_spec("uvicorn") is not None:
        return
    if not allow_install:
        raise SystemExit(
            "Missing Python module 'uvicorn'. Run: python3 -m pip install -r backend/requirements.txt"
        )
    requirements_path = backend_dir / "requirements.txt"
    if not requirements_path.exists():
        raise SystemExit("backend/requirements.txt not found.")
    _run_pip_install(requirements_path)
    if importlib.util.find_spec("uvicorn") is None:
        raise SystemExit("Failed to import 'uvicorn' after installing dependencies.")


def _ensure_frontend_deps(frontend_dir: Path, allow_install: bool) -> None:
    _require_command(
        "npm",
        "Install Node.js (npm) and retry. On macOS with Homebrew: brew install node",
    )
    if not allow_install:
        if not (frontend_dir / "node_modules").exists():
            raise SystemExit("node_modules is missing. Run: npm install (inside frontend).")
        return
    if not (frontend_dir / "node_modules").exists():
        result = subprocess.call(["npm", "install"], cwd=frontend_dir)
        if result != 0:
            raise SystemExit("Failed to install frontend dependencies (npm install).")


def _run_streamlit(extra_args: list[str]) -> None:
    app_path = Path(__file__).with_name("app.py").resolve()
    deps_path = Path(__file__).with_name("setup_deps.py").resolve()
    if not app_path.exists():
        raise SystemExit(f"app.py not found at: {app_path}")
    if deps_path.exists():
        subprocess.call([sys.executable, str(deps_path)])

    try:
        import streamlit  # noqa: F401
    except Exception as exc:  # pragma: no cover
        raise SystemExit(
            "Streamlit is not installed. Run: pip install -r requirements.txt"
        ) from exc

    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--port", type=int)
    args, streamlit_args = parser.parse_known_args(extra_args)

    port_from_args = None
    for idx, arg in enumerate(streamlit_args):
        if arg == "--server.port" and idx + 1 < len(streamlit_args):
            try:
                port_from_args = int(streamlit_args[idx + 1])
            except ValueError:
                pass
        elif arg.startswith("--server.port="):
            try:
                port_from_args = int(arg.split("=", 1)[1])
            except ValueError:
                pass

    preferred_port = port_from_args or args.port
    port = _pick_port(preferred_port)
    url = f"http://localhost:{port}"

    env = os.environ.copy()
    env["STREAMLIT_SERVER_HEADLESS"] = "true"
    env["STREAMLIT_BROWSER_GATHER_USAGE_STATS"] = "false"

    use_port_flag = None if port_from_args is not None else port
    cmd = _build_streamlit_cmd(app_path, use_port_flag, streamlit_args)
    proc = subprocess.Popen(cmd, env=env)

    if _wait_for_port(port, timeout_s=15.0):
        _open_in_safari(url)
    else:
        print(
            f"Streamlit started, but the server did not respond on {url}",
            file=sys.stderr,
        )

    try:
        proc.wait()
    except KeyboardInterrupt:
        proc.terminate()


def _run_desktop_dev(*, backend_port: int, skip_install: bool) -> None:
    root = Path(__file__).resolve().parent
    frontend_dir = root / "frontend"
    backend_bin = root / "backend" / "dist" / "interview-atlas-backend"

    if not (frontend_dir / "package.json").exists():
        raise SystemExit("frontend/package.json not found. Did you generate the React app?")

    _ensure_frontend_deps(frontend_dir, allow_install=not skip_install)
    _require_command(
        "cargo",
        "Install Rust (cargo) and retry. On macOS: https://www.rust-lang.org/tools/install",
    )

    if not backend_bin.exists():
        raise SystemExit("backend/dist/interview-atlas-backend not found. Build the backend binary first.")

    env = os.environ.copy()
    env["APP_PORT"] = str(backend_port)

    # Starts the Tauri desktop app in dev mode. Vite runs via beforeDevCommand in tauri.conf.json.
    raise SystemExit(subprocess.call(["npm", "run", "tauri:dev"], cwd=frontend_dir, env=env))


def _run_fullstack(
    *,
    backend_port: int,
    frontend_port: int,
    open_browser: bool,
    skip_install: bool,
) -> None:
    root = Path(__file__).resolve().parent
    backend_dir = root / "backend"
    frontend_dir = root / "frontend"

    if not (backend_dir / "app" / "main.py").exists():
        raise SystemExit("backend/app/main.py not found. Did you generate the FastAPI backend?")
    if not (frontend_dir / "package.json").exists():
        raise SystemExit("frontend/package.json not found. Did you generate the React app?")

    _ensure_backend_deps(backend_dir, allow_install=not skip_install)
    _ensure_frontend_deps(frontend_dir, allow_install=not skip_install)

    backend_port = _pick_port(backend_port, start=8000, end=8020)
    frontend_port = _pick_port(frontend_port, start=5173, end=5190)

    backend_cmd = [
        sys.executable,
        "-m",
        "uvicorn",
        "app.main:app",
        "--reload",
        "--port",
        str(backend_port),
    ]
    backend_proc = subprocess.Popen(backend_cmd, cwd=backend_dir)

    frontend_cmd = [
        "npm",
        "run",
        "dev",
        "--",
        "--host",
        "127.0.0.1",
        "--port",
        str(frontend_port),
    ]
    frontend_proc = subprocess.Popen(frontend_cmd, cwd=frontend_dir)

    url = f"http://127.0.0.1:{frontend_port}"
    if _wait_for_port(frontend_port, timeout_s=25.0) and open_browser:
        _open_in_safari(url)
    elif open_browser:
        print(f"Frontend started, but the server did not respond on {url}", file=sys.stderr)

    try:
        backend_proc.wait()
        frontend_proc.wait()
    except KeyboardInterrupt:
        backend_proc.terminate()
        frontend_proc.terminate()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--legacy", action="store_true", help="Run the old Streamlit app.")
    parser.add_argument("--desktop", action="store_true", help="Run the Tauri desktop app (dev).")
    parser.add_argument("--backend-port", type=int, default=8000)
    parser.add_argument("--frontend-port", type=int, default=5173)
    parser.add_argument("--no-open", action="store_true")
    parser.add_argument("--no-install", action="store_true")
    args, extra_args = parser.parse_known_args(sys.argv[1:])

    if args.desktop:
        _run_desktop_dev(backend_port=args.backend_port, skip_install=args.no_install)
        return

    if args.legacy:
        _run_streamlit(extra_args)
        return

    _run_fullstack(
        backend_port=args.backend_port,
        frontend_port=args.frontend_port,
        open_browser=not args.no_open,
        skip_install=args.no_install,
    )


if __name__ == "__main__":
    main()
