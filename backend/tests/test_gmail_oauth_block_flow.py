import sys
from pathlib import Path
import unittest
from unittest.mock import patch
import urllib.parse

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

sys.path.append(str(Path(__file__).resolve().parents[1]))

from app.main import app  # noqa: E402
from app.api import gmail_oauth as gmail_oauth_api  # noqa: E402
from app.models import Base, Setting  # noqa: E402
from app.settings_store import get_settings, save_settings  # noqa: E402
from app.services.email import oauth as email_oauth  # noqa: E402


class GmailOauthBlockFlowTests(unittest.TestCase):
    def test_oauth_google_start_requests_full_mail_scope(self) -> None:
        with patch.object(
            gmail_oauth_api,
            "get_google_oauth_backend_config",
            return_value=(
                True,
                "ok",
                {
                    "client_id": "client-id",
                    "client_secret": "client-secret",
                    "redirect_uri": "http://127.0.0.1:8000/oauth/google/callback",
                },
            ),
        ):
            with TestClient(app) as client:
                response = client.get("/oauth/google/start", follow_redirects=False)

        self.assertEqual(response.status_code, 302)
        location = response.headers["location"]
        query = urllib.parse.parse_qs(urllib.parse.urlparse(location).query)
        self.assertEqual(query.get("scope"), [f"{email_oauth.GOOGLE_SCOPE} openid email"])

    def test_exchange_google_code_pkce_accepts_mail_google_scope(self) -> None:
        with patch.object(
            email_oauth,
            "get_google_oauth_backend_config",
            return_value=(
                True,
                "ok",
                {
                    "client_id": "client-id",
                    "client_secret": "client-secret",
                    "redirect_uri": "http://127.0.0.1:8000/oauth/google/callback",
                },
            ),
        ):
            with patch.object(
                email_oauth,
                "_post_form",
                return_value=(
                    True,
                    "ok",
                    {
                        "access_token": "access-token",
                        "refresh_token": "refresh-token",
                        "scope": f"{email_oauth.GOOGLE_SCOPE} openid email",
                        "expires_in": 3600,
                    },
                ),
            ):
                ok, message, token_data = email_oauth.exchange_google_code_pkce("code", "verifier")

        self.assertTrue(ok, message)
        self.assertEqual(token_data.get("access_token"), "access-token")
        self.assertTrue(str(token_data.get("expires_at") or "").strip())

    def test_store_google_send_tokens_syncs_google_provider_config(self) -> None:
        saved_configs: list[dict] = []

        def fake_store_tokens(**kwargs) -> None:
            provider_cfg = kwargs["provider_cfg"]
            provider_cfg["token_storage"] = "keyring"
            provider_cfg["token_account"] = kwargs["account_hint"] or "default"
            provider_cfg["access_token"] = ""
            provider_cfg["refresh_token"] = ""

        with patch.object(email_oauth, "_cache_google_send_access_token", return_value=None):
            with patch.object(email_oauth, "fetch_google_user_email", return_value="person@example.com"):
                with patch.object(email_oauth, "_save_token_secure", return_value=True):
                    with patch.object(email_oauth, "register_google_account", return_value=None):
                        with patch.object(
                            email_oauth,
                            "_get_email_sync_config",
                            return_value={"provider": "none", "imap": {}, "oauth": {"providers": {}}},
                        ):
                            with patch.object(
                                email_oauth,
                                "_save_email_sync_config",
                                side_effect=lambda _db, cfg: saved_configs.append(cfg),
                            ):
                                with patch.object(
                                    email_oauth,
                                    "get_google_oauth_backend_config",
                                    return_value=(
                                        True,
                                        "ok",
                                        {
                                            "client_id": "client-id",
                                            "client_secret": "client-secret",
                                            "redirect_uri": "http://127.0.0.1:8000/oauth/google/callback",
                                        },
                                    ),
                                ):
                                    with patch.object(email_oauth, "store_oauth_tokens_secure", side_effect=fake_store_tokens):
                                        ok, _message = email_oauth.store_google_send_tokens_secure(
                                            {
                                                "access_token": "access-token",
                                                "refresh_token": "refresh-token",
                                                "scope": f"{email_oauth.GOOGLE_SCOPE} openid email",
                                                "token_type": "Bearer",
                                                "expires_at": "2099-01-01T00:00:00+00:00",
                                            },
                                            db=object(),
                                        )

        self.assertTrue(ok)
        self.assertEqual(len(saved_configs), 1)
        saved_cfg = saved_configs[0]
        provider_cfg = saved_cfg["oauth"]["providers"]["oauth_google"]

        self.assertEqual(saved_cfg["provider"], "oauth_google")
        self.assertEqual(saved_cfg["imap"]["username"], "person@example.com")
        self.assertEqual(saved_cfg["imap"]["host"], "imap.gmail.com")
        self.assertEqual(provider_cfg["client_id"], "client-id")
        self.assertEqual(provider_cfg["client_secret"], "client-secret")
        self.assertEqual(provider_cfg["redirect_uri"], "http://127.0.0.1:8000/oauth/google/callback")
        self.assertEqual(provider_cfg["token_storage"], "keyring")
        self.assertEqual(provider_cfg["token_account"], "person@example.com")
        self.assertEqual(provider_cfg["scope"], f"{email_oauth.GOOGLE_SCOPE} openid email")

    def test_select_google_account_syncs_imap_username_for_read_mode(self) -> None:
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(bind=engine, tables=[Setting.__table__])

        with Session(bind=engine) as session:
            save_settings(
                session,
                {
                    "email_sync": {
                        "provider": "oauth_google",
                        "google_accounts": ["first@example.com", "second@example.com"],
                        "google_active_account": "first@example.com",
                        "imap": {
                            "host": "imap.gmail.com",
                            "port": 993,
                            "username": "first@example.com",
                            "use_ssl": True,
                            "folder": "INBOX",
                        },
                        "oauth": {
                            "providers": {
                                "oauth_google": {
                                    "token_account": "first@example.com",
                                }
                            }
                        },
                    }
                },
            )

            ok, message = email_oauth.select_google_account(session, "second@example.com")
            cfg = get_settings(session)["email_sync"]

        self.assertTrue(ok, message)
        self.assertEqual(cfg["google_active_account"], "second@example.com")
        self.assertEqual(cfg["imap"]["username"], "second@example.com")
        self.assertEqual(cfg["oauth"]["providers"]["oauth_google"]["token_account"], "second@example.com")


if __name__ == "__main__":
    unittest.main()
