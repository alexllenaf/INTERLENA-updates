from __future__ import annotations

import json
import uuid
from datetime import datetime
from typing import Any, Dict, List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..crud import create_view, delete_view, get_view, list_views, update_view
from ..db import get_db
from ..models import Database, DatabaseView
from ..schemas import ViewCreate, ViewOut, ViewUpdate
from ..services.canonical import canonical_schema_ready
from ..services.views import to_view_out

router = APIRouter(prefix="/api")


def _get_view_or_404(db: Session, view_id: str):
    view = get_view(db, view_id)
    if not view:
        raise HTTPException(status_code=404, detail="View not found")
    return view


def _parse_canonical_view_config(raw: str | None) -> Dict[str, Any]:
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _database_view_to_out(view: DatabaseView) -> ViewOut:
    return ViewOut(
        view_id=view.id,
        database_id=view.database_id,
        name=view.name,
        view_type=view.type,
        config=_parse_canonical_view_config(view.config_json),
        created_at=view.created_at,
        updated_at=view.updated_at,
    )


def _get_database_view(db: Session, view_id: str) -> DatabaseView | None:
    if not canonical_schema_ready(db):
        return None
    return db.get(DatabaseView, view_id)


@router.get("/views", response_model=List[ViewOut])
def get_views_api(db: Session = Depends(get_db)) -> List[ViewOut]:
    out: List[ViewOut] = []
    if canonical_schema_ready(db):
        db_views = db.query(DatabaseView).order_by(DatabaseView.created_at.asc(), DatabaseView.name.asc()).all()
        out.extend(_database_view_to_out(view) for view in db_views)
    legacy = list_views(db)
    out.extend(to_view_out(view) for view in legacy)
    return out


@router.get("/views/{view_id}", response_model=ViewOut)
def get_view_api(view_id: str, db: Session = Depends(get_db)) -> ViewOut:
    db_view = _get_database_view(db, view_id)
    if db_view:
        return _database_view_to_out(db_view)
    view = _get_view_or_404(db, view_id)
    return to_view_out(view)


@router.post("/views", response_model=ViewOut)
def create_view_api(payload: ViewCreate, db: Session = Depends(get_db)) -> ViewOut:
    if payload.database_id:
        if not canonical_schema_ready(db):
            raise HTTPException(status_code=503, detail="Canonical schema is not ready yet")
        database = db.get(Database, payload.database_id)
        if not database:
            raise HTTPException(status_code=404, detail="Database not found")
        now = datetime.utcnow()
        db_view = DatabaseView(
            id=str(uuid.uuid4()),
            database_id=database.id,
            name=payload.name,
            type=payload.view_type,
            config_json=json.dumps(payload.config or {}, ensure_ascii=False),
            created_at=now,
            updated_at=now,
        )
        db.add(db_view)
        db.commit()
        db.refresh(db_view)
        return _database_view_to_out(db_view)

    view = create_view(db, payload.name, payload.view_type, payload.config)
    return to_view_out(view)


@router.put("/views/{view_id}", response_model=ViewOut)
def update_view_api(view_id: str, payload: ViewUpdate, db: Session = Depends(get_db)) -> ViewOut:
    db_view = _get_database_view(db, view_id)
    if db_view:
        patch = payload.model_dump(exclude_unset=True)
        if "name" in patch and patch["name"] is not None:
            db_view.name = str(patch["name"])
        if "view_type" in patch and patch["view_type"] is not None:
            db_view.type = str(patch["view_type"])
        if "config" in patch and patch["config"] is not None:
            db_view.config_json = json.dumps(patch["config"], ensure_ascii=False)
        if "database_id" in patch and patch["database_id"]:
            database = db.get(Database, patch["database_id"])
            if not database:
                raise HTTPException(status_code=404, detail="Database not found")
            db_view.database_id = database.id
        db_view.updated_at = datetime.utcnow()
        db.add(db_view)
        db.commit()
        db.refresh(db_view)
        return _database_view_to_out(db_view)

    view = _get_view_or_404(db, view_id)
    updated = update_view(db, view, payload.model_dump(exclude_unset=True))
    return to_view_out(updated)


@router.delete("/views/{view_id}")
def delete_view_api(view_id: str, db: Session = Depends(get_db)) -> Dict[str, Any]:
    db_view = _get_database_view(db, view_id)
    if db_view:
        db.delete(db_view)
        db.commit()
        return {"deleted": True}
    view = _get_view_or_404(db, view_id)
    delete_view(db, view)
    return {"deleted": True}
