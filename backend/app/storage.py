from __future__ import annotations

import json
import os
import platform
import re
import shutil
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional

from sqlalchemy.engine import Engine
from sqlalchemy.engine.url import make_url

from .migrations import SCHEMA_VERSION, iter_pending
from .version import APP_NAME, APP_VERSION


@dataclass(frozen=True)
class StoragePaths:
    base_dir: Path
    db_path: Path
    uploads_dir: Path
    backups_dir: Path
    state_path: Path
    metrics_path: Path


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _safe_app_dir(name: str) -> str:
    cleaned = re.sub(r"[\\/]+", "-", name.strip())
    return cleaned or "AppData"


def _default_data_dir(app_name: str) -> Path:
    override = os.getenv("APP_DATA_DIR")
    if override:
        return Path(override).expanduser().resolve()

    system = platform.system()
    if system == "Darwin":
        return Path.home() / "Library" / "Application Support" / _safe_app_dir(app_name)
    if system == "Windows":
        base = os.getenv("APPDATA") or os.getenv("LOCALAPPDATA")
        if not base:
            base = str(Path.home() / "AppData" / "Roaming")
        return Path(base) / _safe_app_dir(app_name)

    xdg = os.getenv("XDG_DATA_HOME")
    if xdg:
        return Path(xdg) / _safe_app_dir(app_name)
    return Path.home() / ".local" / "share" / _safe_app_dir(app_name)


def get_storage_paths(app_name: str = APP_NAME) -> StoragePaths:
    base_dir = _default_data_dir(app_name)
    return StoragePaths(
        base_dir=base_dir,
        db_path=base_dir / "applications.db",
        uploads_dir=base_dir / "uploads",
        backups_dir=base_dir / "backups",
        state_path=base_dir / "state.json",
        metrics_path=base_dir / "metrics" / "startup.json",
    )


def _resolve_sqlite_path(database_url: Optional[str]) -> Optional[Path]:
    if not database_url:
        return None
    if not database_url.startswith("sqlite"):
        return None
    url = make_url(database_url)
    if not url.database or url.database == ":memory:":
        return None
    path = Path(url.database)
    if not path.is_absolute():
        path = (Path.cwd() / path).resolve()
    return path


def _default_state() -> Dict[str, Any]:
    return {
        "schema_version": 0,
        "last_run_version": None,
        "last_run_ok": True,
        "last_start": None,
        "last_shutdown": None,
        "last_backup": None,
        "rollback_used": False,
        "last_error": None,
        "legacy_migrated": False,
    }


class StorageManager:
    def __init__(
        self,
        app_name: str = APP_NAME,
        app_version: str = APP_VERSION,
        root_dir: Optional[Path] = None,
    ) -> None:
        self.app_name = app_name
        self.app_version = app_version
        self.paths = get_storage_paths(app_name)
        self.root_dir = root_dir or Path(__file__).resolve().parents[2]
        self._db_path: Optional[Path] = None
        self._uploads_dir: Optional[Path] = None
        self._state: Optional[Dict[str, Any]] = None

    @property
    def state(self) -> Dict[str, Any]:
        return self._state or _default_state()

    def load_state(self) -> Dict[str, Any]:
        if not self.paths.state_path.exists():
            return _default_state()
        try:
            payload = json.loads(self.paths.state_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            return _default_state()
        state = _default_state()
        state.update(payload if isinstance(payload, dict) else {})
        return state

    def save_state(self, state: Dict[str, Any]) -> None:
        self.paths.state_path.parent.mkdir(parents=True, exist_ok=True)
        self.paths.state_path.write_text(json.dumps(state, indent=2), encoding="utf-8")

    def prepare(self, database_url: Optional[str] = None, uploads_dir: Optional[str] = None) -> None:
        self._db_path = _resolve_sqlite_path(database_url) or self.paths.db_path
        self._uploads_dir = Path(uploads_dir) if uploads_dir else self.paths.uploads_dir

        self.paths.base_dir.mkdir(parents=True, exist_ok=True)
        self.paths.backups_dir.mkdir(parents=True, exist_ok=True)
        self.paths.metrics_path.parent.mkdir(parents=True, exist_ok=True)

        state = self.load_state()
        if not state.get("legacy_migrated"):
            self._migrate_legacy_data(state)

        state = self._maybe_rollback(state)

        if state.get("last_run_version") and state["last_run_version"] != self.app_version:
            backup = self.create_backup(reason="pre_update")
            if backup:
                state["last_backup"] = str(backup)

        state["last_run_ok"] = False
        state["last_run_version"] = self.app_version
        state["last_start"] = _now_iso()
        state["schema_version"] = int(state.get("schema_version") or 0)
        state["last_error"] = None
        self.save_state(state)
        self._state = state

    def mark_shutdown(self) -> None:
        state = self.state
        state["last_run_ok"] = True
        state["last_shutdown"] = _now_iso()
        self.save_state(state)
        self._state = state

    def apply_migrations(self, engine: Engine) -> None:
        state = self.state
        current_version = int(state.get("schema_version") or 0)
        if current_version >= SCHEMA_VERSION:
            return

        for migration in iter_pending(current_version):
            backup = self.create_backup(reason=f"schema_v{migration.version}")
            try:
                migration.apply(engine)
            except Exception as exc:
                state["last_error"] = f"migration_failed:{migration.version}:{exc}"
                self.save_state(state)
                if backup:
                    self.restore_backup(Path(backup))
                raise
            else:
                current_version = migration.version
                state["schema_version"] = current_version
                if backup:
                    state["last_backup"] = str(backup)
                self.save_state(state)

    def create_backup(self, reason: str) -> Optional[Path]:
        db_path = self._db_path
        uploads_dir = self._uploads_dir
        if not db_path and not uploads_dir:
            return None

        timestamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
        stamp = f"{timestamp}-{reason}"
        backup_dir = self.paths.backups_dir / stamp
        backup_dir.mkdir(parents=True, exist_ok=True)

        manifest: Dict[str, Any] = {
            "created_at": _now_iso(),
            "reason": reason,
            "app_version": self.app_version,
            "schema_version": self.state.get("schema_version", 0),
            "db_path": str(db_path) if db_path else None,
            "uploads_dir": str(uploads_dir) if uploads_dir else None,
        }

        if db_path and db_path.exists():
            backup_db = backup_dir / "applications.db"
            self._backup_sqlite(db_path, backup_db)

        if uploads_dir and uploads_dir.exists():
            dest_uploads = backup_dir / "uploads"
            shutil.copytree(uploads_dir, dest_uploads)

        (backup_dir / "manifest.json").write_text(
            json.dumps(manifest, indent=2), encoding="utf-8"
        )

        self._prune_backups(keep=5)
        return backup_dir

    def create_backup_archive(self, reason: str) -> Path:
        backup_dir = self.create_backup(reason)
        if not backup_dir:
            raise RuntimeError("No data available to backup.")
        archive_base = str(backup_dir)
        shutil.make_archive(archive_base, "zip", root_dir=backup_dir)
        return Path(f"{archive_base}.zip")

    def restore_backup(self, backup_dir: Path) -> None:
        db_path = self._db_path
        uploads_dir = self._uploads_dir
        if not backup_dir.exists():
            return

        if db_path:
            backup_db = backup_dir / "applications.db"
            if backup_db.exists():
                db_path.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(backup_db, db_path)

        if uploads_dir:
            backup_uploads = backup_dir / "uploads"
            if backup_uploads.exists():
                if uploads_dir.exists():
                    shutil.rmtree(uploads_dir)
                shutil.copytree(backup_uploads, uploads_dir)

    def _backup_sqlite(self, source: Path, dest: Path) -> None:
        dest.parent.mkdir(parents=True, exist_ok=True)
        with sqlite3.connect(str(source)) as src:
            with sqlite3.connect(str(dest)) as dst:
                src.backup(dst)

    def _prune_backups(self, keep: int = 5) -> None:
        backups = sorted(
            [p for p in self.paths.backups_dir.iterdir() if p.is_dir()],
            key=lambda p: p.name,
            reverse=True,
        )
        for extra in backups[keep:]:
            shutil.rmtree(extra, ignore_errors=True)

    def _migrate_legacy_data(self, state: Dict[str, Any]) -> None:
        legacy_data_dir = self.root_dir / "data"
        legacy_db = legacy_data_dir / "applications.db"
        legacy_uploads = legacy_data_dir / "uploads"

        if legacy_db.exists() and self._db_path and not self._db_path.exists():
            self._db_path.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(legacy_db, self._db_path)

        if legacy_uploads.exists() and self._uploads_dir and not self._uploads_dir.exists():
            self._uploads_dir.parent.mkdir(parents=True, exist_ok=True)
            shutil.copytree(legacy_uploads, self._uploads_dir)

        state["legacy_migrated"] = True
        self.save_state(state)

    def _maybe_rollback(self, state: Dict[str, Any]) -> Dict[str, Any]:
        last_ok = state.get("last_run_ok", True)
        last_version = state.get("last_run_version")
        backup = state.get("last_backup")
        if not last_ok and backup and last_version and last_version != self.app_version:
            self.restore_backup(Path(backup))
            state["rollback_used"] = True
        return state


_storage_manager: Optional[StorageManager] = None


def get_storage_manager() -> StorageManager:
    global _storage_manager
    if _storage_manager is None:
        _storage_manager = StorageManager()
    return _storage_manager
