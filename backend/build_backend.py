from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
ENTRY = ROOT / "desktop_entry.py"
DIST = ROOT / "dist"
BUILD = ROOT / "build"

EXCLUDES = [
    "tkinter",
    "matplotlib",
    "IPython",
    "pytest",
    "pandas.tests",
    "numpy.tests",
    "scipy",
]

COLLECT_SUBMODULES = ["app"]


def main() -> None:
    if not ENTRY.exists():
        raise SystemExit(f"Entry not found: {ENTRY}")

    cmd = [
        sys.executable,
        "-m",
        "PyInstaller",
        "--noconfirm",
        "--clean",
        "--onefile",
        "--name",
        "interview-atlas-backend",
        "--distpath",
        str(DIST),
        "--workpath",
        str(BUILD),
        str(ENTRY),
    ]
    if os.getenv("PYI_STRIP", "1") == "1":
        cmd.append("--strip")
    upx_dir = os.getenv("UPX_DIR")
    if upx_dir:
        cmd.extend(["--upx-dir", upx_dir])
    for item in EXCLUDES:
        cmd.extend(["--exclude-module", item])
    for item in COLLECT_SUBMODULES:
        cmd.extend(["--collect-submodules", item])
    cmd.extend(["--hidden-import", "app.main"])

    print("Running:", " ".join(cmd))
    result = subprocess.call(cmd)
    if result != 0:
        raise SystemExit(result)

    bin_path = DIST / ("interview-atlas-backend.exe" if sys.platform.startswith("win") else "interview-atlas-backend")
    if bin_path.exists():
        print(f"Backend built at: {bin_path}")
    else:
        print("Build finished, but binary not found. Check PyInstaller output.")


if __name__ == "__main__":
    main()
