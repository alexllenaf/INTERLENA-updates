from __future__ import annotations

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from ..crud import application_to_dict, get_application, list_applications
from ..db import get_db
from ..services.exports import build_excel_bytes, build_ics_bytes
from ..settings_store import get_settings as load_settings
from ..utils import build_ics, parse_date

router = APIRouter(prefix="/api")


@router.get("/export/ics")
def export_ics(
    application_id: Optional[str] = None, db: Session = Depends(get_db)
) -> StreamingResponse:
    apps = list_applications(db)
    if application_id:
        apps = [a for a in apps if a.application_id == application_id]
    content = build_ics_bytes(apps)
    filename = "events.ics" if not application_id else f"{application_id}.ics"
    return StreamingResponse(
        iter([content]),
        media_type="text/calendar",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


@router.get("/export/excel")
def export_excel(scope: str = "all", db: Session = Depends(get_db)) -> StreamingResponse:
    apps = list_applications(db)
    if scope == "favorites":
        apps = [a for a in apps if a.favorite]
    elif scope == "active":
        apps = [a for a in apps if a.outcome == "In Progress"]

    settings = load_settings(db)
    data = build_excel_bytes(apps, settings)

    filename = f"applications_{scope}.xlsx"
    return StreamingResponse(
        iter([data]),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


@router.get("/export/todo")
def export_todo(
    app_id: int = Query(..., alias="app_id"),
    todo_id: str = Query(..., alias="todo_id"),
    db: Session = Depends(get_db),
) -> StreamingResponse:
    app = get_application(db, app_id)
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")
    app_data = application_to_dict(app)
    todo_items = app_data.get("todo_items") or []
    todo = next((item for item in todo_items if item.get("id") == todo_id), None)
    if not todo:
        raise HTTPException(status_code=404, detail="Todo not found")
    due_date = parse_date(todo.get("due_date"))
    if not due_date:
        raise HTTPException(status_code=400, detail="Todo has no due date")
    task = todo.get("task") or "To-Do"
    notes_bits = []
    if todo.get("task_location"):
        notes_bits.append(f"Location: {todo.get('task_location')}")
    if todo.get("notes"):
        notes_bits.append(str(todo.get("notes")))
    if todo.get("documents_links"):
        notes_bits.append(f"Links: {todo.get('documents_links')}")
    description = "\n".join(notes_bits) if notes_bits else None
    event = {
        "uid": str(todo_id),
        "summary": f"To-Do - {app_data.get('company_name')} - {task}",
        "description": description,
        "start": datetime.combine(due_date, datetime.min.time()),
        "all_day": True,
    }
    content = build_ics([event])
    filename = f"todo_{todo_id}.ics"
    return StreamingResponse(
        iter([content]),
        media_type="text/calendar",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )
