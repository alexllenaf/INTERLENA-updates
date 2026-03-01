from __future__ import annotations

import argparse
import importlib.util
import os
import platform
import signal
import shutil
import socket
import subprocess
import sys
import time
import unicodedata
from pathlib import Path
from typing import Iterable


DESKTOP_FRONTEND_PORT = 5173


def _default_cargo_target_dir(project_root: Path) -> Path:
    env_value = os.environ.get("CARGO_TARGET_DIR")
    if env_value:
        return Path(env_value).expanduser()

    if platform.system() == "Darwin":
        return Path.home() / "Library" / "Caches" / "interview-atlas" / "tauri-target"

    xdg_cache_home = os.environ.get("XDG_CACHE_HOME")
    if xdg_cache_home:
        return Path(xdg_cache_home) / "interview-atlas" / "tauri-target"

    return project_root / ".cache" / "tauri-target"


def _load_env_file(env_path: Path) -> dict[str, str]:
    loaded: dict[str, str] = {}
    if not env_path.exists() or not env_path.is_file():
        return loaded
    try:
        lines = env_path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return loaded

    for line in lines:
        raw = line.strip()
        if not raw or raw.startswith("#") or "=" not in raw:
            continue
        key, value = raw.split("=", 1)
        key = key.strip()
        if not key:
            continue
        value = value.strip()
        if (value.startswith('"') and value.endswith('"')) or (value.startswith("'") and value.endswith("'")):
            value = value[1:-1]
        loaded[key] = value
    return loaded


def _build_runtime_env(project_root: Path) -> dict[str, str]:
    env = os.environ.copy()
    node22_bin = Path("/opt/homebrew/opt/node@22/bin")
    if platform.system() == "Darwin" and node22_bin.exists():
        current_path = env.get("PATH", "")
        path_parts = current_path.split(":") if current_path else []
        node22_bin_str = str(node22_bin)
        if node22_bin_str not in path_parts:
            env["PATH"] = f"{node22_bin_str}:{current_path}" if current_path else node22_bin_str

    candidates = [
        project_root / ".env",
        project_root / ".env.local",
        project_root / "backend" / ".env",
        project_root / "backend" / ".env.local",
    ]
    for candidate in candidates:
        for key, value in _load_env_file(candidate).items():
            env.setdefault(key, value)
    return env


def _pick_port(
    preferred: int | None = None,
    start: int = 8501,
    end: int = 8519,
) -> int:
    if preferred and _is_port_free(preferred):
        return preferred
    for port in range(start, end + 1):
        if _is_port_free(port):
            return port
    raise SystemExit(f"No free port found between {start}-{end}.")


def _is_port_free(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        return sock.connect_ex(("127.0.0.1", port)) != 0


def _listening_processes(port: int) -> str | None:
    if not shutil.which("lsof"):
        return None
    try:
        result = subprocess.run(
            ["lsof", "-nP", f"-iTCP:{port}", "-sTCP:LISTEN"],
            check=False,
            capture_output=True,
            text=True,
        )
    except OSError:
        return None
    output = (result.stdout or "").strip()
    return output if output else None


def _listening_pids(port: int) -> list[int]:
    if not shutil.which("lsof"):
        return []
    try:
        result = subprocess.run(
            ["lsof", "-t", "-nP", f"-iTCP:{port}", "-sTCP:LISTEN"],
            check=False,
            capture_output=True,
            text=True,
        )
    except OSError:
        return []
    out: list[int] = []
    for line in (result.stdout or "").splitlines():
        raw = line.strip()
        if not raw:
            continue
        try:
            out.append(int(raw))
        except ValueError:
            continue
    return sorted(set(out))


def _process_command(pid: int) -> str | None:
    try:
        result = subprocess.run(
            ["ps", "-p", str(pid), "-o", "command="],
            check=False,
            capture_output=True,
            text=True,
        )
    except OSError:
        return None
    value = (result.stdout or "").strip()
    return value if value else None


def _process_ppid(pid: int) -> int | None:
    try:
        result = subprocess.run(
            ["ps", "-p", str(pid), "-o", "ppid="],
            check=False,
            capture_output=True,
            text=True,
        )
    except OSError:
        return None
    raw = (result.stdout or "").strip()
    if not raw:
        return None
    try:
        return int(raw)
    except ValueError:
        return None


def _is_interview_backend_command(command: str | None) -> bool:
    if not command:
        return False
    return "interview-atlas-backend" in command


def _contains_path(command: str, path: Path) -> bool:
    normalized = command.replace("\\", "/")
    target = str(path).replace("\\", "/")
    normalized_nfc = unicodedata.normalize("NFC", normalized)
    normalized_nfd = unicodedata.normalize("NFD", normalized)
    target_nfc = unicodedata.normalize("NFC", target)
    target_nfd = unicodedata.normalize("NFD", target)
    return target_nfc in normalized_nfc or target_nfd in normalized_nfd


def _is_project_vite_command(command: str | None, project_root: Path) -> bool:
    if not command:
        return False
    if "node_modules/.bin/vite" not in command:
        return False
    return _contains_path(command, project_root)


def _is_project_backend_command(command: str | None, project_root: Path) -> bool:
    if not _is_interview_backend_command(command):
        return False
    if not command:
        return False
    return _contains_path(command, project_root)


def _is_project_desktop_runtime_command(command: str | None, project_root: Path) -> bool:
    if not command:
        return False
    if not _contains_path(command, project_root):
        return False
    normalized = command.replace("\\", "/")
    if "src-tauri/target/" not in normalized:
        return False
    if "interview-atlas-backend" in normalized:
        return False
    return True


def _is_project_dev_parent_command(command: str | None, project_root: Path) -> bool:
    if not command:
        return False
    if not _contains_path(command, project_root):
        return False
    tokens = (
        "node_modules/.bin/vite",
        "node_modules/.bin/tauri",
        "npm run dev",
        "npm run tauri:dev",
        "npm-cli.js",
        "tauri dev",
    )
    return any(token in command for token in tokens)


def _project_backend_pid_chain(listener_pid: int, project_root: Path) -> list[int]:
    cmd = _process_command(listener_pid)
    if not _is_project_backend_command(cmd, project_root):
        return []

    chain = [listener_pid]
    current = listener_pid
    seen = {listener_pid}

    while True:
        parent = _process_ppid(current)
        if parent is None:
            return chain
        if parent <= 1:
            return chain
        if parent in seen:
            return chain
        seen.add(parent)
        parent_cmd = _process_command(parent)
        if not (
            _is_project_backend_command(parent_cmd, project_root)
            or _is_project_desktop_runtime_command(parent_cmd, project_root)
            or _is_project_dev_parent_command(parent_cmd, project_root)
        ):
            return chain
        chain.append(parent)
        current = parent


def _project_vite_pid_chain(listener_pid: int, project_root: Path) -> list[int]:
    cmd = _process_command(listener_pid)
    if not _is_project_vite_command(cmd, project_root):
        return []

    chain = [listener_pid]
    current = listener_pid
    seen = {listener_pid}
    while True:
        parent = _process_ppid(current)
        if parent is None:
            return chain
        if parent <= 1:
            return chain
        if parent in seen:
            return chain
        seen.add(parent)
        parent_cmd = _process_command(parent)
        if not _is_project_dev_parent_command(parent_cmd, project_root):
            return chain
        chain.append(parent)
        current = parent


def _kill_pids(pids: list[int], sig: signal.Signals) -> list[int]:
    killed: list[int] = []
    for pid in sorted(set(pids)):
        try:
            os.kill(pid, sig)
            killed.append(pid)
        except ProcessLookupError:
            continue
        except OSError:
            continue
    return killed


def _force_kill_port_listeners(port: int) -> list[int]:
    listener_pids = _listening_pids(port)
    if not listener_pids:
        return []

    _kill_pids(listener_pids, signal.SIGTERM)
    deadline = time.time() + 2.0
    while time.time() < deadline:
        if _is_port_free(port):
            return listener_pids
        time.sleep(0.1)

    remaining = _listening_pids(port)
    if remaining:
        _kill_pids(remaining, signal.SIGKILL)
        deadline = time.time() + 1.5
        while time.time() < deadline:
            if _is_port_free(port):
                break
            time.sleep(0.1)
    return listener_pids


def _cleanup_desktop_backend_processes(port: int, project_root: Path) -> list[int]:
    listener_pids = _listening_pids(port)
    if not listener_pids:
        return []

    stale_pids: list[int] = []
    for pid in listener_pids:
        stale_pids.extend(_project_backend_pid_chain(pid, project_root))
    stale_pids = sorted(set(stale_pids))
    if not stale_pids:
        return []

    _kill_pids(stale_pids, signal.SIGTERM)
    deadline = time.time() + 2.0
    while time.time() < deadline:
        if _is_port_free(port):
            return stale_pids
        time.sleep(0.1)

    _kill_pids(stale_pids, signal.SIGKILL)
    deadline = time.time() + 1.0
    while time.time() < deadline:
        if _is_port_free(port):
            break
        time.sleep(0.1)
    return stale_pids


def _cleanup_frontend_dev_server_processes(port: int, project_root: Path) -> list[int]:
    listener_pids = _listening_pids(port)
    if not listener_pids:
        return []

    stale_pids: list[int] = []
    for pid in listener_pids:
        stale_pids.extend(_project_vite_pid_chain(pid, project_root))
    stale_pids = sorted(set(stale_pids))
    if not stale_pids:
        return []

    _kill_pids(stale_pids, signal.SIGTERM)
    deadline = time.time() + 2.0
    while time.time() < deadline:
        if _is_port_free(port):
            return stale_pids
        time.sleep(0.1)

    _kill_pids(stale_pids, signal.SIGKILL)
    deadline = time.time() + 1.0
    while time.time() < deadline:
        if _is_port_free(port):
            break
        time.sleep(0.1)
    return stale_pids


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


def _newest_mtime(paths: Iterable[Path]) -> float:
    newest = 0.0
    for path in paths:
        try:
            mtime = path.stat().st_mtime
        except OSError:
            continue
        if mtime > newest:
            newest = mtime
    return newest


def _backend_source_files(backend_dir: Path) -> list[Path]:
    files: list[Path] = []
    candidates = [
        backend_dir / "desktop_entry.py",
        backend_dir / "build_backend.py",
    ]
    files.extend([path for path in candidates if path.exists()])
    app_dir = backend_dir / "app"
    if app_dir.exists():
        files.extend(app_dir.rglob("*.py"))
    return files


def _ensure_backend_sidecar_current(backend_dir: Path, backend_bin: Path) -> None:
    source_files = _backend_source_files(backend_dir)
    if not source_files:
        raise SystemExit("Backend source files not found.")
    newest_source = _newest_mtime(source_files)
    try:
        bin_mtime = backend_bin.stat().st_mtime
    except OSError:
        bin_mtime = 0.0

    if backend_bin.exists() and bin_mtime >= newest_source:
        return

    print("Rebuilding desktop backend sidecar...")
    build_script = backend_dir / "build_backend.py"
    if not build_script.exists():
        raise SystemExit("backend/build_backend.py not found.")
    result = subprocess.call([sys.executable, str(build_script)], cwd=backend_dir.parent)
    if result != 0:
        raise SystemExit("Failed to rebuild desktop backend sidecar.")
    if not backend_bin.exists():
        raise SystemExit("Backend sidecar was not produced at backend/dist/interview-atlas-backend.")


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
    env = _build_runtime_env(frontend_dir.parent)

    try:
        node_version_result = subprocess.run(
            ["node", "--version"],
            check=False,
            capture_output=True,
            text=True,
            env=env,
        )
    except OSError as exc:
        raise SystemExit("Unable to execute 'node --version'.") from exc

    node_version_raw = (node_version_result.stdout or node_version_result.stderr or "").strip()
    if node_version_result.returncode != 0:
        raise SystemExit(
            "Node.js is installed but not executable in the current environment. "
            f"Output: {node_version_raw}\n"
            "On macOS, install and use Node 22 LTS (Homebrew): brew install node@22"
        )

    node_major = None
    if node_version_raw.startswith("v"):
        parts = node_version_raw[1:].split(".")
        if parts and parts[0].isdigit():
            node_major = int(parts[0])

    if node_major is not None and node_major >= 25:
        raise SystemExit(
            f"Detected Node.js {node_version_raw}. This project uses Vite 5 and is unstable on Node >= 25. "
            "Use Node 20 or 22 LTS and retry."
        )

    if not allow_install:
        if not (frontend_dir / "node_modules").exists():
            raise SystemExit("node_modules is missing. Run: npm install (inside frontend).")
        return
    if not (frontend_dir / "node_modules").exists():
        result = subprocess.call(["npm", "install"], cwd=frontend_dir, env=env)
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
    backend_dir = root / "backend"
    frontend_dir = root / "frontend"

    if not (frontend_dir / "package.json").exists():
        raise SystemExit("frontend/package.json not found. Did you generate the React app?")
    if not (backend_dir / "app" / "main.py").exists():
        raise SystemExit("backend/app/main.py not found. Did you generate the FastAPI backend?")

    _ensure_backend_deps(backend_dir, allow_install=not skip_install)
    _ensure_frontend_deps(frontend_dir, allow_install=not skip_install)
    _require_command(
        "cargo",
        "Install Rust (cargo) and retry. On macOS: https://www.rust-lang.org/tools/install",
    )

    cleaned_frontend = _cleanup_frontend_dev_server_processes(DESKTOP_FRONTEND_PORT, root)
    if cleaned_frontend:
        print(
            f"Stopped existing frontend dev process(es) on port {DESKTOP_FRONTEND_PORT}: "
            + ", ".join(str(pid) for pid in cleaned_frontend)
        )

    if not _is_port_free(DESKTOP_FRONTEND_PORT):
        listeners = _listening_processes(DESKTOP_FRONTEND_PORT)
        msg = [
            f"Desktop frontend dev port {DESKTOP_FRONTEND_PORT} is already in use.",
            "Close any running Vite/Tauri dev process (or any process using that port) and retry.",
        ]
        if listeners:
            msg.extend(["", "Port listeners:", listeners])
        raise SystemExit("\n".join(msg))

    cleaned = _cleanup_desktop_backend_processes(backend_port, root)
    if cleaned:
        print(
            f"Stopped existing Interview Atlas backend process(es) on port {backend_port}: "
            + ", ".join(str(pid) for pid in cleaned)
        )

    if not _is_port_free(backend_port):
        forced = _force_kill_port_listeners(backend_port)
        if forced:
            print(
                f"Port {backend_port} was busy; terminated listener PID(s): "
                + ", ".join(str(pid) for pid in sorted(set(forced)))
            )

    if not _is_port_free(backend_port):
        listeners = _listening_processes(backend_port)
        msg = [
            f"Desktop backend port {backend_port} is still in use after automatic kill attempt.",
            "Stop the remaining process manually and retry.",
        ]
        if listeners:
            msg.extend(["", "Port listeners:", listeners])
        raise SystemExit("\n".join(msg))

    env = _build_runtime_env(root)
    cargo_target_dir = _default_cargo_target_dir(root)
    cargo_target_dir.mkdir(parents=True, exist_ok=True)
    env.setdefault("CARGO_TARGET_DIR", str(cargo_target_dir))
    env["APP_PORT"] = str(backend_port)
    env.setdefault("GOOGLE_OAUTH_PORT", str(backend_port))
    backend_cmd = [
        sys.executable,
        "-m",
        "uvicorn",
        "app.main:app",
        "--host",
        "127.0.0.1",
        "--port",
        str(backend_port),
    ]
    backend_proc = subprocess.Popen(backend_cmd, cwd=backend_dir, env=env)
    if not _wait_for_port(backend_port, timeout_s=20.0):
        backend_proc.terminate()
        raise SystemExit(f"Desktop backend did not become ready on http://127.0.0.1:{backend_port}")

    tauri_proc = subprocess.Popen(["npm", "run", "tauri:dev"], cwd=frontend_dir, env=env)
    try:
        raise SystemExit(tauri_proc.wait())
    except KeyboardInterrupt:
        tauri_proc.terminate()
        raise
    finally:
        if backend_proc.poll() is None:
            backend_proc.terminate()


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

    shared_env = _build_runtime_env(root)
    shared_env["APP_PORT"] = str(backend_port)
    shared_env.setdefault("GOOGLE_OAUTH_PORT", str(backend_port))

    backend_cmd = [
        sys.executable,
        "-m",
        "uvicorn",
        "app.main:app",
        "--reload",
        "--port",
        str(backend_port),
    ]
    backend_proc = subprocess.Popen(backend_cmd, cwd=backend_dir, env=shared_env)

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
    frontend_proc = subprocess.Popen(frontend_cmd, cwd=frontend_dir, env=shared_env)

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
