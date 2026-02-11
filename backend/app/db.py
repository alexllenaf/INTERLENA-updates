from __future__ import annotations

import uuid
from datetime import datetime
from typing import Iterable

from pathlib import Path

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.engine.url import make_url
from sqlalchemy.engine import Engine
from sqlalchemy.orm import sessionmaker

from .config import get_settings
from .models import Application, Base, Setting, View

settings = get_settings()


def _is_sqlite(url: str) -> bool:
    return url.startswith("sqlite")


engine = create_engine(
    settings.database_url,
    connect_args={"check_same_thread": False} if _is_sqlite(settings.database_url) else {},
)

if _is_sqlite(settings.database_url):
    url = make_url(settings.database_url)
    if url.database and url.database != ":memory:":
        Path(url.database).parent.mkdir(parents=True, exist_ok=True)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _ensure_columns(engine: Engine, table_name: str, columns: Iterable) -> None:
    inspector = inspect(engine)
    existing = {col["name"] for col in inspector.get_columns(table_name)}
    if not existing:
        return
    with engine.begin() as conn:
        for col in columns:
            if col.name in existing:
                continue
            col_type = col.type.compile(dialect=engine.dialect)
            conn.execute(text(f"ALTER TABLE {table_name} ADD COLUMN {col.name} {col_type}"))


def _ensure_indexes(engine: Engine) -> None:
    with engine.begin() as conn:
        conn.execute(
            text(
                "CREATE UNIQUE INDEX IF NOT EXISTS idx_applications_application_id "
                "ON applications(application_id)"
            )
        )


def _backfill_application_ids(engine: Engine) -> None:
    with engine.begin() as conn:
        rows = conn.execute(
            text("SELECT id FROM applications WHERE application_id IS NULL OR application_id = ''")
        ).mappings().all()
        for row in rows:
            conn.execute(
                text("UPDATE applications SET application_id = :app_id WHERE id = :id"),
                {"app_id": str(uuid.uuid4()), "id": row["id"]},
            )


def _backfill_defaults(engine: Engine) -> None:
    with engine.begin() as conn:
        conn.execute(
            text(
                "UPDATE applications SET created_at = COALESCE(created_at, :now)"
            ),
            {"now": datetime.utcnow()},
        )
        conn.execute(
            text(
                "UPDATE applications SET updated_at = COALESCE(updated_at, :now)"
            ),
            {"now": datetime.utcnow()},
        )
        conn.execute(
            text(
                "UPDATE applications SET created_by = COALESCE(created_by, 'local')"
            )
        )


def _cleanup_nat(engine: Engine) -> None:
    if engine.dialect.name != "sqlite":
        return
    with engine.begin() as conn:
        for column in ("application_date", "interview_datetime", "followup_date"):
            conn.execute(
                text(
                    f"UPDATE applications SET {column} = NULL "
                    f"WHERE {column} IN ('NaT', 'nat', 'NaN', 'nan')"
                )
            )


def init_db() -> None:
    Base.metadata.create_all(bind=engine)
    _ensure_columns(engine, "applications", Application.__table__.columns)
    _ensure_columns(engine, "views", View.__table__.columns)
    _ensure_columns(engine, "settings", Setting.__table__.columns)
    _ensure_indexes(engine)
    _backfill_application_ids(engine)
    _backfill_defaults(engine)
    _cleanup_nat(engine)
