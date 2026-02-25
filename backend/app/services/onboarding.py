from __future__ import annotations

import json
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from ..models import Database, DatabaseProperty, DatabaseView, Page, Record, RecordProperty
from .canonical import get_meta, get_meta_bool, replace_page_blocks, set_meta, set_meta_bool

TEMPLATES_DIR = Path(__file__).resolve().parents[1] / "seeds" / "templates"


def _utcnow() -> datetime:
    return datetime.utcnow()


def _json_load(path: Path) -> Dict[str, Any]:
    data = json.loads(path.read_text(encoding="utf-8"))
    return data if isinstance(data, dict) else {}


def _stable_id(template_id: str, kind: str, raw_id: str) -> str:
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"seed:{template_id}:{kind}:{raw_id}"))


def _normalize_template_payload(payload: Dict[str, Any], template_id: str) -> Dict[str, Any]:
    normalized = dict(payload)
    normalized.setdefault("id", template_id)
    normalized.setdefault("version", template_id)
    normalized.setdefault("name", template_id)
    normalized.setdefault("description", "")
    normalized.setdefault("home_page", "home")
    normalized.setdefault("pages", [])
    normalized.setdefault("databases", [])
    return normalized


def list_templates() -> List[Dict[str, str]]:
    if not TEMPLATES_DIR.exists():
        return []

    rows: List[Dict[str, str]] = []
    for path in sorted(TEMPLATES_DIR.glob("*.json")):
        try:
            payload = _json_load(path)
        except Exception:
            continue
        template_id = str(payload.get("id") or path.stem)
        rows.append(
            {
                "id": template_id,
                "name": str(payload.get("name") or template_id),
                "description": str(payload.get("description") or ""),
                "version": str(payload.get("version") or template_id),
            }
        )
    return rows


def load_template(template_id: str) -> Dict[str, Any]:
    candidates = [
        TEMPLATES_DIR / f"{template_id}.json",
        TEMPLATES_DIR / f"{template_id.strip().lower()}.json",
    ]
    for path in candidates:
        if path.exists():
            return _normalize_template_payload(_json_load(path), template_id)

    for path in TEMPLATES_DIR.glob("*.json"):
        payload = _json_load(path)
        if str(payload.get("id") or "").strip() == template_id:
            return _normalize_template_payload(payload, template_id)

    raise ValueError(f"Template not found: {template_id}")


def _upsert_page(
    session: Session,
    template_id: str,
    page_payload: Dict[str, Any],
    workspace_name: Optional[str],
    *,
    is_home: bool,
) -> Page:
    source_id = str(page_payload.get("id") or "page")
    page_id = _stable_id(template_id, "page", source_id)
    page = session.get(Page, page_id)
    if page is None:
        page = Page(
            id=page_id,
            title="Untitled",
            icon=None,
            cover=None,
            created_at=_utcnow(),
            updated_at=_utcnow(),
        )
        session.add(page)

    title = str(page_payload.get("title") or "Untitled").strip() or "Untitled"
    if is_home and workspace_name and workspace_name.strip():
        title = workspace_name.strip()

    page.title = title
    page.icon = str(page_payload.get("icon") or "").strip() or None
    page.cover = str(page_payload.get("cover") or "").strip() or None
    page.updated_at = _utcnow()
    session.flush()
    return page


def _upsert_database(session: Session, template_id: str, payload: Dict[str, Any]) -> Database:
    source_id = str(payload.get("id") or payload.get("name") or "database")
    db_id = _stable_id(template_id, "database", source_id)
    row = session.get(Database, db_id)
    if row is None:
        row = Database(
            id=db_id,
            name="Untitled",
            created_at=_utcnow(),
            updated_at=_utcnow(),
        )
        session.add(row)
    row.name = str(payload.get("name") or "Untitled")
    row.updated_at = _utcnow()
    session.flush()
    return row


def _upsert_database_properties(
    session: Session,
    template_id: str,
    database: Database,
    properties: List[Dict[str, Any]],
) -> Dict[str, DatabaseProperty]:
    prop_by_name: Dict[str, DatabaseProperty] = {}
    for index, prop_payload in enumerate(properties):
        source_id = str(prop_payload.get("id") or prop_payload.get("name") or f"prop-{index}")
        prop_id = _stable_id(template_id, f"database_property:{database.id}", source_id)
        prop = session.get(DatabaseProperty, prop_id)
        if prop is None:
            prop = DatabaseProperty(
                id=prop_id,
                database_id=database.id,
                name="",
                type="text",
                config_json="{}",
                property_order=index,
            )
            session.add(prop)

        prop.database_id = database.id
        prop.name = str(prop_payload.get("name") or source_id)
        prop.type = str(prop_payload.get("type") or "text")
        config = prop_payload.get("config") if isinstance(prop_payload.get("config"), dict) else {}
        prop.config_json = json.dumps(config, ensure_ascii=False)
        prop.property_order = index
        prop_by_name[prop.name] = prop

    session.flush()
    return prop_by_name


def _upsert_database_views(
    session: Session,
    template_id: str,
    database: Database,
    views: List[Dict[str, Any]],
) -> None:
    for index, view_payload in enumerate(views):
        source_id = str(view_payload.get("id") or view_payload.get("name") or f"view-{index}")
        view_id = _stable_id(template_id, f"database_view:{database.id}", source_id)
        row = session.get(DatabaseView, view_id)
        if row is None:
            row = DatabaseView(
                id=view_id,
                database_id=database.id,
                name="",
                type="table",
                config_json="{}",
                created_at=_utcnow(),
                updated_at=_utcnow(),
            )
            session.add(row)

        row.database_id = database.id
        row.name = str(view_payload.get("name") or source_id)
        row.type = str(view_payload.get("type") or "table")
        config = view_payload.get("config") if isinstance(view_payload.get("config"), dict) else {}
        row.config_json = json.dumps(config, ensure_ascii=False)
        row.updated_at = _utcnow()

    session.flush()


def _upsert_record(
    session: Session,
    template_id: str,
    database: Database,
    record_payload: Dict[str, Any],
    page_id_by_source: Dict[str, str],
) -> Record:
    source_id = str(record_payload.get("id") or uuid.uuid4())
    record_id = _stable_id(template_id, f"record:{database.id}", source_id)
    row = session.get(Record, record_id)

    page_ref = record_payload.get("page") if isinstance(record_payload.get("page"), dict) else None
    page_source_id = str(page_ref.get("id") or f"record-page:{source_id}") if page_ref else f"record-page:{source_id}"
    target_page_id = page_id_by_source.get(page_source_id)
    if target_page_id is None:
        page_title = str(page_ref.get("title") or source_id) if page_ref else source_id
        page = _upsert_page(
            session,
            template_id,
            {
                "id": page_source_id,
                "title": page_title,
                "icon": None,
                "cover": None,
            },
            workspace_name=None,
            is_home=False,
        )
        target_page_id = page.id
        page_id_by_source[page_source_id] = page.id

    if row is None:
        row = Record(
            id=record_id,
            database_id=database.id,
            page_id=target_page_id,
            created_at=_utcnow(),
            updated_at=_utcnow(),
        )
        session.add(row)

    row.database_id = database.id
    row.page_id = target_page_id
    row.updated_at = _utcnow()
    session.flush()
    return row


def _upsert_record_properties(
    session: Session,
    record: Record,
    property_by_name: Dict[str, DatabaseProperty],
    values: Dict[str, Any],
) -> None:
    for key, raw_value in values.items():
        prop = property_by_name.get(key)
        if not prop:
            continue
        row = session.get(
            RecordProperty,
            {"record_id": record.id, "property_id": prop.id},
        )
        payload = json.dumps(raw_value, ensure_ascii=False)
        if row is None:
            row = RecordProperty(record_id=record.id, property_id=prop.id, value_json=payload)
            session.add(row)
        else:
            row.value_json = payload


def seed_from_template(
    session: Session,
    template_id: str,
    workspace_name: Optional[str] = None,
) -> Dict[str, str]:
    template = load_template(template_id)
    seed_version = str(template.get("version") or template_id)
    existing_template_id = get_meta(session, "seed_template_id")
    existing_home_page_id = get_meta(session, "seed_home_page_id")
    existing_seed_version = get_meta(session, "seed_version")
    if (
        get_meta_bool(session, "onboarding_completed", default=False)
        and existing_template_id == template_id
        and existing_home_page_id
    ):
        return {
            "home_page_id": existing_home_page_id,
            "seed_version": existing_seed_version or seed_version,
        }

    page_id_by_source: Dict[str, str] = {}
    home_source = str(template.get("home_page") or "home")

    pages = template.get("pages") if isinstance(template.get("pages"), list) else []
    for page_payload in pages:
        if not isinstance(page_payload, dict):
            continue
        source_id = str(page_payload.get("id") or "page")
        page = _upsert_page(
            session,
            template_id,
            page_payload,
            workspace_name=workspace_name,
            is_home=(source_id == home_source),
        )
        page_id_by_source[source_id] = page.id

        raw_blocks = page_payload.get("blocks") if isinstance(page_payload.get("blocks"), list) else []
        blocks = [item for item in raw_blocks if isinstance(item, dict)]
        replace_page_blocks(session, page.id, blocks)

    databases = template.get("databases") if isinstance(template.get("databases"), list) else []
    for db_payload in databases:
        if not isinstance(db_payload, dict):
            continue
        database = _upsert_database(session, template_id, db_payload)

        properties = db_payload.get("properties") if isinstance(db_payload.get("properties"), list) else []
        prop_by_name = _upsert_database_properties(session, template_id, database, [p for p in properties if isinstance(p, dict)])

        views = db_payload.get("views") if isinstance(db_payload.get("views"), list) else []
        _upsert_database_views(session, template_id, database, [v for v in views if isinstance(v, dict)])

        records = db_payload.get("records") if isinstance(db_payload.get("records"), list) else []
        for record_payload in records:
            if not isinstance(record_payload, dict):
                continue
            record = _upsert_record(session, template_id, database, record_payload, page_id_by_source)
            values = record_payload.get("values") if isinstance(record_payload.get("values"), dict) else {}
            _upsert_record_properties(session, record, prop_by_name, values)

    home_page_id = page_id_by_source.get(home_source)
    if not home_page_id:
        fallback_page = _upsert_page(
            session,
            template_id,
            {"id": home_source, "title": workspace_name or "Home", "icon": "house"},
            workspace_name=workspace_name,
            is_home=True,
        )
        home_page_id = fallback_page.id

    set_meta_bool(session, "onboarding_completed", True)
    set_meta(session, "seed_version", seed_version)
    set_meta(session, "seed_template_id", template_id)
    set_meta(session, "seed_home_page_id", home_page_id)
    set_meta(session, "seed_completed_at", _utcnow().isoformat())

    return {
        "home_page_id": home_page_id,
        "seed_version": seed_version,
    }
