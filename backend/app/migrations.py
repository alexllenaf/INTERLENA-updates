from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Iterable

from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from .models import (
    Base,
    Block,
    Database,
    DatabaseProperty,
    DatabaseView,
    MetaKV,
    MigrationMap,
    Page,
    Record,
    RecordProperty,
    RecordRelation,
)
from .services.canonical import (
    mark_onboarding_completed_if_legacy_data_exists,
    migrate_applications_to_canonical,
    migrate_page_configs_to_canonical,
    set_meta,
)


@dataclass(frozen=True)
class Migration:
    version: int
    name: str
    apply: Callable[[Engine], None]


def _noop(_: Engine) -> None:
    return None


def _run_in_transaction(engine: Engine, callback: Callable[[Session], None]) -> None:
    with engine.begin() as conn:
        session = Session(bind=conn)
        try:
            callback(session)
            session.flush()
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()


def _create_canonical_schema(engine: Engine) -> None:
    def _apply(session: Session) -> None:
        bind = session.get_bind()
        if bind is None:
            raise RuntimeError("Missing DB bind for canonical schema migration")
        Base.metadata.create_all(
            bind=bind,
            tables=[
                Page.__table__,
                Block.__table__,
                Database.__table__,
                DatabaseProperty.__table__,
                Record.__table__,
                RecordProperty.__table__,
                RecordRelation.__table__,
                DatabaseView.__table__,
                MetaKV.__table__,
                MigrationMap.__table__,
            ],
        )

    _run_in_transaction(engine, _apply)


def _migrate_legacy_applications(engine: Engine) -> None:
    def _apply(session: Session) -> None:
        result = migrate_applications_to_canonical(session)
        applications = int(result.get("applications", 0))
        records = int(result.get("records", 0))
        if applications != records:
            raise RuntimeError(
                f"applications/records count mismatch after migration ({applications} != {records})"
            )
        set_meta(session, "migration.applications.last_result", str(result))

    _run_in_transaction(engine, _apply)


def _migrate_legacy_page_configs(engine: Engine) -> None:
    def _apply(session: Session) -> None:
        result = migrate_page_configs_to_canonical(session)
        set_meta(session, "migration.page_configs.last_result", str(result))

    _run_in_transaction(engine, _apply)


def _mark_onboarding_for_existing_data(engine: Engine) -> None:
    def _apply(session: Session) -> None:
        mark_onboarding_completed_if_legacy_data_exists(session)

    _run_in_transaction(engine, _apply)


MIGRATIONS: Iterable[Migration] = (
    Migration(version=1, name="baseline", apply=_noop),
    Migration(version=2, name="canonical_schema", apply=_create_canonical_schema),
    Migration(version=3, name="migrate_legacy_applications", apply=_migrate_legacy_applications),
    Migration(version=4, name="migrate_legacy_page_configs", apply=_migrate_legacy_page_configs),
    Migration(version=5, name="mark_onboarding_for_existing_data", apply=_mark_onboarding_for_existing_data),
)

SCHEMA_VERSION = max(m.version for m in MIGRATIONS)


def iter_pending(current_version: int) -> Iterable[Migration]:
    for migration in MIGRATIONS:
        if migration.version > current_version:
            yield migration
