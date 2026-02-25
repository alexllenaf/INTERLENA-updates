from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Database, DatabaseProperty, DatabaseView
from ..schemas import (
    DatabaseDetailOut,
    DatabaseRecordIn,
    DatabaseRecordOut,
    DatabaseRecordsOut,
)
from ..services.canonical import (
    canonical_schema_ready,
    create_database_record,
    delete_database_record,
    find_database_by_name,
    get_database_detail,
    list_database_records,
    update_database_record,
)

router = APIRouter(prefix="/api")


def _ensure_canonical_ready(db: Session) -> None:
    if canonical_schema_ready(db):
        return
    raise HTTPException(status_code=503, detail="Canonical schema is not ready yet")


@router.get("/databases")
def list_databases_api(db: Session = Depends(get_db)) -> List[Dict[str, Any]]:
    _ensure_canonical_ready(db)
    rows = db.query(Database).order_by(Database.name.asc(), Database.created_at.asc()).all()
    out: List[Dict[str, Any]] = []
    for item in rows:
        prop_count = (
            db.query(DatabaseProperty)
            .filter(DatabaseProperty.database_id == item.id)
            .count()
        )
        view_count = (
            db.query(DatabaseView)
            .filter(DatabaseView.database_id == item.id)
            .count()
        )
        out.append(
            {
                "id": item.id,
                "name": item.name,
                "properties": prop_count,
                "views": view_count,
                "created_at": item.created_at,
                "updated_at": item.updated_at,
            }
        )
    return out


@router.get("/databases/by-name/{database_name}")
def get_database_by_name_api(database_name: str, db: Session = Depends(get_db)) -> Dict[str, Any]:
    _ensure_canonical_ready(db)
    row = find_database_by_name(db, database_name)
    if not row:
        raise HTTPException(status_code=404, detail="Database not found")
    return {
        "id": row.id,
        "name": row.name,
        "created_at": row.created_at,
        "updated_at": row.updated_at,
    }


@router.get("/databases/{database_id}", response_model=DatabaseDetailOut)
def get_database_detail_api(database_id: str, db: Session = Depends(get_db)) -> DatabaseDetailOut:
    _ensure_canonical_ready(db)
    try:
        payload = get_database_detail(db, database_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return DatabaseDetailOut(**payload)


@router.get("/databases/{database_id}/records", response_model=DatabaseRecordsOut)
def list_database_records_api(
    database_id: str,
    view_id: Optional[str] = Query(None),
    db: Session = Depends(get_db),
) -> DatabaseRecordsOut:
    _ensure_canonical_ready(db)
    try:
        payload = list_database_records(db, database_id, view_id=view_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return DatabaseRecordsOut(**payload)


@router.post("/databases/{database_id}/records", response_model=DatabaseRecordOut)
def create_database_record_api(
    database_id: str,
    payload: DatabaseRecordIn,
    db: Session = Depends(get_db),
) -> DatabaseRecordOut:
    _ensure_canonical_ready(db)
    try:
        created = create_database_record(
            db,
            database_id,
            values=payload.values,
            page_patch=payload.page,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    db.commit()
    return DatabaseRecordOut(**created)


@router.patch("/databases/{database_id}/records/{record_id}", response_model=DatabaseRecordOut)
def update_database_record_api(
    database_id: str,
    record_id: str,
    payload: DatabaseRecordIn,
    db: Session = Depends(get_db),
) -> DatabaseRecordOut:
    _ensure_canonical_ready(db)
    try:
        updated = update_database_record(
            db,
            database_id,
            record_id,
            values=payload.values,
            page_patch=payload.page,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    db.commit()
    return DatabaseRecordOut(**updated)


@router.delete("/databases/{database_id}/records/{record_id}")
def delete_database_record_api(
    database_id: str,
    record_id: str,
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    _ensure_canonical_ready(db)
    try:
        delete_database_record(db, database_id, record_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    db.commit()
    return {"deleted": True}
