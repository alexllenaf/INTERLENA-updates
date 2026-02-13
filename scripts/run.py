#!/usr/bin/env python3
from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
RUN_APP = ROOT / "run_app.py"

TASKS: dict[str, list[str]] = {
    "desktop": ["--desktop"],
    "dev": [],  # Fullstack (web) dev server in the browser.
    "legacy": ["--legacy"],
}


def main() -> None:
    parser = argparse.ArgumentParser(description="Unified task runner for Interview Atlas.")
    parser.add_argument(
        "task",
        nargs="?",
        default="desktop",
        choices=sorted(TASKS.keys()),
        help="Task to run (default: desktop).",
    )
    parser.add_argument(
        "args",
        nargs=argparse.REMAINDER,
        help="Extra args passed to run_app.py.",
    )
    parsed = parser.parse_args()

    if not RUN_APP.exists():
        raise SystemExit("run_app.py not found. Run this from the repo root.")

    extra_args = parsed.args
    if extra_args[:1] == ["--"]:
        extra_args = extra_args[1:]

    cmd = [sys.executable, str(RUN_APP), *TASKS[parsed.task], *extra_args]
    raise SystemExit(subprocess.call(cmd, cwd=ROOT))


if __name__ == "__main__":
    main()
