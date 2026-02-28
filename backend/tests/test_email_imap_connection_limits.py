import imaplib
import sys
import threading
import time
from pathlib import Path
import unittest
from unittest.mock import patch

sys.path.append(str(Path(__file__).resolve().parents[1]))

from app.services.email import imap as email_imap  # noqa: E402


class _FakeConn:
    def __init__(self, name: str) -> None:
        self.name = name
        self.closed = False
        self.logged_out = False

    def close(self) -> None:
        self.closed = True

    def logout(self) -> None:
        self.logged_out = True


class EmailImapConnectionLimitTests(unittest.TestCase):
    def test_imap_mailbox_arg_quotes_spaces_and_double_quotes(self) -> None:
        self.assertEqual(email_imap._imap_mailbox_arg("INBOX"), '"INBOX"')
        self.assertEqual(email_imap._imap_mailbox_arg("[Gmail]/All Mail"), '"[Gmail]/All Mail"')
        self.assertEqual(email_imap._imap_mailbox_arg('Folder "A"'), '"Folder \\"A\\""')

    def test_imap_connect_retries_too_many_simultaneous_connections(self) -> None:
        first = _FakeConn("first")
        second = _FakeConn("second")

        with patch.object(email_imap, "_open_imap", side_effect=[first, second]) as open_imap:
            with patch.object(
                email_imap,
                "_imap_auth_password",
                side_effect=[
                    imaplib.IMAP4.error("[ALERT] Too many simultaneous connections. (Failure)"),
                    None,
                ],
            ) as auth_password:
                with patch.object(email_imap.time_module, "sleep", return_value=None) as sleep_mock:
                    conn = email_imap._imap_connect_and_auth(
                        {
                            "host": "imap.gmail.com",
                            "port": 993,
                            "use_ssl": True,
                            "mode": "password",
                            "username": "reader@example.com",
                            "password": "secret",
                        }
                    )

        self.assertIs(conn, second)
        self.assertEqual(open_imap.call_count, 2)
        self.assertEqual(auth_password.call_count, 2)
        sleep_mock.assert_called_once_with(1.0)
        self.assertTrue(first.closed)
        self.assertTrue(first.logged_out)

    def test_imap_session_serializes_parallel_access(self) -> None:
        first_started = threading.Event()
        release_first = threading.Event()
        connect_calls: list[str] = []

        def fake_connect(_runtime: dict[str, object]) -> _FakeConn:
            connect_calls.append(threading.current_thread().name)
            if len(connect_calls) == 1:
                first_started.set()
                release_first.wait(timeout=2.0)
            return _FakeConn(threading.current_thread().name)

        errors: list[Exception] = []

        def run_session() -> None:
            try:
                with email_imap._imap_session({"host": "imap.gmail.com"}):
                    time.sleep(0.05)
            except Exception as exc:  # pragma: no cover - test should not raise
                errors.append(exc)

        with patch.object(email_imap, "_imap_connect_and_auth", side_effect=fake_connect):
            t1 = threading.Thread(target=run_session, name="imap-1")
            t2 = threading.Thread(target=run_session, name="imap-2")

            t1.start()
            self.assertTrue(first_started.wait(timeout=1.0))
            t2.start()
            time.sleep(0.15)
            self.assertEqual(connect_calls, ["imap-1"])
            release_first.set()
            t1.join(timeout=2.0)
            t2.join(timeout=2.0)

        self.assertEqual(errors, [])
        self.assertEqual(connect_calls, ["imap-1", "imap-2"])


if __name__ == "__main__":
    unittest.main()
