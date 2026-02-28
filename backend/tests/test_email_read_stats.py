import sys
from datetime import timedelta
from pathlib import Path
import unittest
from unittest.mock import patch

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

sys.path.append(str(Path(__file__).resolve().parents[1]))

from app.models import Base, EmailReadLog, Setting  # noqa: E402
from app.settings_store import save_settings  # noqa: E402
from app.services.email import imap as email_imap  # noqa: E402


class EmailReadStatsTests(unittest.TestCase):
    def test_get_email_read_stats_aggregates_only_today_for_active_account(self) -> None:
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(bind=engine, tables=[EmailReadLog.__table__])

        start, _ = email_imap._daily_window_utc()
        today_bytes = 300 * 1024 * 1024

        with Session(bind=engine) as session:
            session.add_all(
                [
                    EmailReadLog(
                        provider="oauth_google",
                        account_id="reader@example.com",
                        operation="metadata",
                        folder="INBOX",
                        message_count=120,
                        bytes_downloaded=100 * 1024 * 1024,
                        created_at=start + timedelta(hours=1),
                    ),
                    EmailReadLog(
                        provider="oauth_google",
                        account_id="reader@example.com",
                        operation="body",
                        folder="INBOX",
                        message_count=1,
                        bytes_downloaded=200 * 1024 * 1024,
                        created_at=start + timedelta(hours=2),
                    ),
                    EmailReadLog(
                        provider="oauth_google",
                        account_id="reader@example.com",
                        operation="body",
                        folder="INBOX",
                        message_count=1,
                        bytes_downloaded=999,
                        created_at=start - timedelta(minutes=1),
                    ),
                    EmailReadLog(
                        provider="oauth_google",
                        account_id="other@example.com",
                        operation="body",
                        folder="INBOX",
                        message_count=1,
                        bytes_downloaded=999,
                        created_at=start + timedelta(hours=3),
                    ),
                ]
            )
            session.commit()

            with patch.object(
                email_imap,
                "_resolve_connection_runtime",
                return_value=(
                    True,
                    "ok",
                    {
                        "provider": "oauth_google",
                        "host": "imap.gmail.com",
                        "username": "reader@example.com",
                    },
                ),
            ):
                stats = email_imap.get_email_read_stats(session)

        expected_percent = round((today_bytes / email_imap.GMAIL_IMAP_DAILY_DOWNLOAD_LIMIT_BYTES) * 100, 1)

        self.assertTrue(stats["connected"])
        self.assertEqual(stats["account_id"], "reader@example.com")
        self.assertEqual(stats["downloaded_today_bytes"], today_bytes)
        self.assertEqual(stats["daily_limit_bytes"], email_imap.GMAIL_IMAP_DAILY_DOWNLOAD_LIMIT_BYTES)
        self.assertEqual(
            stats["remaining_today_bytes"],
            email_imap.GMAIL_IMAP_DAILY_DOWNLOAD_LIMIT_BYTES - today_bytes,
        )
        self.assertEqual(stats["used_percent"], expected_percent)
        self.assertIsNone(stats["warning"])

    def test_record_read_usage_persists_log_entry(self) -> None:
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(bind=engine, tables=[EmailReadLog.__table__])

        with Session(bind=engine) as session:
            email_imap._record_read_usage(
                session,
                runtime={"provider": "oauth_google", "username": "reader@example.com"},
                operation="metadata",
                folder="INBOX",
                message_count=25,
                bytes_downloaded=2048,
            )

            rows = session.query(EmailReadLog).all()

        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0].provider, "oauth_google")
        self.assertEqual(rows[0].account_id, "reader@example.com")
        self.assertEqual(rows[0].operation, "metadata")
        self.assertEqual(rows[0].folder, "INBOX")
        self.assertEqual(rows[0].message_count, 25)
        self.assertEqual(rows[0].bytes_downloaded, 2048)

    def test_resolve_connection_runtime_prefers_active_google_account(self) -> None:
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(bind=engine, tables=[Setting.__table__])

        with Session(bind=engine) as session:
            save_settings(
                session,
                {
                    "email_sync": {
                        "provider": "oauth_google",
                        "google_active_account": "active@example.com",
                        "imap": {
                            "host": "imap.gmail.com",
                            "port": 993,
                            "username": "stale@example.com",
                            "use_ssl": True,
                            "folder": "INBOX",
                        },
                        "oauth": {
                            "providers": {
                                "oauth_google": {
                                    "access_token": "stored-access",
                                    "refresh_token": "stored-refresh",
                                    "expires_at": "2099-01-01T00:00:00+00:00",
                                }
                            }
                        },
                    }
                },
            )

            with patch.object(email_imap, "resolve_oauth_tokens", return_value=("stored-access", "stored-refresh")) as resolve_tokens:
                with patch.object(email_imap, "_is_expired", return_value=False):
                    ok, message, runtime = email_imap._resolve_connection_runtime(session, None)

        self.assertTrue(ok, message)
        self.assertEqual(runtime["username"], "active@example.com")
        self.assertEqual(resolve_tokens.call_args.kwargs["account_hint"], "active@example.com")

    def test_list_email_metadata_from_provider_handles_runtime_resolution_errors(self) -> None:
        engine = create_engine("sqlite:///:memory:")
        with Session(bind=engine) as session:
            with patch.object(email_imap, "_resolve_connection_runtime", side_effect=RuntimeError("boom")):
                ok, message, rows = email_imap.list_email_metadata_from_provider(session, "person@example.com")

        self.assertFalse(ok)
        self.assertEqual(rows, [])
        self.assertIn("IMAP runtime setup failed: boom", message)

    def test_list_email_metadata_from_provider_handles_login_errors(self) -> None:
        engine = create_engine("sqlite:///:memory:")
        with Session(bind=engine) as session:
            with patch.object(
                email_imap,
                "_resolve_connection_runtime",
                return_value=(True, "ok", {"host": "imap.gmail.com", "port": 993, "use_ssl": True, "mode": "oauth"}),
            ):
                with patch.object(email_imap, "_imap_connect_and_auth", side_effect=RuntimeError("invalid credentials")):
                    ok, message, rows = email_imap.list_email_metadata_from_provider(session, "person@example.com")

        self.assertFalse(ok)
        self.assertEqual(rows, [])
        self.assertIn("IMAP connection failed: invalid credentials", message)


if __name__ == "__main__":
    unittest.main()
