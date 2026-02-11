from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Body, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from ..crud import (
    application_to_dict,
    create_application,
    delete_applications,
    get_application,
    list_applications,
    touch_last_viewed,
    update_application,
)
from ..db import get_db
from ..schemas import ApplicationCreate, ApplicationOut, ApplicationUpdate
from ..services.documents import delete_document_file, document_path, store_uploads
from ..utils import list_to_json, parse_json_list

router = APIRouter(prefix="/api")


def _get_application_or_404(db: Session, app_id: int):
    app_row = get_application(db, app_id)
    if not app_row:
        raise HTTPException(status_code=404, detail="Application not found")
    return app_row


@router.get("/applications", response_model=List[ApplicationOut])
def get_applications(
    search: Optional[str] = Query(None, alias="q"),
    outcomes: Optional[List[str]] = Query(None),
    stages: Optional[List[str]] = Query(None),
    job_types: Optional[List[str]] = Query(None),
    favorites_only: bool = False,
    db: Session = Depends(get_db),
) -> List[ApplicationOut]:
    apps = list_applications(
        db,
        search=search,
        outcomes=outcomes,
        stages=stages,
        job_types=job_types,
        favorites_only=favorites_only,
    )
    return [ApplicationOut(**application_to_dict(app)) for app in apps]


@router.post("/applications", response_model=ApplicationOut)
def create_application_api(
    payload: ApplicationCreate,
    db: Session = Depends(get_db),
) -> ApplicationOut:
    try:
        app_row = create_application(db, payload.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return ApplicationOut(**application_to_dict(app_row))


@router.get("/applications/{app_id}", response_model=ApplicationOut)
def get_application_api(app_id: int, db: Session = Depends(get_db)) -> ApplicationOut:
    app_row = _get_application_or_404(db, app_id)
    return ApplicationOut(**application_to_dict(app_row))


@router.put("/applications/{app_id}", response_model=ApplicationOut)
def update_application_api(
    app_id: int, payload: ApplicationUpdate, db: Session = Depends(get_db)
) -> ApplicationOut:
    app_row = _get_application_or_404(db, app_id)
    try:
        updated = update_application(db, app_row, payload.model_dump(exclude_unset=True))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return ApplicationOut(**application_to_dict(updated))


@router.post("/applications/{app_id}/documents", response_model=ApplicationOut)
def upload_documents_api(
    app_id: int,
    files: List[UploadFile] = File(...),
    db: Session = Depends(get_db),
) -> ApplicationOut:
    app_row = _get_application_or_404(db, app_id)
    if not files:
        raise HTTPException(status_code=400, detail="No files provided")

    stored = parse_json_list(app_row.documents_files)
    stored = store_uploads(app_id, files, stored)

    app_row.documents_files = list_to_json(stored)
    app_row.updated_at = datetime.utcnow()
    db.add(app_row)
    db.commit()
    db.refresh(app_row)
    return ApplicationOut(**application_to_dict(app_row))


@router.get("/applications/{app_id}/documents/{file_id}")
def download_document_api(
    app_id: int, file_id: str, db: Session = Depends(get_db)
) -> FileResponse:
    app_row = _get_application_or_404(db, app_id)
    stored = parse_json_list(app_row.documents_files)
    entry = next((item for item in stored if item.get("id") == file_id), None)
    if not entry:
        raise HTTPException(status_code=404, detail="Document not found")
    path = document_path(app_id, file_id)
    if not path.exists():
        raise HTTPException(status_code=404, detail="File missing on disk")
    filename = entry.get("name") or file_id
    return FileResponse(
        path,
        filename=filename,
        media_type=entry.get("content_type") or "application/octet-stream",
    )


@router.delete("/applications/{app_id}/documents/{file_id}", response_model=ApplicationOut)
def delete_document_api(
    app_id: int, file_id: str, db: Session = Depends(get_db)
) -> ApplicationOut:
    app_row = _get_application_or_404(db, app_id)
    stored = parse_json_list(app_row.documents_files)
    next_files = [item for item in stored if item.get("id") != file_id]
    if len(next_files) == len(stored):
        raise HTTPException(status_code=404, detail="Document not found")
    delete_document_file(app_id, file_id)
    app_row.documents_files = list_to_json(next_files)
    app_row.updated_at = datetime.utcnow()
    db.add(app_row)
    db.commit()
    db.refresh(app_row)
    return ApplicationOut(**application_to_dict(app_row))


@router.delete("/applications/{app_id}")
def delete_application_api(app_id: int, db: Session = Depends(get_db)) -> Dict[str, Any]:
    deleted = delete_applications(db, [app_id])
    if not deleted:
        raise HTTPException(status_code=404, detail="Application not found")
    return {"deleted": deleted}


@router.post("/applications/bulk-delete")
def bulk_delete_api(ids: List[int] = Body(...), db: Session = Depends(get_db)) -> Dict[str, Any]:
    deleted = delete_applications(db, ids)
    return {"deleted": deleted}


@router.post("/applications/{application_id}/touch")
def touch_application_api(
    application_id: str, db: Session = Depends(get_db)
) -> Dict[str, Any]:
    touch_last_viewed(db, application_id)
    return {"ok": True}
