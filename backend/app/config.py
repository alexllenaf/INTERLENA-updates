from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from .storage import get_storage_paths


@dataclass(frozen=True)
class Settings:
    database_url: str
    cors_origins: list[str]
    uploads_dir: str


_storage_paths = get_storage_paths()
DEFAULT_SQLITE_URL = f"sqlite:///{_storage_paths.db_path.as_posix()}"
DEFAULT_UPLOADS_DIR = _storage_paths.uploads_dir.as_posix()


def get_settings() -> Settings:
    database_url = os.getenv("DATABASE_URL", DEFAULT_SQLITE_URL)
    cors_raw = os.getenv(
        "CORS_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173,tauri://localhost",
    )
    cors_origins = [origin.strip() for origin in cors_raw.split(",") if origin.strip()]
    uploads_dir = os.getenv("UPLOADS_DIR", DEFAULT_UPLOADS_DIR)
    return Settings(database_url=database_url, cors_origins=cors_origins, uploads_dir=uploads_dir)
