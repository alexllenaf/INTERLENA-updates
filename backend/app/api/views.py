from __future__ import annotations

from typing import Any, Dict, List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..crud import create_view, delete_view, get_view, list_views, update_view
from ..db import get_db
from ..schemas import ViewCreate, ViewOut, ViewUpdate
from ..services.views import to_view_out

router = APIRouter(prefix="/api")


def _get_view_or_404(db: Session, view_id: str):
    view = get_view(db, view_id)
    if not view:
        raise HTTPException(status_code=404, detail="View not found")
    return view


@router.get("/views", response_model=List[ViewOut])
def get_views_api(db: Session = Depends(get_db)) -> List[ViewOut]:
    views = list_views(db)
    return [to_view_out(view) for view in views]


@router.post("/views", response_model=ViewOut)
def create_view_api(payload: ViewCreate, db: Session = Depends(get_db)) -> ViewOut:
    view = create_view(db, payload.name, payload.view_type, payload.config)
    return to_view_out(view)


@router.put("/views/{view_id}", response_model=ViewOut)
def update_view_api(view_id: str, payload: ViewUpdate, db: Session = Depends(get_db)) -> ViewOut:
    view = _get_view_or_404(db, view_id)
    updated = update_view(db, view, payload.model_dump(exclude_unset=True))
    return to_view_out(updated)


@router.delete("/views/{view_id}")
def delete_view_api(view_id: str, db: Session = Depends(get_db)) -> Dict[str, Any]:
    view = _get_view_or_404(db, view_id)
    delete_view(db, view)
    return {"deleted": True}
