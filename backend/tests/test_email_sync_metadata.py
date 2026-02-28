import sys
from datetime import datetime, timedelta
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

sys.path.append(str(Path(__file__).resolve().parents[1]))

from app.crud import list_email_metadata, sync_email_metadata  # noqa: E402
from app.models import Base, EmailMessage, EmailSyncCursor  # noqa: E402


class EmailSyncMetadataTests(unittest.TestCase):
    def _new_session(self) -> tuple[TemporaryDirectory[str], Session]:
        tmp = TemporaryDirectory()
        db_path = Path(tmp.name) / "test.db"
        engine = create_engine(f"sqlite:///{db_path}")
        Base.metadata.create_all(bind=engine, tables=[EmailMessage.__table__, EmailSyncCursor.__table__])
        return tmp, Session(bind=engine)

    def test_sync_skips_duplicate_message_ids_in_same_batch(self) -> None:
        tmp, session = self._new_session()
        try:
            sent_at = datetime.utcnow() - timedelta(days=1)
            result = sync_email_metadata(
                session,
                contact_id="person@example.com",
                folder="ALL",
                messages=[
                    {
                        "message_id": "<same@example.com>",
                        "from_address": "sender@example.com",
                        "to_address": "person@example.com",
                        "subject": "First copy",
                        "date": sent_at,
                        "is_read": False,
                        "folder": "INBOX",
                    },
                    {
                        "message_id": "<same@example.com>",
                        "from_address": "sender@example.com",
                        "to_address": "person@example.com",
                        "subject": "Second copy",
                        "date": sent_at,
                        "is_read": False,
                        "folder": "[Gmail]/All Mail",
                    },
                ],
            )

            self.assertEqual(result["inserted"], 1)
            self.assertEqual(result["skipped_existing"], 1)
            self.assertEqual(session.query(EmailMessage).count(), 1)
        finally:
            session.close()
            tmp.cleanup()

    def test_sync_treats_existing_message_from_other_contact_as_skipped(self) -> None:
        tmp, session = self._new_session()
        try:
            sent_at = datetime.utcnow() - timedelta(days=1)
            sync_email_metadata(
                session,
                contact_id="first@example.com",
                folder="ALL",
                messages=[
                    {
                        "message_id": "<shared@example.com>",
                        "from_address": "sender@example.com",
                        "to_address": "first@example.com",
                        "subject": "Shared message",
                        "date": sent_at,
                        "is_read": False,
                        "folder": "INBOX",
                    }
                ],
            )

            result = sync_email_metadata(
                session,
                contact_id="second@example.com",
                folder="ALL",
                messages=[
                    {
                        "message_id": "<shared@example.com>",
                        "from_address": "sender@example.com",
                        "to_address": "second@example.com",
                        "subject": "Shared message",
                        "date": sent_at,
                        "is_read": False,
                        "folder": "INBOX",
                    }
                ],
            )

            self.assertEqual(result["inserted"], 0)
            self.assertEqual(result["skipped_existing"], 1)
            self.assertEqual(session.query(EmailMessage).count(), 1)
        finally:
            session.close()
            tmp.cleanup()

    def test_sync_keeps_messages_older_than_previous_window(self) -> None:
        tmp, session = self._new_session()
        try:
            sent_at = datetime.utcnow() - timedelta(days=540)
            result = sync_email_metadata(
                session,
                contact_id="person@example.com",
                folder="ALL",
                messages=[
                    {
                        "message_id": "<historic@example.com>",
                        "from_address": "sender@example.com",
                        "to_address": "person@example.com",
                        "subject": "Historic message",
                        "date": sent_at,
                        "is_read": False,
                        "folder": "INBOX",
                    }
                ],
            )

            stored = session.get(EmailMessage, "<historic@example.com>")

            self.assertEqual(result["inserted"], 1)
            self.assertEqual(result["skipped_out_of_window"], 0)
            self.assertIsNotNone(stored)
            self.assertEqual(stored.subject, "Historic message")
        finally:
            session.close()
            tmp.cleanup()

    def test_sync_updates_cursor_for_actual_message_folder(self) -> None:
        tmp, session = self._new_session()
        try:
            inbox_date = datetime.utcnow() - timedelta(days=2)
            all_mail_date = datetime.utcnow() - timedelta(days=1)
            sync_email_metadata(
                session,
                contact_id="person@example.com",
                folder="ALL",
                messages=[
                    {
                        "message_id": "<inbox@example.com>",
                        "from_address": "sender@example.com",
                        "to_address": "person@example.com",
                        "subject": "Inbox message",
                        "date": inbox_date,
                        "is_read": False,
                        "folder": "INBOX",
                    },
                    {
                        "message_id": "<allmail@example.com>",
                        "from_address": "sender@example.com",
                        "to_address": "person@example.com",
                        "subject": "All Mail message",
                        "date": all_mail_date,
                        "is_read": False,
                        "folder": "[Gmail]/All Mail",
                    },
                ],
            )

            inbox_cursor = (
                session.query(EmailSyncCursor)
                .filter(
                    EmailSyncCursor.contact_id == "person@example.com",
                    EmailSyncCursor.folder == "INBOX",
                )
                .first()
            )
            all_mail_cursor = (
                session.query(EmailSyncCursor)
                .filter(
                    EmailSyncCursor.contact_id == "person@example.com",
                    EmailSyncCursor.folder == "[Gmail]/All Mail",
                )
                .first()
            )

            self.assertIsNotNone(inbox_cursor)
            self.assertIsNotNone(all_mail_cursor)
            self.assertEqual(inbox_cursor.last_synced_at, inbox_date.replace(tzinfo=None))
            self.assertEqual(all_mail_cursor.last_synced_at, all_mail_date.replace(tzinfo=None))
        finally:
            session.close()
            tmp.cleanup()

    def test_list_email_metadata_respects_start_date_filter(self) -> None:
        tmp, session = self._new_session()
        try:
            old_date = datetime.utcnow() - timedelta(days=90)
            recent_date = datetime.utcnow() - timedelta(days=3)
            sync_email_metadata(
                session,
                contact_id="person@example.com",
                folder="ALL",
                messages=[
                    {
                        "message_id": "<older@example.com>",
                        "from_address": "sender@example.com",
                        "to_address": "person@example.com",
                        "subject": "Older message",
                        "date": old_date,
                        "is_read": False,
                        "folder": "INBOX",
                    },
                    {
                        "message_id": "<recent@example.com>",
                        "from_address": "sender@example.com",
                        "to_address": "person@example.com",
                        "subject": "Recent message",
                        "date": recent_date,
                        "is_read": False,
                        "folder": "INBOX",
                    },
                ],
            )

            rows = list_email_metadata(
                session,
                contact_id="person@example.com",
                start_date=datetime.utcnow() - timedelta(days=14),
            )

            self.assertEqual([row.message_id for row in rows], ["<recent@example.com>"])
        finally:
            session.close()
            tmp.cleanup()


if __name__ == "__main__":
    unittest.main()
