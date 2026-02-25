from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Block, MigrationMap, Page, Record
from ..schemas import (
    PageBlocksIn,
    PageBlocksOut,
    PageCreateIn,
    PageOut,
    PageResolveOut,
    PageUpdateIn,
)
from ..services.canonical import (
    canonical_schema_ready,
    create_page,
    find_page_by_legacy_key,
    list_page_blocks,
    list_pages,
    normalize_page_title_for_legacy_key,
    replace_page_blocks,
    resolve_page_by_legacy_key,
)

router = APIRouter(prefix="/api")


def _ensure_canonical_ready(db: Session) -> None:
    if canonical_schema_ready(db):
        return
    raise HTTPException(status_code=503, detail="Canonical schema is not ready yet")


def _to_page_out(page: Page, legacy_key: str | None = None) -> PageOut:
    normalized_title = normalize_page_title_for_legacy_key(page.title, legacy_key)
    return PageOut(
        id=page.id,
        title=normalized_title,
        icon=page.icon,
        cover=page.cover,
        legacy_key=legacy_key,
        created_at=page.created_at,
        updated_at=page.updated_at,
    )


@router.get("/pages", response_model=List[PageOut])
def list_pages_api(db: Session = Depends(get_db)) -> List[PageOut]:
    _ensure_canonical_ready(db)
    rows = list_pages(db)
    return [PageOut(**row) for row in rows]


@router.post("/pages", response_model=PageOut)
def create_page_api(payload: PageCreateIn, db: Session = Depends(get_db)) -> PageOut:
    _ensure_canonical_ready(db)
    page = create_page(db, title=payload.title, legacy_key=payload.legacy_key)
    db.commit()
    db.refresh(page)
    return _to_page_out(page, payload.legacy_key)


@router.patch("/pages/{page_id}", response_model=PageOut)
def update_page_api(page_id: str, payload: PageUpdateIn, db: Session = Depends(get_db)) -> PageOut:
    _ensure_canonical_ready(db)
    page = db.get(Page, page_id)
    if not page:
        raise HTTPException(status_code=404, detail="Page not found")

    patch = payload.model_dump(exclude_unset=True)
    if "title" in patch:
        title = str(patch["title"] or "").strip()
        page.title = title or page.title
    if "icon" in patch:
        page.icon = patch["icon"] or None
    if "cover" in patch:
        page.cover = patch["cover"] or None
    page.updated_at = datetime.utcnow()

    mapping = (
        db.query(MigrationMap)
        .filter(
            MigrationMap.new_table == "pages",
            MigrationMap.new_id == page.id,
            MigrationMap.legacy_table == "settings.page_configs",
        )
        .first()
    )
    legacy_key = mapping.legacy_id if mapping else None

    db.add(page)
    db.commit()
    db.refresh(page)
    return _to_page_out(page, legacy_key=legacy_key)


@router.get("/pages/resolve/{legacy_key}", response_model=PageResolveOut)
def resolve_page_api(
    legacy_key: str,
    create_if_missing: bool = Query(True),
    db: Session = Depends(get_db),
) -> PageResolveOut:
    _ensure_canonical_ready(db)
    page = find_page_by_legacy_key(db, legacy_key)
    if page:
        db.commit()
        db.refresh(page)
        return PageResolveOut(page=_to_page_out(page, legacy_key=legacy_key))

    page = resolve_page_by_legacy_key(db, legacy_key, create_if_missing=create_if_missing)
    if not page:
        raise HTTPException(status_code=404, detail="Page not found")

    db.commit()
    db.refresh(page)
    return PageResolveOut(page=_to_page_out(page, legacy_key=legacy_key))


@router.get("/pages/{page_id}/blocks", response_model=PageBlocksOut)
def get_page_blocks_api(page_id: str, db: Session = Depends(get_db)) -> PageBlocksOut:
    _ensure_canonical_ready(db)
    page = db.get(Page, page_id)
    if not page:
        raise HTTPException(status_code=404, detail="Page not found")
    blocks = list_page_blocks(db, page_id)
    return PageBlocksOut(page_id=page_id, blocks=blocks)


@router.put("/pages/{page_id}/blocks", response_model=PageBlocksOut)
def put_page_blocks_api(page_id: str, payload: PageBlocksIn, db: Session = Depends(get_db)) -> PageBlocksOut:
    _ensure_canonical_ready(db)
    if not db.get(Page, page_id):
        raise HTTPException(status_code=404, detail="Page not found")

    try:
        blocks = replace_page_blocks(db, page_id, [item.model_dump() for item in payload.blocks])
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    db.commit()
    return PageBlocksOut(page_id=page_id, blocks=blocks)


@router.get("/pages/by-legacy/{legacy_key}/blocks", response_model=PageBlocksOut)
def get_page_blocks_by_legacy_key_api(legacy_key: str, db: Session = Depends(get_db)) -> PageBlocksOut:
    _ensure_canonical_ready(db)
    page = resolve_page_by_legacy_key(db, legacy_key, create_if_missing=True)
    if not page:
        raise HTTPException(status_code=404, detail="Page not found")
    blocks = list_page_blocks(db, page.id)
    db.commit()
    return PageBlocksOut(page_id=page.id, blocks=blocks)


@router.delete("/pages/{page_id}")
def delete_page_api(page_id: str, db: Session = Depends(get_db)) -> Dict[str, Any]:
    _ensure_canonical_ready(db)
    page = db.get(Page, page_id)
    if not page:
        raise HTTPException(status_code=404, detail="Page not found")

    db.query(Block).filter(Block.page_id == page_id).delete(synchronize_session=False)
    db.query(Record).filter(Record.page_id == page_id).delete(synchronize_session=False)
    db.query(MigrationMap).filter(
        MigrationMap.new_table == "pages",
        MigrationMap.new_id == page_id,
    ).delete(synchronize_session=False)
    db.delete(page)
    db.commit()
    return {"deleted": True}
