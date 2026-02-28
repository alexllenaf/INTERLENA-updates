import sys
from datetime import datetime, timedelta
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

sys.path.append(str(Path(__file__).resolve().parents[1]))

from app.api.emails import get_message_body_api  # noqa: E402
from app.crud import fetch_and_cache_email_body, get_email_body  # noqa: E402
from app.models import Base, EmailMessage  # noqa: E402


FULL_CONTENT_BODY_MARKER = "<!-- email-read-mode:full -->"


class EmailBodyModesTests(unittest.TestCase):
    def _new_session(self) -> tuple[TemporaryDirectory[str], Session]:
        tmp = TemporaryDirectory()
        db_path = Path(tmp.name) / "test.db"
        engine = create_engine(f"sqlite:///{db_path}")
        Base.metadata.create_all(bind=engine, tables=[EmailMessage.__table__])
        return tmp, Session(bind=engine)

    def test_get_email_body_requires_full_content_marker_when_requested(self) -> None:
        tmp, session = self._new_session()
        try:
            session.add(
                EmailMessage(
                    message_id="<body@example.com>",
                    contact_id="person@example.com",
                    from_address="sender@example.com",
                    to_address="person@example.com",
                    subject="Body",
                    date=datetime.utcnow() - timedelta(days=1),
                    is_read=False,
                    folder="INBOX",
                    body="Texto simple",
                )
            )
            session.commit()

            self.assertEqual(get_email_body(session, "<body@example.com>"), "Texto simple")
            self.assertIsNone(get_email_body(session, "<body@example.com>", full_content=True))
        finally:
            session.close()
            tmp.cleanup()

    def test_fetch_and_cache_email_body_refetches_for_full_content(self) -> None:
        tmp, session = self._new_session()
        try:
            session.add(
                EmailMessage(
                    message_id="<body-full@example.com>",
                    contact_id="person@example.com",
                    from_address="sender@example.com",
                    to_address="person@example.com",
                    subject="Body full",
                    date=datetime.utcnow() - timedelta(days=1),
                    is_read=False,
                    folder="INBOX",
                    body="Texto simple",
                )
            )
            session.commit()

            with patch(
                "app.crud.fetch_email_body_from_provider",
                return_value=f"{FULL_CONTENT_BODY_MARKER}<p>HTML completo</p>",
            ) as fetch_provider:
                result = fetch_and_cache_email_body(session, "<body-full@example.com>", full_content=True)

            self.assertIsNotNone(result)
            assert result is not None
            self.assertFalse(result["cached"])
            self.assertIn(FULL_CONTENT_BODY_MARKER, result["body"])
            fetch_provider.assert_called_once()
            self.assertEqual(fetch_provider.call_args.kwargs["full_content"], True)
        finally:
            session.close()
            tmp.cleanup()

    def test_get_message_body_api_returns_empty_body_when_message_exists_without_body(self) -> None:
        tmp, session = self._new_session()
        try:
            session.add(
                EmailMessage(
                    message_id="<body-empty@example.com>",
                    contact_id="person@example.com",
                    from_address="sender@example.com",
                    to_address="person@example.com",
                    subject="Body empty",
                    date=datetime.utcnow() - timedelta(days=1),
                    is_read=False,
                    folder="INBOX",
                    body=None,
                )
            )
            session.commit()

            with patch("app.api.emails._is_read_enabled", return_value=True):
                with patch("app.api.emails.fetch_and_cache_email_body", return_value=None):
                    result = get_message_body_api("<body-empty@example.com>", False, session)

            self.assertEqual(result.message_id, "<body-empty@example.com>")
            self.assertEqual(result.body, "")
            self.assertFalse(result.cached)
        finally:
            session.close()
            tmp.cleanup()

    def test_get_message_body_api_raises_404_when_message_does_not_exist(self) -> None:
        tmp, session = self._new_session()
        try:
            with patch("app.api.emails._is_read_enabled", return_value=True):
                with patch("app.api.emails.fetch_and_cache_email_body", return_value=None):
                    with self.assertRaises(HTTPException) as ctx:
                        get_message_body_api("<missing@example.com>", False, session)

            self.assertEqual(ctx.exception.status_code, 404)
            self.assertEqual(ctx.exception.detail, "Email message not found")
        finally:
            session.close()
            tmp.cleanup()


if __name__ == "__main__":
    unittest.main()
