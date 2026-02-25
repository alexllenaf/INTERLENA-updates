import os
import sqlite3
import sys
from datetime import datetime
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from fastapi import HTTPException
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

sys.path.append(str(Path(__file__).resolve().parents[1]))

from app.api.onboarding import onboarding_complete_api  # noqa: E402
from app.migrations import Migration, _create_canonical_schema, _migrate_legacy_applications  # noqa: E402
from app.models import (  # noqa: E402
    Application,
    Base,
    Database,
    MigrationMap,
    Page,
    Record,
    Setting,
)
from app.schemas import OnboardingCompleteIn  # noqa: E402
from app.services.canonical import (  # noqa: E402
    list_page_blocks,
    list_pages,
    replace_page_blocks,
    resolve_page_by_legacy_key,
)
from app.services.onboarding import seed_from_template  # noqa: E402
from app.storage import StorageManager  # noqa: E402


class CanonicalMigrationTests(unittest.TestCase):
    def _new_engine(self, tmp_path: Path):
        db_path = tmp_path / "test.db"
        return create_engine(f"sqlite:///{db_path}")

    def _create_legacy_tables(self, engine) -> None:
        Base.metadata.create_all(
            bind=engine,
            tables=[
                Application.__table__,
                Setting.__table__,
            ],
        )

    def test_applications_count_matches_records_after_migration(self) -> None:
        with TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            engine = self._new_engine(tmp_path)
            self._create_legacy_tables(engine)

            with Session(bind=engine) as session:
                session.add_all(
                    [
                        Application(
                            application_id="app-1",
                            company_name="Acme",
                            position="Analyst",
                            job_type="Full-time",
                            stage="Applied",
                            outcome="In Progress",
                            created_at=datetime.utcnow(),
                            updated_at=datetime.utcnow(),
                        ),
                        Application(
                            application_id="app-2",
                            company_name="Globex",
                            position="Data",
                            job_type="Internship",
                            stage="Interview",
                            outcome="In Progress",
                            created_at=datetime.utcnow(),
                            updated_at=datetime.utcnow(),
                        ),
                    ]
                )
                session.commit()

            _create_canonical_schema(engine)
            _migrate_legacy_applications(engine)

            with Session(bind=engine) as session:
                apps_count = session.query(Application).count()
                database = session.query(Database).filter(Database.name == "Applications").first()
                self.assertIsNotNone(database)
                records_count = (
                    session.query(Record)
                    .filter(Record.database_id == database.id)  # type: ignore[arg-type]
                    .count()
                )
                self.assertEqual(apps_count, records_count)

    def test_block_tree_cycle_validation(self) -> None:
        with TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            engine = self._new_engine(tmp_path)
            _create_canonical_schema(engine)

            with Session(bind=engine) as session:
                page = Page(
                    id="page-1",
                    title="Test",
                    icon=None,
                    cover=None,
                    created_at=datetime.utcnow(),
                    updated_at=datetime.utcnow(),
                )
                session.add(page)
                session.commit()

                replace_page_blocks(
                    session,
                    page_id=page.id,
                    blocks=[
                        {"id": "a", "type": "text", "parent_id": None, "layout": {"colSpan": 60}, "props": {}},
                        {"id": "b", "type": "text", "parent_id": "a", "layout": {"colSpan": 60}, "props": {}},
                    ],
                )
                session.commit()

                with self.assertRaises(ValueError):
                    replace_page_blocks(
                        session,
                        page_id=page.id,
                        blocks=[
                            {"id": "a", "type": "text", "parent_id": "b", "layout": {"colSpan": 60}, "props": {}},
                            {"id": "b", "type": "text", "parent_id": "a", "layout": {"colSpan": 60}, "props": {}},
                        ],
                    )

    def test_block_ordering_is_stable(self) -> None:
        with TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            engine = self._new_engine(tmp_path)
            _create_canonical_schema(engine)

            with Session(bind=engine) as session:
                page = Page(
                    id="page-1",
                    title="Order",
                    icon=None,
                    cover=None,
                    created_at=datetime.utcnow(),
                    updated_at=datetime.utcnow(),
                )
                session.add(page)
                session.commit()

                replace_page_blocks(
                    session,
                    page_id=page.id,
                    blocks=[
                        {"id": "x", "type": "text", "layout": {"colSpan": 60}, "props": {"text": "x"}},
                        {"id": "y", "type": "text", "layout": {"colSpan": 60}, "props": {"text": "y"}},
                        {"id": "z", "type": "text", "layout": {"colSpan": 60}, "props": {"text": "z"}},
                    ],
                )
                session.commit()

                blocks = list_page_blocks(session, page.id)
                self.assertEqual([item["id"] for item in blocks], ["x", "y", "z"])
                positions = [item.get("position") for item in blocks]
                self.assertEqual(positions, sorted(positions))

    def test_seed_is_idempotent(self) -> None:
        with TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            engine = self._new_engine(tmp_path)
            _create_canonical_schema(engine)

            with Session(bind=engine) as session:
                first = seed_from_template(session, "blank_v1")
                session.commit()
                pages_after_first = session.query(Page).count()

                second = seed_from_template(session, "blank_v1")
                session.commit()
                pages_after_second = session.query(Page).count()

                self.assertEqual(first["home_page_id"], second["home_page_id"])
                self.assertEqual(pages_after_first, pages_after_second)

    def test_onboarding_cannot_be_completed_twice(self) -> None:
        with TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            engine = self._new_engine(tmp_path)
            _create_canonical_schema(engine)

            with Session(bind=engine) as session:
                first = onboarding_complete_api(
                    OnboardingCompleteIn(template_id="blank_v1"),
                    db=session,
                )
                session.commit()
                self.assertTrue(first.completed)

                with self.assertRaises(HTTPException) as ctx:
                    onboarding_complete_api(
                        OnboardingCompleteIn(template_id="blank_v1"),
                        db=session,
                    )
                self.assertEqual(ctx.exception.status_code, 409)

    def test_migration_failure_rolls_back_and_restores_backup(self) -> None:
        with TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            db_path = tmp_path / "applications.db"

            with sqlite3.connect(db_path) as conn:
                conn.execute("CREATE TABLE probe (id INTEGER PRIMARY KEY, value TEXT)")
                conn.execute("INSERT INTO probe (id, value) VALUES (1, 'before')")
                conn.commit()

            database_url = f"sqlite:///{db_path}"
            engine = create_engine(database_url)

            def failing_migration(_: object) -> None:
                with engine.begin() as conn:
                    conn.execute(text("UPDATE probe SET value = 'after' WHERE id = 1"))
                raise RuntimeError("forced migration error")

            with patch.dict(os.environ, {"APP_DATA_DIR": str(tmp_path)}, clear=False):
                manager = StorageManager(app_name="Unit Test", app_version="test", root_dir=tmp_path)
                manager.prepare(database_url=database_url, uploads_dir=str(tmp_path / "uploads"))

                with patch("app.storage.SCHEMA_VERSION", 1), patch(
                    "app.storage.iter_pending",
                    return_value=[Migration(version=1, name="failing", apply=failing_migration)],
                ):
                    with self.assertRaises(RuntimeError):
                        manager.apply_migrations(engine)

            with sqlite3.connect(db_path) as conn:
                value = conn.execute("SELECT value FROM probe WHERE id = 1").fetchone()[0]
            self.assertEqual(value, "before")

    def test_sheet_legacy_keys_use_new_sheet_title(self) -> None:
        with TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            engine = self._new_engine(tmp_path)
            _create_canonical_schema(engine)

            with Session(bind=engine) as session:
                page = resolve_page_by_legacy_key(session, "sheet:sheet-abc123-def456", create_if_missing=True)
                session.commit()
                self.assertIsNotNone(page)
                self.assertEqual(page.title, "New Sheet")

    def test_list_pages_normalizes_old_sheet_sheet_titles(self) -> None:
        with TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            engine = self._new_engine(tmp_path)
            _create_canonical_schema(engine)

            with Session(bind=engine) as session:
                page = Page(
                    id="page-sheet-1",
                    title="Sheet Sheet Abc123 Def456",
                    icon=None,
                    cover=None,
                    created_at=datetime.utcnow(),
                    updated_at=datetime.utcnow(),
                )
                session.add(page)
                session.add(
                    MigrationMap(
                        legacy_table="settings.page_configs",
                        legacy_id="sheet:sheet-abc123-def456",
                        new_table="pages",
                        new_id=page.id,
                    )
                )
                session.commit()

                pages = list_pages(session)
                by_id = {item["id"]: item for item in pages}
                self.assertIn(page.id, by_id)
                self.assertEqual(by_id[page.id]["title"], "New Sheet")


if __name__ == "__main__":
    unittest.main()
