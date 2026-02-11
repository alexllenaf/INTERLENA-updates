from __future__ import annotations

import json
import os
import signal
import subprocess
import sys
import time
from pathlib import Path
from typing import Dict
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[1]
BACKEND_DIR = ROOT / "backend"

sys.path.insert(0, str(BACKEND_DIR))

from app.storage import get_storage_paths  # noqa: E402


def wait_for_health(url: str, timeout: float = 15.0) -> float:
    start = time.perf_counter()
    deadline = start + timeout
    while time.perf_counter() < deadline:
        try:
            with urlopen(url, timeout=0.5) as resp:
                if resp.status == 200:
                    return (time.perf_counter() - start) * 1000.0
        except Exception:
            time.sleep(0.1)
    raise TimeoutError(f"Health check timeout ({timeout}s)")


def read_metrics() -> Dict[str, float]:
    metrics_path = get_storage_paths().metrics_path
    if metrics_path.exists():
        return json.loads(metrics_path.read_text(encoding="utf-8"))
    return {}


def run_measure(label: str, env_overrides: Dict[str, str]) -> None:
    env = os.environ.copy()
    env.update(env_overrides)
    port = env.get("APP_PORT", "8005")
    cmd = [
        sys.executable,
        "-m",
        "uvicorn",
        "app.main:app",
        "--port",
        port,
    ]
    proc = subprocess.Popen(cmd, cwd=BACKEND_DIR, env=env)
    try:
        ms = wait_for_health(f"http://127.0.0.1:{port}/api/health")
        metrics = read_metrics()
        phases = metrics.get("phases_ms", {})
        total = metrics.get("total_ms")
        print(f"\n[{label}] health ready: {ms:.1f} ms")
        if phases:
            for name, value in phases.items():
                print(f"  {name}: {value:.1f} ms")
        if total:
            print(f"  total: {total:.1f} ms")
    finally:
        if proc.poll() is None:
            if sys.platform.startswith("win"):
                proc.terminate()
            else:
                proc.send_signal(signal.SIGTERM)
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()


if __name__ == "__main__":
    run_measure("eager_pandas", {"EAGER_PANDAS": "1", "APP_PORT": "8005"})
    run_measure("lazy_pandas", {"APP_PORT": "8006"})
