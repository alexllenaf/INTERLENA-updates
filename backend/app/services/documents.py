from __future__ import annotations

import shutil
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Iterable, List

from fastapi import UploadFile

from ..config import get_settings


def _uploads_base_dir() -> Path:
    base = Path(get_settings().uploads_dir)
    base.mkdir(parents=True, exist_ok=True)
    return base


def _application_upload_dir(app_id: int) -> Path:
    target = _uploads_base_dir() / str(app_id)
    target.mkdir(parents=True, exist_ok=True)
    return target


def document_path(app_id: int, file_id: str) -> Path:
    return _uploads_base_dir() / str(app_id) / file_id


def store_uploads(
    app_id: int,
    files: Iterable[UploadFile],
    existing: List[dict[str, Any]] | None = None,
) -> List[dict[str, Any]]:
    upload_dir = _application_upload_dir(app_id)
    stored = list(existing or [])

    for upload in files:
        if not upload.filename:
            continue
        file_id = str(uuid.uuid4())
        destination = upload_dir / file_id
        with destination.open("wb") as buffer:
            shutil.copyfileobj(upload.file, buffer)
        upload.file.close()
        size = destination.stat().st_size
        stored.append(
            {
                "id": file_id,
                "name": upload.filename,
                "size": size,
                "content_type": upload.content_type,
                "uploaded_at": datetime.utcnow().isoformat(),
            }
        )

    return stored


def delete_document_file(app_id: int, file_id: str) -> None:
    path = document_path(app_id, file_id)
    if path.exists():
        path.unlink()
