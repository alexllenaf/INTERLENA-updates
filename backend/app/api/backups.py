from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import FileResponse

from ..storage import get_storage_manager

router = APIRouter(prefix="/api")


@router.get("/backup/export")
def export_backup() -> FileResponse:
    manager = get_storage_manager()
    archive = manager.create_backup_archive(reason="manual")
    return FileResponse(
        path=archive,
        filename=archive.name,
        media_type="application/zip",
    )
