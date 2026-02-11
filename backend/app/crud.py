from __future__ import annotations

import json
import uuid
from datetime import datetime
from typing import Any, Dict, Iterable, List, Optional

from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from .models import Application, View
from .settings_store import get_settings
from .utils import (
    apply_business_rules,
    list_to_json,
    parse_json_list,
    parse_properties_json,
    properties_to_json,
    validate_row,
)


def list_applications(
    db: Session,
    search: Optional[str] = None,
    outcomes: Optional[List[str]] = None,
    stages: Optional[List[str]] = None,
    job_types: Optional[List[str]] = None,
    favorites_only: bool = False,
) -> List[Application]:
    query = db.query(Application)
    if search:
        like = f"%{search}%"
        query = query.filter(
            or_(
                Application.company_name.ilike(like),
                Application.position.ilike(like),
                Application.location.ilike(like),
                Application.notes.ilike(like),
            )
        )
    if outcomes:
        query = query.filter(Application.outcome.in_(outcomes))
    if stages:
        query = query.filter(Application.stage.in_(stages))
    if job_types:
        query = query.filter(Application.job_type.in_(job_types))
    if favorites_only:
        query = query.filter(Application.favorite.is_(True))
    return query.order_by(Application.updated_at.desc(), Application.id.desc()).all()


def _stage_is_ordered(db: Session, stage: str) -> bool:
    total = db.query(func.count(Application.id)).filter(Application.stage == stage).scalar() or 0
    if total == 0:
        return True
    ordered = (
        db.query(func.count(Application.id))
        .filter(Application.stage == stage, Application.pipeline_order.is_not(None))
        .scalar()
        or 0
    )
    return ordered == total


def _next_pipeline_order(db: Session, stage: str) -> Optional[int]:
    if not _stage_is_ordered(db, stage):
        return None
    max_order = (
        db.query(func.max(Application.pipeline_order))
        .filter(Application.stage == stage)
        .scalar()
    )
    if max_order is None:
        return 0
    return int(max_order) + 1


def get_application(db: Session, app_id: int) -> Optional[Application]:
    return db.get(Application, app_id)


def create_application(db: Session, payload: Dict[str, Any]) -> Application:
    settings = get_settings(db)
    stages = settings.get("stages", [])

    errors = validate_row(payload)
    if errors:
        raise ValueError("; ".join(errors))

    payload = apply_business_rules(payload, None, stages)
    app_id = payload.get("application_id") or str(uuid.uuid4())
    created_by = payload.get("created_by") or "local"
    props = payload.get("properties") or {}
    pipeline_order = payload.get("pipeline_order")
    if pipeline_order is None and payload.get("stage"):
        pipeline_order = _next_pipeline_order(db, payload.get("stage"))

    app = Application(
        application_id=app_id,
        company_name=payload.get("company_name"),
        position=payload.get("position"),
        job_type=payload.get("job_type"),
        stage=payload.get("stage"),
        outcome=payload.get("outcome"),
        pipeline_order=pipeline_order,
        location=payload.get("location"),
        application_date=payload.get("application_date"),
        interview_datetime=payload.get("interview_datetime"),
        followup_date=payload.get("followup_date"),
        interview_rounds=payload.get("interview_rounds"),
        interview_type=payload.get("interview_type"),
        interviewers=payload.get("interviewers"),
        company_score=payload.get("company_score"),
        last_round_cleared=payload.get("last_round_cleared"),
        total_rounds=payload.get("total_rounds"),
        my_interview_score=payload.get("my_interview_score"),
        improvement_areas=payload.get("improvement_areas"),
        skill_to_upgrade=payload.get("skill_to_upgrade"),
        job_description=payload.get("job_description"),
        notes=payload.get("notes"),
        todo_items=list_to_json(payload.get("todo_items") or []),
        documents_links=payload.get("documents_links"),
        documents_files=list_to_json(payload.get("documents_files") or []),
        contacts=list_to_json(payload.get("contacts") or []),
        favorite=bool(payload.get("favorite")),
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
        created_by=created_by,
        properties_json=properties_to_json(props),
    )
    db.add(app)
    db.commit()
    db.refresh(app)
    return app


def update_application(db: Session, app: Application, payload: Dict[str, Any]) -> Application:
    settings = get_settings(db)
    stages = settings.get("stages", [])

    current = application_to_dict(app)
    merged = {**current, **payload}
    errors = validate_row(merged)
    if errors:
        raise ValueError("; ".join(errors))

    merged = apply_business_rules(merged, current, stages)
    if "pipeline_order" not in payload and merged.get("stage") != current.get("stage"):
        if merged.get("stage"):
            merged["pipeline_order"] = _next_pipeline_order(db, merged.get("stage"))
        else:
            merged["pipeline_order"] = None
    if "documents_files" in merged:
        merged["documents_files"] = list_to_json(merged.get("documents_files") or [])
    if "contacts" in merged:
        merged["contacts"] = list_to_json(merged.get("contacts") or [])
    if "todo_items" in merged:
        merged["todo_items"] = list_to_json(merged.get("todo_items") or [])
    for key, value in merged.items():
        if key in {"id", "application_id", "created_at", "created_by", "updated_at", "last_viewed", "properties"}:
            continue
        if hasattr(app, key):
            setattr(app, key, value)
    if "properties" in merged:
        app.properties_json = properties_to_json(merged.get("properties") or {})
    app.updated_at = datetime.utcnow()
    db.add(app)
    db.commit()
    db.refresh(app)
    return app


def delete_applications(db: Session, ids: Iterable[int]) -> int:
    ids = list(ids)
    if not ids:
        return 0
    deleted = db.query(Application).filter(Application.id.in_(ids)).delete(synchronize_session=False)
    db.commit()
    return deleted


def touch_last_viewed(db: Session, application_id: str) -> None:
    app = db.query(Application).filter(Application.application_id == application_id).first()
    if not app:
        return
    app.last_viewed = datetime.utcnow()
    db.add(app)
    db.commit()


def list_views(db: Session) -> List[View]:
    return db.query(View).order_by(View.created_at.asc(), View.name.asc()).all()


def get_view(db: Session, view_id: str) -> Optional[View]:
    return db.get(View, view_id)


def create_view(db: Session, name: str, view_type: str, config: Dict[str, Any]) -> View:
    view = View(
        view_id=str(uuid.uuid4()),
        name=name,
        view_type=view_type,
        config=json.dumps(config),
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )
    db.add(view)
    db.commit()
    db.refresh(view)
    return view


def update_view(db: Session, view: View, payload: Dict[str, Any]) -> View:
    if payload.get("name") is not None:
        view.name = payload["name"]
    if payload.get("view_type") is not None:
        view.view_type = payload["view_type"]
    if payload.get("config") is not None:
        view.config = json.dumps(payload["config"])
    view.updated_at = datetime.utcnow()
    db.add(view)
    db.commit()
    db.refresh(view)
    return view


def delete_view(db: Session, view: View) -> None:
    db.delete(view)
    db.commit()


def application_to_dict(app: Application) -> Dict[str, Any]:
    return {
        "id": app.id,
        "application_id": app.application_id,
        "company_name": app.company_name,
        "position": app.position,
        "job_type": app.job_type,
        "stage": app.stage,
        "outcome": app.outcome,
        "pipeline_order": app.pipeline_order,
        "location": app.location,
        "application_date": app.application_date,
        "interview_datetime": app.interview_datetime,
        "followup_date": app.followup_date,
        "interview_rounds": app.interview_rounds,
        "interview_type": app.interview_type,
        "interviewers": app.interviewers,
        "company_score": app.company_score,
        "last_round_cleared": app.last_round_cleared,
        "total_rounds": app.total_rounds,
        "my_interview_score": app.my_interview_score,
        "improvement_areas": app.improvement_areas,
        "skill_to_upgrade": app.skill_to_upgrade,
        "job_description": app.job_description,
        "notes": app.notes,
        "todo_items": parse_json_list(app.todo_items),
        "documents_links": app.documents_links,
        "documents_files": parse_json_list(app.documents_files),
        "contacts": parse_json_list(app.contacts),
        "favorite": bool(app.favorite),
        "created_at": app.created_at,
        "updated_at": app.updated_at,
        "last_viewed": app.last_viewed,
        "created_by": app.created_by,
        "properties": parse_properties_json(app.properties_json),
    }
