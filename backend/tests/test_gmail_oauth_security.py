import os
import sys
from pathlib import Path
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

sys.path.append(str(Path(__file__).resolve().parents[1]))

from app.main import app  # noqa: E402
from app.api import gmail_oauth as gmail_oauth_api  # noqa: E402


class GmailOauthSecurityTests(unittest.TestCase):
    def setUp(self) -> None:
        gmail_oauth_api._SEND_RATE_HITS.clear()

    def test_gmail_send_requires_bearer_token(self) -> None:
        with patch.dict(os.environ, {"APP_API_TOKEN": "test-token"}, clear=False):
            with TestClient(app) as client:
                response = client.post(
                    "/gmail/send",
                    json={"to": "user@example.com", "subject": "Hi", "body": "Body"},
                )
        self.assertEqual(response.status_code, 401)

    def test_gmail_send_rate_limit_returns_429(self) -> None:
        with patch.dict(
            os.environ,
            {
                "APP_API_TOKEN": "test-token",
                "GMAIL_SEND_RATE_LIMIT": "1",
                "GMAIL_SEND_RATE_WINDOW_SECONDS": "60",
            },
            clear=False,
        ):
            with patch.object(gmail_oauth_api, "get_valid_google_send_access_token", return_value=(True, "ok", "access-token")):
                with patch.object(gmail_oauth_api, "send_gmail_message", return_value=(True, "Sent", "provider-id")):
                    with TestClient(app) as client:
                        headers = {"Authorization": "Bearer test-token"}
                        first = client.post(
                            "/gmail/send",
                            json={"to": "user@example.com", "subject": "Hi", "body": "Body"},
                            headers=headers,
                        )
                        second = client.post(
                            "/gmail/send",
                            json={"to": "user@example.com", "subject": "Hi", "body": "Body"},
                            headers=headers,
                        )

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 429)

    def test_gmail_send_rejects_header_injection(self) -> None:
        with patch.dict(os.environ, {"APP_API_TOKEN": "test-token"}, clear=False):
            with TestClient(app) as client:
                response = client.post(
                    "/gmail/send",
                    json={"to": "user@example.com", "subject": "Hi\r\nBcc:evil@example.com", "body": "Body"},
                    headers={"Authorization": "Bearer test-token"},
                )

        self.assertEqual(response.status_code, 400)
        self.assertIn("header injection", response.json().get("detail", "").lower())


if __name__ == "__main__":
    unittest.main()
