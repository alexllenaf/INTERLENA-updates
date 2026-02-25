from __future__ import annotations

import json
import uuid
from datetime import date, datetime
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy import func, inspect
from sqlalchemy.orm import Session

from ..models import (
    Application,
    Block,
    Database,
    DatabaseProperty,
    DatabaseView,
    MetaKV,
    MigrationMap,
    Page,
    Record,
    RecordRelation,
    RecordProperty,
    Setting,
)

APPLICATIONS_DATABASE_NAME = "Applications"
MAPPING_LEGACY_APPLICATIONS = "applications"
MAPPING_LEGACY_PAGE_CONFIGS = "settings.page_configs"


def _utcnow() -> datetime:
    return datetime.utcnow()


def _json_dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False)


def _json_loads(value: str | None, default: Any) -> Any:
    if not value:
        return default
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError:
        return default
    return parsed


def _position_for_index(index: int) -> str:
    return f"{(index + 1) * 1024:012d}"


def _table_exists(session: Session, table_name: str) -> bool:
    bind = session.get_bind()
    if bind is None:
        return False
    return inspect(bind).has_table(table_name)


def canonical_schema_ready(session: Session) -> bool:
    required = {
        "pages",
        "blocks",
        "databases",
        "database_properties",
        "records",
        "record_properties",
        "record_relations",
        "database_views",
        "meta",
        "migration_map",
    }
    return all(_table_exists(session, name) for name in required)


def get_meta(session: Session, key: str, default: Optional[str] = None) -> Optional[str]:
    row = session.get(MetaKV, key)
    if not row:
        return default
    return row.value


def set_meta(session: Session, key: str, value: str) -> None:
    existing = session.get(MetaKV, key)
    if existing:
        existing.value = value
    else:
        session.add(MetaKV(key=key, value=value))


def get_meta_bool(session: Session, key: str, default: bool = False) -> bool:
    raw = get_meta(session, key)
    if raw is None:
        return default
    return str(raw).strip().lower() in {"1", "true", "yes", "on"}


def set_meta_bool(session: Session, key: str, value: bool) -> None:
    set_meta(session, key, "true" if value else "false")


def _mapping_get(
    session: Session,
    legacy_table: str,
    legacy_id: str,
    new_table: str,
) -> Optional[MigrationMap]:
    return (
        session.query(MigrationMap)
        .filter(
            MigrationMap.legacy_table == legacy_table,
            MigrationMap.legacy_id == legacy_id,
            MigrationMap.new_table == new_table,
        )
        .first()
    )


def _mapping_upsert(
    session: Session,
    legacy_table: str,
    legacy_id: str,
    new_table: str,
    new_id: str,
) -> None:
    existing = _mapping_get(session, legacy_table, legacy_id, new_table)
    if existing:
        existing.new_id = new_id
    else:
        session.add(
            MigrationMap(
                legacy_table=legacy_table,
                legacy_id=legacy_id,
                new_table=new_table,
                new_id=new_id,
            )
        )


def _parse_json_payload(raw: str | None) -> Dict[str, Any]:
    data = _json_loads(raw, {})
    return data if isinstance(data, dict) else {}


def _normalize_layout(raw: Any) -> Dict[str, Any]:
    if isinstance(raw, dict):
        raw_col_span = raw.get("colSpan")
        try:
            col_span = int(raw_col_span) if raw_col_span is not None else 1
        except (TypeError, ValueError):
            col_span = 1
        return {
            "colSpan": max(1, col_span),
            "colStart": raw.get("colStart"),
            "rowStart": raw.get("rowStart"),
        }
    return {"colSpan": 1}


def _normalize_props(raw: Any) -> Dict[str, Any]:
    if isinstance(raw, dict):
        return dict(raw)
    return {}


def _legacy_humanize_page_key(page_key: str) -> str:
    clean = (page_key or "").strip()
    if not clean:
        return "Untitled"
    text = clean.replace("_", " ").replace("-", " ").replace(":", " ")
    text = " ".join(part for part in text.split() if part)
    return text.title() if text else "Untitled"


def _humanize_page_key(page_key: str) -> str:
    clean = (page_key or "").strip()
    if not clean:
        return "Untitled"
    if clean.lower().startswith("sheet:"):
        return "New Sheet"
    return _legacy_humanize_page_key(clean)


def normalize_page_title_for_legacy_key(title: str | None, legacy_key: str | None) -> str:
    normalized_title = (title or "").strip() or "Untitled"
    clean_legacy_key = (legacy_key or "").strip()
    if not clean_legacy_key:
        return normalized_title

    legacy_generated = _legacy_humanize_page_key(clean_legacy_key)
    canonical_generated = _humanize_page_key(clean_legacy_key)
    if legacy_generated != canonical_generated and normalized_title == legacy_generated:
        return canonical_generated
    return normalized_title


def _application_property_type(column_name: str) -> str:
    lower = column_name.lower()
    if lower in {"id", "pipeline_order", "interview_rounds", "total_rounds"}:
        return "number"
    if lower in {"company_score", "my_interview_score"}:
        return "number"
    if lower in {"favorite"}:
        return "checkbox"
    if lower.endswith("_date") or lower.endswith("_datetime"):
        return "date"
    return "text"


def _application_columns() -> List[str]:
    columns = [col.name for col in Application.__table__.columns]
    return columns


def ensure_applications_database(session: Session) -> Tuple[Database, Dict[str, DatabaseProperty]]:
    existing = session.query(Database).filter(Database.name == APPLICATIONS_DATABASE_NAME).first()
    if existing is None:
        existing = Database(
            id=str(uuid.uuid4()),
            name=APPLICATIONS_DATABASE_NAME,
            created_at=_utcnow(),
            updated_at=_utcnow(),
        )
        session.add(existing)
        session.flush()

    by_name: Dict[str, DatabaseProperty] = {
        prop.name: prop
        for prop in session.query(DatabaseProperty)
        .filter(DatabaseProperty.database_id == existing.id)
        .order_by(DatabaseProperty.property_order.asc())
        .all()
    }

    for index, column_name in enumerate(_application_columns()):
        prop = by_name.get(column_name)
        if prop:
            continue
        prop = DatabaseProperty(
            id=str(uuid.uuid5(uuid.NAMESPACE_URL, f"applications.property.{column_name}")),
            database_id=existing.id,
            name=column_name,
            type=_application_property_type(column_name),
            config_json=_json_dumps({"legacy_column": column_name}),
            property_order=index,
        )
        session.add(prop)
        by_name[column_name] = prop

    existing.updated_at = _utcnow()
    session.flush()
    return existing, by_name


def _serialize_value(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, date):
        return datetime.combine(value, datetime.min.time()).isoformat()
    return value


def _application_page_title(app: Application) -> str:
    company = (app.company_name or "").strip()
    position = (app.position or "").strip()
    if company and position:
        return f"{company} - {position}"
    if company:
        return company
    if position:
        return position
    return f"Application {app.id}"


def _upsert_record_property(
    session: Session,
    record_id: str,
    property_id: str,
    value: Any,
) -> None:
    row = session.get(
        RecordProperty,
        {"record_id": record_id, "property_id": property_id},
    )
    payload = _json_dumps(_serialize_value(value))
    if row:
        row.value_json = payload
    else:
        session.add(
            RecordProperty(
                record_id=record_id,
                property_id=property_id,
                value_json=payload,
            )
        )


def upsert_application_record(session: Session, app: Application) -> str:
    database, properties_by_name = ensure_applications_database(session)

    map_row = _mapping_get(
        session,
        legacy_table=MAPPING_LEGACY_APPLICATIONS,
        legacy_id=str(app.id),
        new_table="records",
    )

    page: Optional[Page] = None
    record: Optional[Record] = None
    if map_row:
        record = session.get(Record, map_row.new_id)
        if record:
            page = session.get(Page, record.page_id)

    if page is None:
        page = Page(
            id=str(uuid.uuid4()),
            title=_application_page_title(app),
            icon="briefcase",
            cover=None,
            created_at=_utcnow(),
            updated_at=_utcnow(),
        )
        session.add(page)
        session.flush()

    if record is None:
        record = Record(
            id=str(uuid.uuid4()),
            database_id=database.id,
            page_id=page.id,
            created_at=_utcnow(),
            updated_at=_utcnow(),
        )
        session.add(record)
        session.flush()

    page.title = _application_page_title(app)
    page.updated_at = _utcnow()
    record.database_id = database.id
    record.page_id = page.id
    record.updated_at = _utcnow()

    for column_name in _application_columns():
        prop = properties_by_name.get(column_name)
        if not prop:
            continue
        _upsert_record_property(session, record.id, prop.id, getattr(app, column_name))

    _mapping_upsert(
        session,
        legacy_table=MAPPING_LEGACY_APPLICATIONS,
        legacy_id=str(app.id),
        new_table="records",
        new_id=record.id,
    )
    _mapping_upsert(
        session,
        legacy_table=MAPPING_LEGACY_APPLICATIONS,
        legacy_id=str(app.id),
        new_table="pages",
        new_id=page.id,
    )

    session.flush()
    return record.id


def migrate_applications_to_canonical(session: Session) -> Dict[str, int]:
    if not canonical_schema_ready(session):
        return {"applications": 0, "records": 0}

    apps = session.query(Application).order_by(Application.id.asc()).all()
    for app in apps:
        upsert_application_record(session, app)

    records_count = (
        session.query(func.count(Record.id))
        .join(Database, Database.id == Record.database_id)
        .filter(Database.name == APPLICATIONS_DATABASE_NAME)
        .scalar()
        or 0
    )
    return {"applications": len(apps), "records": int(records_count)}


def resolve_page_by_legacy_key(
    session: Session,
    legacy_key: str,
    *,
    create_if_missing: bool = True,
) -> Optional[Page]:
    mapping = _mapping_get(
        session,
        legacy_table=MAPPING_LEGACY_PAGE_CONFIGS,
        legacy_id=legacy_key,
        new_table="pages",
    )
    if mapping:
        page = session.get(Page, mapping.new_id)
        if page:
            normalized_title = normalize_page_title_for_legacy_key(page.title, legacy_key)
            if normalized_title != (page.title or ""):
                page.title = normalized_title
                page.updated_at = _utcnow()
                session.add(page)
                session.flush()
            return page

    if not create_if_missing:
        return None

    page = Page(
        id=str(uuid.uuid4()),
        title=_humanize_page_key(legacy_key),
        icon=None,
        cover=None,
        created_at=_utcnow(),
        updated_at=_utcnow(),
    )
    session.add(page)
    session.flush()
    _mapping_upsert(
        session,
        legacy_table=MAPPING_LEGACY_PAGE_CONFIGS,
        legacy_id=legacy_key,
        new_table="pages",
        new_id=page.id,
    )
    session.flush()
    return page


def _build_content_json(props: Dict[str, Any], explicit_content: Any = None) -> str:
    if explicit_content is not None:
        return _json_dumps(explicit_content)
    if "text" in props:
        return _json_dumps({"text": props.get("text")})
    return _json_dumps({})


def _extract_text_content(content_json: Any, props: Dict[str, Any]) -> Dict[str, Any]:
    if not isinstance(content_json, dict):
        return props
    if "text" in content_json and "text" not in props:
        next_props = dict(props)
        next_props["text"] = content_json.get("text")
        return next_props
    return props


def _validate_blocks_tree(blocks: List[Dict[str, Any]]) -> None:
    ids: List[str] = []
    parents: Dict[str, Optional[str]] = {}

    for index, block in enumerate(blocks):
        raw_id = block.get("id")
        block_id = str(raw_id).strip() if raw_id is not None else ""
        if not block_id:
            block_id = f"block:{index}"
            block["id"] = block_id
        if block_id in parents:
            raise ValueError(f"Duplicate block id: {block_id}")
        ids.append(block_id)

        raw_parent = block.get("parent_id")
        parent_id = str(raw_parent).strip() if isinstance(raw_parent, str) and raw_parent.strip() else None
        if parent_id == block_id:
            raise ValueError(f"Block {block_id} cannot be its own parent")
        parents[block_id] = parent_id

    id_set = set(ids)
    for block_id, parent_id in parents.items():
        if parent_id and parent_id not in id_set:
            raise ValueError(f"Block {block_id} references unknown parent {parent_id}")

    visiting: set[str] = set()
    visited: set[str] = set()

    def dfs(node_id: str) -> None:
        if node_id in visited:
            return
        if node_id in visiting:
            raise ValueError("Block tree contains a cycle")
        visiting.add(node_id)
        parent_id = parents.get(node_id)
        if parent_id:
            dfs(parent_id)
        visiting.remove(node_id)
        visited.add(node_id)

    for node in ids:
        dfs(node)


def replace_page_blocks(
    session: Session,
    page_id: str,
    blocks: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    page = session.get(Page, page_id)
    if not page:
        raise ValueError("Page not found")

    normalized_input = [dict(item) for item in (blocks or []) if isinstance(item, dict)]
    _validate_blocks_tree(normalized_input)

    session.query(Block).filter(Block.page_id == page_id).delete(synchronize_session=False)

    by_client_id: Dict[str, str] = {}
    for index, block in enumerate(normalized_input):
        client_id = str(block.get("id") or f"block:{index}").strip()
        by_client_id[client_id] = str(uuid.uuid4())

    for index, block in enumerate(normalized_input):
        client_id = str(block.get("id") or f"block:{index}").strip()
        parent_client_id = block.get("parent_id")
        if isinstance(parent_client_id, str) and parent_client_id.strip():
            parent_uuid = by_client_id.get(parent_client_id.strip())
        else:
            parent_uuid = None

        props = _normalize_props(block.get("props"))
        layout = _normalize_layout(block.get("layout"))
        explicit_content = block.get("content")

        session.add(
            Block(
                id=by_client_id[client_id],
                page_id=page_id,
                parent_id=parent_uuid,
                position=_position_for_index(index),
                type=str(block.get("type") or "text"),
                content_json=_build_content_json(props, explicit_content=explicit_content),
                props_json=_json_dumps(
                    {
                        "client_id": client_id,
                        "parent_client_id": parent_client_id if isinstance(parent_client_id, str) else None,
                        "layout": layout,
                        "props": props,
                    }
                ),
                created_at=_utcnow(),
                updated_at=_utcnow(),
            )
        )

    page.updated_at = _utcnow()
    session.flush()
    return list_page_blocks(session, page_id)


def list_page_blocks(session: Session, page_id: str) -> List[Dict[str, Any]]:
    rows = (
        session.query(Block)
        .filter(Block.page_id == page_id)
        .order_by(Block.position.asc(), Block.created_at.asc())
        .all()
    )

    out: List[Dict[str, Any]] = []
    for row in rows:
        props_payload = _parse_json_payload(row.props_json)
        props = _normalize_props(props_payload.get("props"))
        content = _json_loads(row.content_json, {})
        props = _extract_text_content(content, props)
        out.append(
            {
                "id": str(props_payload.get("client_id") or row.id),
                "type": row.type,
                "parent_id": props_payload.get("parent_client_id"),
                "position": row.position,
                "layout": _normalize_layout(props_payload.get("layout")),
                "props": props,
                "content": content,
            }
        )
    return out


def migrate_page_configs_to_canonical(session: Session) -> Dict[str, int]:
    if not canonical_schema_ready(session):
        return {"pages": 0, "blocks": 0}

    settings_entry = session.get(Setting, "settings")
    if not settings_entry:
        return {"pages": 0, "blocks": 0}

    settings_payload = _json_loads(settings_entry.value, {})
    if not isinstance(settings_payload, dict):
        return {"pages": 0, "blocks": 0}

    page_configs = settings_payload.get("page_configs")
    if not isinstance(page_configs, dict):
        return {"pages": 0, "blocks": 0}

    pages_count = 0
    blocks_count = 0

    for page_key, raw_cfg in page_configs.items():
        if not isinstance(page_key, str):
            continue
        cfg = raw_cfg if isinstance(raw_cfg, dict) else {}
        page = resolve_page_by_legacy_key(session, page_key, create_if_missing=True)
        if not page:
            continue

        page.title = _humanize_page_key(page_key)
        page.updated_at = _utcnow()

        raw_blocks = cfg.get("blocks") if isinstance(cfg, dict) else []
        normalized: List[Dict[str, Any]] = []
        if isinstance(raw_blocks, list):
            for index, raw_block in enumerate(raw_blocks):
                if not isinstance(raw_block, dict):
                    continue
                block_type = str(raw_block.get("type") or "text")
                props = _normalize_props(raw_block.get("props"))
                normalized.append(
                    {
                        "id": str(raw_block.get("id") or f"{block_type}:{index}"),
                        "type": block_type,
                        "parent_id": None,
                        "layout": _normalize_layout(raw_block.get("layout")),
                        "props": props,
                        "content": {"text": props.get("text")} if "text" in props else {},
                    }
                )

        persisted = replace_page_blocks(session, page.id, normalized)
        pages_count += 1
        blocks_count += len(persisted)

    return {"pages": pages_count, "blocks": blocks_count}


def list_pages(session: Session) -> List[Dict[str, Any]]:
    pages = session.query(Page).order_by(Page.updated_at.desc(), Page.created_at.desc()).all()
    mappings = (
        session.query(MigrationMap)
        .filter(
            MigrationMap.legacy_table == MAPPING_LEGACY_PAGE_CONFIGS,
            MigrationMap.new_table == "pages",
        )
        .all()
    )
    legacy_by_page_id = {item.new_id: item.legacy_id for item in mappings}

    out: List[Dict[str, Any]] = []
    for page in pages:
        legacy_key = legacy_by_page_id.get(page.id)
        out.append(
            {
                "id": page.id,
                "title": normalize_page_title_for_legacy_key(page.title, legacy_key),
                "icon": page.icon,
                "cover": page.cover,
                "legacy_key": legacy_key,
                "created_at": page.created_at,
                "updated_at": page.updated_at,
            }
        )
    return out


def create_page(session: Session, title: str, legacy_key: Optional[str] = None) -> Page:
    page = Page(
        id=str(uuid.uuid4()),
        title=(title or "Untitled").strip() or "Untitled",
        icon=None,
        cover=None,
        created_at=_utcnow(),
        updated_at=_utcnow(),
    )
    session.add(page)
    session.flush()

    if legacy_key and legacy_key.strip():
        _mapping_upsert(
            session,
            legacy_table=MAPPING_LEGACY_PAGE_CONFIGS,
            legacy_id=legacy_key.strip(),
            new_table="pages",
            new_id=page.id,
        )
        session.flush()
    return page


def find_page_by_legacy_key(session: Session, legacy_key: str) -> Optional[Page]:
    mapping = _mapping_get(
        session,
        legacy_table=MAPPING_LEGACY_PAGE_CONFIGS,
        legacy_id=legacy_key,
        new_table="pages",
    )
    if not mapping:
        return None
    page = session.get(Page, mapping.new_id)
    if not page:
        return None
    normalized_title = normalize_page_title_for_legacy_key(page.title, legacy_key)
    if normalized_title != (page.title or ""):
        page.title = normalized_title
        page.updated_at = _utcnow()
        session.add(page)
        session.flush()
    return page


def list_database_records(
    session: Session,
    database_id: str,
    *,
    view_id: Optional[str] = None,
) -> Dict[str, Any]:
    database = session.get(Database, database_id)
    if not database:
        raise ValueError("Database not found")

    view: Optional[DatabaseView] = None
    if view_id:
        view = session.get(DatabaseView, view_id)
        if not view or view.database_id != database_id:
            raise ValueError("View not found")

    properties = (
        session.query(DatabaseProperty)
        .filter(DatabaseProperty.database_id == database_id)
        .order_by(DatabaseProperty.property_order.asc(), DatabaseProperty.name.asc())
        .all()
    )
    prop_map = {prop.id: prop for prop in properties}

    records = (
        session.query(Record)
        .filter(Record.database_id == database_id)
        .order_by(Record.updated_at.desc(), Record.created_at.desc())
        .all()
    )
    record_ids = [record.id for record in records]

    record_props = (
        session.query(RecordProperty)
        .filter(RecordProperty.record_id.in_(record_ids))
        .all()
        if record_ids
        else []
    )

    values_by_record: Dict[str, Dict[str, Any]] = {}
    for row in record_props:
        prop = prop_map.get(row.property_id)
        if not prop:
            continue
        values_by_record.setdefault(row.record_id, {})[prop.name] = _json_loads(row.value_json, None)

    out_records: List[Dict[str, Any]] = []
    for record in records:
        out_records.append(_serialize_record(session, record, values_by_record.get(record.id, {})))

    return {
        "database": {
            "id": database.id,
            "name": database.name,
            "created_at": database.created_at,
            "updated_at": database.updated_at,
        },
        "view": {
            "id": view.id,
            "name": view.name,
            "type": view.type,
            "config": _json_loads(view.config_json, {}),
        }
        if view
        else None,
        "properties": [
            {
                "id": prop.id,
                "name": prop.name,
                "type": prop.type,
                "config": _json_loads(prop.config_json, {}),
                "property_order": prop.property_order,
            }
            for prop in properties
        ],
        "records": out_records,
    }


def mark_onboarding_completed_if_legacy_data_exists(session: Session) -> None:
    apps_count = session.query(func.count(Application.id)).scalar() or 0
    has_page_config_mapping = (
        session.query(func.count(MigrationMap.legacy_id))
        .filter(
            MigrationMap.legacy_table == MAPPING_LEGACY_PAGE_CONFIGS,
            MigrationMap.new_table == "pages",
        )
        .scalar()
        or 0
    )
    if apps_count > 0 or has_page_config_mapping > 0:
        set_meta_bool(session, "onboarding_completed", True)


def _serialize_record(
    session: Session,
    record: Record,
    properties: Dict[str, Any],
) -> Dict[str, Any]:
    page = session.get(Page, record.page_id)
    return {
        "id": record.id,
        "database_id": record.database_id,
        "page_id": record.page_id,
        "page_title": page.title if page else None,
        "created_at": record.created_at,
        "updated_at": record.updated_at,
        "properties": properties,
    }


def find_database_by_name(session: Session, name: str) -> Optional[Database]:
    normalized = (name or "").strip()
    if not normalized:
        return None
    return (
        session.query(Database)
        .filter(func.lower(Database.name) == normalized.lower())
        .order_by(Database.created_at.asc())
        .first()
    )


def get_database_detail(session: Session, database_id: str) -> Dict[str, Any]:
    database = session.get(Database, database_id)
    if not database:
        raise ValueError("Database not found")

    properties = (
        session.query(DatabaseProperty)
        .filter(DatabaseProperty.database_id == database_id)
        .order_by(DatabaseProperty.property_order.asc(), DatabaseProperty.name.asc())
        .all()
    )
    views = (
        session.query(DatabaseView)
        .filter(DatabaseView.database_id == database_id)
        .order_by(DatabaseView.created_at.asc(), DatabaseView.name.asc())
        .all()
    )

    return {
        "database": {
            "id": database.id,
            "name": database.name,
            "created_at": database.created_at,
            "updated_at": database.updated_at,
        },
        "properties": [
            {
                "id": prop.id,
                "name": prop.name,
                "type": prop.type,
                "config": _json_loads(prop.config_json, {}),
                "property_order": prop.property_order,
            }
            for prop in properties
        ],
        "views": [
            {
                "id": view.id,
                "database_id": view.database_id,
                "name": view.name,
                "type": view.type,
                "config": _json_loads(view.config_json, {}),
                "created_at": view.created_at,
                "updated_at": view.updated_at,
            }
            for view in views
        ],
    }


def _database_properties_by_name(
    session: Session,
    database_id: str,
) -> Dict[str, DatabaseProperty]:
    rows = (
        session.query(DatabaseProperty)
        .filter(DatabaseProperty.database_id == database_id)
        .order_by(DatabaseProperty.property_order.asc(), DatabaseProperty.name.asc())
        .all()
    )
    return {row.name: row for row in rows}


def _record_values_by_property_name(
    session: Session,
    record_id: str,
    property_by_id: Dict[str, DatabaseProperty],
) -> Dict[str, Any]:
    rows = (
        session.query(RecordProperty)
        .filter(RecordProperty.record_id == record_id)
        .all()
    )
    values: Dict[str, Any] = {}
    for row in rows:
        prop = property_by_id.get(row.property_id)
        if not prop:
            continue
        values[prop.name] = _json_loads(row.value_json, None)
    return values


def _set_record_values(
    session: Session,
    record_id: str,
    property_by_name: Dict[str, DatabaseProperty],
    values: Dict[str, Any],
) -> None:
    for key, raw_value in values.items():
        prop = property_by_name.get(key)
        if not prop:
            continue
        _upsert_record_property(session, record_id, prop.id, raw_value)


def _apply_page_patch(
    page: Page,
    page_patch: Optional[Dict[str, Any]],
    fallback_title: Optional[str] = None,
) -> None:
    next_patch = page_patch if isinstance(page_patch, dict) else {}
    if "title" in next_patch:
        title = str(next_patch.get("title") or "").strip()
        if title:
            page.title = title
    elif fallback_title and not (page.title or "").strip():
        page.title = fallback_title

    if "icon" in next_patch:
        raw_icon = next_patch.get("icon")
        page.icon = str(raw_icon).strip() or None if isinstance(raw_icon, str) else None

    if "cover" in next_patch:
        raw_cover = next_patch.get("cover")
        page.cover = str(raw_cover).strip() or None if isinstance(raw_cover, str) else None

    page.updated_at = _utcnow()


def create_database_record(
    session: Session,
    database_id: str,
    *,
    values: Optional[Dict[str, Any]] = None,
    page_patch: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    database = session.get(Database, database_id)
    if not database:
        raise ValueError("Database not found")

    values_dict = values if isinstance(values, dict) else {}
    property_by_name = _database_properties_by_name(session, database_id)
    fallback_title = str(values_dict.get("company_name") or values_dict.get("title") or "").strip() or "Untitled"

    page = Page(
        id=str(uuid.uuid4()),
        title=fallback_title,
        icon=None,
        cover=None,
        created_at=_utcnow(),
        updated_at=_utcnow(),
    )
    _apply_page_patch(page, page_patch, fallback_title=fallback_title)
    session.add(page)
    session.flush()

    record = Record(
        id=str(uuid.uuid4()),
        database_id=database_id,
        page_id=page.id,
        created_at=_utcnow(),
        updated_at=_utcnow(),
    )
    session.add(record)
    session.flush()

    _set_record_values(session, record.id, property_by_name, values_dict)
    record.updated_at = _utcnow()
    database.updated_at = _utcnow()
    session.flush()

    property_by_id = {prop.id: prop for prop in property_by_name.values()}
    serialized_values = _record_values_by_property_name(session, record.id, property_by_id)
    return _serialize_record(session, record, serialized_values)


def update_database_record(
    session: Session,
    database_id: str,
    record_id: str,
    *,
    values: Optional[Dict[str, Any]] = None,
    page_patch: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    database = session.get(Database, database_id)
    if not database:
        raise ValueError("Database not found")

    record = session.get(Record, record_id)
    if not record or record.database_id != database_id:
        raise ValueError("Record not found")

    values_dict = values if isinstance(values, dict) else {}
    property_by_name = _database_properties_by_name(session, database_id)
    property_by_id = {prop.id: prop for prop in property_by_name.values()}

    if values_dict:
        _set_record_values(session, record.id, property_by_name, values_dict)

    if page_patch:
        page = session.get(Page, record.page_id)
        if page:
            fallback_title = str(values_dict.get("company_name") or values_dict.get("title") or "").strip() or None
            _apply_page_patch(page, page_patch, fallback_title=fallback_title)

    record.updated_at = _utcnow()
    database.updated_at = _utcnow()
    session.flush()

    serialized_values = _record_values_by_property_name(session, record.id, property_by_id)
    return _serialize_record(session, record, serialized_values)


def delete_database_record(
    session: Session,
    database_id: str,
    record_id: str,
) -> None:
    record = session.get(Record, record_id)
    if not record or record.database_id != database_id:
        raise ValueError("Record not found")

    page_id = record.page_id
    session.query(RecordRelation).filter(
        (RecordRelation.from_record_id == record_id) | (RecordRelation.to_record_id == record_id)
    ).delete(synchronize_session=False)
    session.query(RecordProperty).filter(RecordProperty.record_id == record_id).delete(synchronize_session=False)
    session.query(MigrationMap).filter(
        MigrationMap.new_table == "records",
        MigrationMap.new_id == record_id,
    ).delete(synchronize_session=False)
    session.delete(record)

    if page_id:
        page_record_count = (
            session.query(func.count(Record.id))
            .filter(Record.page_id == page_id, Record.id != record_id)
            .scalar()
            or 0
        )
        if page_record_count == 0:
            session.query(Block).filter(Block.page_id == page_id).delete(synchronize_session=False)
            session.query(MigrationMap).filter(
                MigrationMap.new_table == "pages",
                MigrationMap.new_id == page_id,
            ).delete(synchronize_session=False)
            page = session.get(Page, page_id)
            if page:
                session.delete(page)

    database = session.get(Database, database_id)
    if database:
        database.updated_at = _utcnow()

    session.flush()
