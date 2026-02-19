from __future__ import annotations

import base64
from datetime import datetime, timedelta, timezone
import email
import os
import imaplib
import json
import random
import re
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from email import policy
from email.message import EmailMessage as MimeEmailMessage, EmailMessage as ParsedEmail
from pathlib import Path
from typing import Any, Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from ..models import Application, EmailMessage, EmailSendLog
from ..settings_store import get_settings, save_settings
from ..utils import parse_json_list, parse_properties_json

try:
    import keyring  # type: ignore
except Exception:
    keyring = None

GOOGLE_SCOPE = "https://mail.google.com/"
GOOGLE_GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send"
MICROSOFT_SCOPE = "https://outlook.office.com/IMAP.AccessAsUser.All offline_access"
GMAIL_SEND_ENDPOINT = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send"
EMAIL_DAILY_LIMIT = 500
EMAIL_DAILY_WARNING_THRESHOLD = 450
GMAIL_RETRYABLE_STATUS = {429, 500, 502, 503, 504}
KEYRING_SERVICE_PREFIX = "interview-atlas-email"
GOOGLE_OAUTH_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_OAUTH_REVOKE_URL = "https://oauth2.googleapis.com/revoke"
GOOGLE_SEND_TOKEN_ACCOUNT = "gmail-send-default"
GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo"

_GOOGLE_SEND_ACCESS_CACHE: dict[str, str] = {
    "access_token": "",
    "expires_at": "",
}

# ---------- file-based token fallback (when keyring is unavailable) ----------

def _token_file_path() -> Path:
    """Return path to the fallback token JSON file in the app data directory."""
    from ..storage import get_storage_paths
    paths = get_storage_paths()
    return paths.base_dir / ".tokens.json"


def _read_token_file() -> dict[str, Any]:
    p = _token_file_path()
    if not p.exists():
        return {}
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _write_token_file(data: dict[str, Any]) -> None:
    p = _token_file_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(data, indent=2), encoding="utf-8")
    # Restrict file permissions on Unix (owner read/write only)
    try:
        p.chmod(0o600)
    except Exception:
        pass


def _file_token_key(provider: str, token_kind: str, account: str) -> str:
    return f"{provider}:{token_kind}:{account}"


def _keyring_service(provider: str) -> str:
    return f"{KEYRING_SERVICE_PREFIX}:{provider}"


def _token_account_hint(account_hint: str, provider_cfg: dict[str, Any]) -> str:
    preferred = str(account_hint or "").strip()
    if preferred:
        return preferred
    fallback = str(provider_cfg.get("token_account") or provider_cfg.get("client_id") or "").strip()
    return fallback or "default"


def _google_oauth_redirect_uri() -> str:
    configured = str(os.getenv("GOOGLE_OAUTH_REDIRECT_URI", "") or "").strip()
    if configured:
        return configured
    port = str(os.getenv("GOOGLE_OAUTH_PORT", "8000") or "8000").strip() or "8000"
    return f"http://127.0.0.1:{port}/oauth/google/callback"


def _google_oauth_settings_fallback() -> dict[str, str]:
    try:
        from ..db import SessionLocal
    except Exception:
        return {}

    db = SessionLocal()
    try:
        settings = get_settings(db)
    except Exception:
        db.close()
        return {}

    try:
        email_sync = settings.get("email_sync") if isinstance(settings, dict) else {}
        oauth_root = email_sync.get("oauth") if isinstance(email_sync, dict) else {}
        providers = oauth_root.get("providers") if isinstance(oauth_root, dict) else {}
        google_cfg = providers.get("oauth_google") if isinstance(providers, dict) else {}
        if not isinstance(google_cfg, dict):
            return {}
        return {
            "client_id": str(google_cfg.get("client_id") or "").strip(),
            "client_secret": str(google_cfg.get("client_secret") or "").strip(),
        }
    finally:
        db.close()


def get_google_oauth_backend_config() -> tuple[bool, str, dict[str, str]]:
    env_client_id = str(os.getenv("GOOGLE_CLIENT_ID", "") or "").strip()
    env_client_secret = str(os.getenv("GOOGLE_CLIENT_SECRET", "") or "").strip()
    fallback = _google_oauth_settings_fallback()
    client_id = env_client_id or str(fallback.get("client_id") or "").strip()
    client_secret = env_client_secret or str(fallback.get("client_secret") or "").strip()
    redirect_uri = _google_oauth_redirect_uri()
    if not client_id:
        return False, "Missing Google OAuth client_id (env GOOGLE_CLIENT_ID or settings email_sync.oauth.providers.oauth_google.client_id)", {}
    return True, "ok", {
        "client_id": client_id,
        "client_secret": client_secret,
        "redirect_uri": redirect_uri,
    }


def exchange_google_code_pkce(code: str, code_verifier: str) -> tuple[bool, str, dict[str, Any]]:
    ok, message, cfg = get_google_oauth_backend_config()
    if not ok:
        return False, message, {}

    payload: dict[str, str] = {
        "grant_type": "authorization_code",
        "code": code,
        "client_id": cfg["client_id"],
        "redirect_uri": cfg["redirect_uri"],
        "code_verifier": code_verifier,
    }
    client_secret = str(cfg.get("client_secret") or "")
    if client_secret:
        payload["client_secret"] = client_secret

    ok_post, post_message, data = _post_form(GOOGLE_OAUTH_TOKEN_URL, payload)
    if not ok_post:
        return False, post_message, {}
    if not data.get("access_token"):
        return False, "OAuth token response missing access_token", {}

    data["expires_at"] = _expires_at_from_seconds(data.get("expires_in"))
    return True, "OAuth login successful", data


def _cache_google_send_access_token(access_token: str, expires_at: Any) -> None:
    _GOOGLE_SEND_ACCESS_CACHE["access_token"] = str(access_token or "")
    _GOOGLE_SEND_ACCESS_CACHE["expires_at"] = str(expires_at or "")


def fetch_google_user_email(access_token: str) -> str:
    """Fetch the authenticated user's email from Google's userinfo endpoint."""
    try:
        req = urllib.request.Request(
            GOOGLE_USERINFO_URL,
            headers={"Authorization": f"Bearer {access_token}"},
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return str(data.get("email") or "").strip()
    except Exception:
        return ""


def _save_google_send_email(email: str) -> None:
    """Persist the Gmail account email used for sending."""
    if email:
        _save_token_secure("oauth_google", "user_email", GOOGLE_SEND_TOKEN_ACCOUNT, email)


def get_google_send_email() -> str:
    """Retrieve the stored Gmail account email."""
    return _load_token_secure("oauth_google", "user_email", GOOGLE_SEND_TOKEN_ACCOUNT)


def store_google_send_tokens_secure(token_data: dict[str, Any]) -> tuple[bool, str]:
    access_token = str(token_data.get("access_token") or "")
    if not access_token:
        return False, "OAuth response missing access_token"

    _cache_google_send_access_token(access_token, token_data.get("expires_at"))

    # Fetch and store the actual Gmail address
    user_email = fetch_google_user_email(access_token)
    if user_email:
        _save_google_send_email(user_email)

    refresh_token = str(token_data.get("refresh_token") or "")
    if refresh_token:
        stored = _save_token_secure("oauth_google", "refresh_token", GOOGLE_SEND_TOKEN_ACCOUNT, refresh_token)
        if not stored:
            return False, "Secure storage unavailable for refresh_token (keyring)"
        email_display = f" ({user_email})" if user_email else ""
        return True, f"Google OAuth connected{email_display}"

    current_refresh = _load_token_secure("oauth_google", "refresh_token", GOOGLE_SEND_TOKEN_ACCOUNT)
    if current_refresh:
        email_display = f" ({user_email})" if user_email else ""
        return True, f"Google OAuth connected{email_display}"

    return False, "No refresh_token received. Re-authorize with prompt=consent and access_type=offline"


def get_valid_google_send_access_token() -> tuple[bool, str, str]:
    cached_access = str(_GOOGLE_SEND_ACCESS_CACHE.get("access_token") or "")
    cached_expires = _GOOGLE_SEND_ACCESS_CACHE.get("expires_at")
    if cached_access and not _is_expired(cached_expires):
        return True, "ok", cached_access

    refresh_token = _load_token_secure("oauth_google", "refresh_token", GOOGLE_SEND_TOKEN_ACCOUNT)
    if not refresh_token:
        return False, "Google OAuth not connected. Start /oauth/google/start first", ""

    ok, message, cfg = get_google_oauth_backend_config()
    if not ok:
        return False, message, ""

    payload: dict[str, str] = {
        "client_id": cfg["client_id"],
        "grant_type": "refresh_token",
        "refresh_token": refresh_token,
    }
    client_secret = str(cfg.get("client_secret") or "")
    if client_secret:
        payload["client_secret"] = client_secret

    ok_post, post_message, data = _post_form(GOOGLE_OAUTH_TOKEN_URL, payload)
    if not ok_post:
        return False, post_message, ""

    access_token = str(data.get("access_token") or "")
    if not access_token:
        return False, "Refresh response missing access_token", ""

    expires_at = _expires_at_from_seconds(data.get("expires_in"))
    _cache_google_send_access_token(access_token, expires_at)

    rotated_refresh = str(data.get("refresh_token") or "")
    if rotated_refresh:
        _save_token_secure("oauth_google", "refresh_token", GOOGLE_SEND_TOKEN_ACCOUNT, rotated_refresh)

    return True, "ok", access_token


def send_gmail_message(access_token: str, to_email: str, subject: str, body: str, from_email: str = "") -> tuple[bool, str, str]:
    mime = MimeEmailMessage()
    mime["To"] = to_email
    if from_email.strip():
        mime["From"] = from_email.strip()
    mime["Subject"] = subject
    mime.set_content(body)
    return _gmail_send_message(access_token=access_token, mime_bytes=mime.as_bytes())


def validate_no_header_injection(value: str, field_name: str) -> None:
    if "\r" in value or "\n" in value:
        raise ValueError(f"Invalid {field_name}: header injection detected")


def _save_token_secure(provider: str, token_kind: str, account: str, token_value: str) -> bool:
    if not token_value:
        return False
    # Try keyring first
    if keyring is not None:
        try:
            keyring.set_password(_keyring_service(provider), f"{token_kind}:{account}", token_value)
            return True
        except Exception:
            pass
    # Fallback: file-based storage
    try:
        data = _read_token_file()
        key = _file_token_key(provider, token_kind, account)
        data[key] = token_value
        _write_token_file(data)
        return True
    except Exception:
        return False


def _delete_token_secure(provider: str, token_kind: str, account: str) -> None:
    # Try keyring
    if keyring is not None:
        try:
            keyring.delete_password(_keyring_service(provider), f"{token_kind}:{account}")
        except Exception:
            pass
    # Also clean file fallback
    try:
        data = _read_token_file()
        key = _file_token_key(provider, token_kind, account)
        if key in data:
            del data[key]
            _write_token_file(data)
    except Exception:
        pass


def _load_token_secure(provider: str, token_kind: str, account: str) -> str:
    # Try keyring first
    if keyring is not None:
        try:
            val = keyring.get_password(_keyring_service(provider), f"{token_kind}:{account}")
            if val:
                return str(val)
        except Exception:
            pass
    # Fallback: file-based storage
    try:
        data = _read_token_file()
        key = _file_token_key(provider, token_kind, account)
        return str(data.get(key) or "")
    except Exception:
        return ""


def disconnect_google_send_oauth(db: Optional[Session] = None) -> tuple[bool, str]:
    cfg: dict[str, Any] = {}
    provider_cfg: dict[str, Any] = {}
    sender_email = ""
    if db is not None:
        cfg = _get_email_sync_config(db, None)
        imap_cfg = cfg.get("imap") if isinstance(cfg.get("imap"), dict) else {}
        sender_email = str(imap_cfg.get("username") or "").strip()
        oauth_root = cfg.get("oauth") if isinstance(cfg.get("oauth"), dict) else {}
        providers = oauth_root.get("providers") if isinstance(oauth_root.get("providers"), dict) else {}
        provider_cfg_raw = providers.get("oauth_google") if isinstance(providers.get("oauth_google"), dict) else {}
        provider_cfg = dict(provider_cfg_raw) if isinstance(provider_cfg_raw, dict) else {}

    access_cfg = ""
    refresh_cfg = ""
    if provider_cfg:
        access_cfg, refresh_cfg = resolve_oauth_tokens("oauth_google", provider_cfg, account_hint=sender_email)

    refresh_token = _load_token_secure("oauth_google", "refresh_token", GOOGLE_SEND_TOKEN_ACCOUNT)
    cached_access = str(_GOOGLE_SEND_ACCESS_CACHE.get("access_token") or "")
    token_to_revoke = refresh_cfg or refresh_token or access_cfg or cached_access

    revoke_ok = True
    revoke_message = "Google OAuth disconnected"
    if token_to_revoke:
        revoke_ok, revoke_message, _ = _post_form(GOOGLE_OAUTH_REVOKE_URL, {"token": token_to_revoke})

    accounts: set[str] = {GOOGLE_SEND_TOKEN_ACCOUNT}
    token_account = str(provider_cfg.get("token_account") or "").strip()
    if token_account:
        accounts.add(token_account)
    if sender_email:
        accounts.add(sender_email)
    client_id = str(provider_cfg.get("client_id") or "").strip()
    if client_id:
        accounts.add(client_id)

    for account in accounts:
        _delete_token_secure("oauth_google", "refresh_token", account)
        _delete_token_secure("oauth_google", "access_token", account)
        _delete_token_secure("oauth_google", "user_email", account)

    _cache_google_send_access_token("", "")

    if db is not None and cfg:
        oauth_root = cfg.get("oauth") if isinstance(cfg.get("oauth"), dict) else {}
        providers = oauth_root.get("providers") if isinstance(oauth_root.get("providers"), dict) else {}
        current_cfg = providers.get("oauth_google") if isinstance(providers.get("oauth_google"), dict) else {}
        current_cfg = dict(current_cfg) if isinstance(current_cfg, dict) else {}
        current_cfg["access_token"] = ""
        current_cfg["refresh_token"] = ""
        current_cfg["expires_at"] = ""
        current_cfg["token_storage"] = ""
        current_cfg["token_account"] = ""
        providers["oauth_google"] = current_cfg
        oauth_root["providers"] = providers
        cfg["oauth"] = oauth_root
        _save_email_sync_config(db, cfg)

    if revoke_ok:
        return True, "Google OAuth disconnected"
    return False, f"Google token cleared locally. Remote revoke status: {revoke_message}"


def store_oauth_tokens_secure(
    provider: str,
    provider_cfg: dict[str, Any],
    access_token: str,
    refresh_token: str,
    account_hint: str = "",
) -> None:
    account = _token_account_hint(account_hint, provider_cfg)
    stored_access = _save_token_secure(provider, "access_token", account, str(access_token or ""))
    stored_refresh = _save_token_secure(provider, "refresh_token", account, str(refresh_token or ""))

    if stored_access or stored_refresh:
        provider_cfg["token_storage"] = "keyring"
        provider_cfg["token_account"] = account
        provider_cfg["access_token"] = ""
        provider_cfg["refresh_token"] = ""
        return

    provider_cfg["token_storage"] = "settings"
    provider_cfg["token_account"] = account
    provider_cfg["access_token"] = str(access_token or "")
    provider_cfg["refresh_token"] = str(refresh_token or "")


def resolve_oauth_tokens(provider: str, provider_cfg: dict[str, Any], account_hint: str = "") -> tuple[str, str]:
    account = _token_account_hint(account_hint, provider_cfg)
    token_storage = str(provider_cfg.get("token_storage") or "").strip().lower()

    access_token = ""
    refresh_token = ""
    if token_storage == "keyring":
        access_token = _load_token_secure(provider, "access_token", account)
        refresh_token = _load_token_secure(provider, "refresh_token", account)

    if not access_token:
        access_token = str(provider_cfg.get("access_token") or "")
    if not refresh_token:
        refresh_token = str(provider_cfg.get("refresh_token") or "")
    return access_token, refresh_token


def _default_imap_host(provider: str) -> str:
    if provider == "oauth_google":
        return "imap.gmail.com"
    if provider == "oauth_microsoft":
        return "outlook.office365.com"
    return ""


def _default_oauth_redirect(provider: str) -> str:
    return f"http://127.0.0.1:8000/api/email/oauth/callback/{provider}"


def _as_bool(value: Any, default: bool = True) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        raw = value.strip().lower()
        if raw in {"1", "true", "yes", "on"}:
            return True
        if raw in {"0", "false", "no", "off"}:
            return False
    return default


def _normalize_message_id(message_id: str) -> str:
    raw = (message_id or "").strip()
    if not raw:
        return raw
    if raw.startswith("<") and raw.endswith(">"):
        return raw
    return f"<{raw}>"


def _strip_html_tags(value: str) -> str:
    text = re.sub(r"<br\s*/?>", "\n", value, flags=re.IGNORECASE)
    text = re.sub(r"</p\s*>", "\n\n", text, flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", "", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _extract_body(parsed: ParsedEmail) -> str:
    plain_parts: list[str] = []
    html_parts: list[str] = []

    if parsed.is_multipart():
        for part in parsed.walk():
            if part.get_content_disposition() == "attachment":
                continue
            content_type = part.get_content_type()
            try:
                payload = part.get_content()
            except Exception:
                continue
            if not isinstance(payload, str):
                continue
            if content_type == "text/plain":
                plain_parts.append(payload)
            elif content_type == "text/html":
                html_parts.append(payload)
    else:
        content_type = parsed.get_content_type()
        try:
            payload = parsed.get_content()
        except Exception:
            payload = ""
        if isinstance(payload, str):
            if content_type == "text/html":
                html_parts.append(payload)
            else:
                plain_parts.append(payload)

    if plain_parts:
        return "\n\n".join(part.strip() for part in plain_parts if part.strip()).strip()
    if html_parts:
        merged = "\n\n".join(part.strip() for part in html_parts if part.strip())
        return _strip_html_tags(merged)
    return ""


def _parse_expires_at(value: Any) -> Optional[datetime]:
    if not isinstance(value, str):
        return None
    raw = value.strip()
    if not raw:
        return None
    if raw.endswith("Z"):
        raw = f"{raw[:-1]}+00:00"
    try:
        parsed = datetime.fromisoformat(raw)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _expires_at_from_seconds(expires_in: Any) -> str:
    try:
        seconds = int(expires_in)
    except (TypeError, ValueError):
        seconds = 3600
    dt = datetime.now(timezone.utc) + timedelta(seconds=max(60, seconds))
    return dt.isoformat()


def _is_expired(expires_at: Any) -> bool:
    parsed = _parse_expires_at(expires_at)
    if parsed is None:
        return True
    return parsed <= (datetime.now(timezone.utc) + timedelta(seconds=60))


def _provider_scope(provider: str) -> str:
    if provider == "oauth_google":
        return GOOGLE_SCOPE
    if provider == "oauth_microsoft":
        return MICROSOFT_SCOPE
    return ""


def _provider_refresh_scope(provider: str, scope_override: Optional[str] = None) -> str:
    raw = str(scope_override or "").strip()
    if raw:
        return raw
    return _provider_scope(provider)


def _provider_auth_url(provider: str, tenant_id: str = "common") -> str:
    if provider == "oauth_google":
        return "https://accounts.google.com/o/oauth2/v2/auth"
    if provider == "oauth_microsoft":
        tenant = tenant_id or "common"
        return f"https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize"
    return ""


def _provider_token_url(provider: str, tenant_id: str = "common") -> str:
    if provider == "oauth_google":
        return "https://oauth2.googleapis.com/token"
    if provider == "oauth_microsoft":
        tenant = tenant_id or "common"
        return f"https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token"
    return ""


def _post_form(url: str, payload: dict[str, str]) -> tuple[bool, str, dict[str, Any]]:
    data = urllib.parse.urlencode(payload).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            body = response.read().decode("utf-8", errors="ignore")
            return True, "ok", json.loads(body) if body else {}
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="ignore")
        return False, f"HTTP {exc.code}: {detail or exc.reason}", {}
    except Exception as exc:
        return False, f"Request failed: {exc}", {}


def _post_json(
    url: str,
    payload: dict[str, Any],
    headers: Optional[dict[str, str]] = None,
) -> tuple[bool, str, dict[str, Any], Optional[int]]:
    body = json.dumps(payload).encode("utf-8")
    request_headers = {"Content-Type": "application/json"}
    if headers:
        request_headers.update(headers)
    request = urllib.request.Request(url, data=body, headers=request_headers, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            data = response.read().decode("utf-8", errors="ignore")
            parsed = json.loads(data) if data else {}
            return True, "ok", parsed, int(getattr(response, "status", 200) or 200)
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="ignore")
        message = detail or exc.reason
        try:
            parsed = json.loads(detail) if detail else {}
            api_message = (
                parsed.get("error", {}).get("message")
                if isinstance(parsed.get("error"), dict)
                else parsed.get("error_description")
            )
            if api_message:
                message = str(api_message)
        except Exception:
            pass
        return False, f"HTTP {exc.code}: {message}", {}, int(getattr(exc, "code", 0) or 0)
    except Exception as exc:
        return False, f"Request failed: {exc}", {}, None


def build_oauth_authorization_url(
    provider: str,
    client_id: str,
    redirect_uri: str,
    state: str,
    tenant_id: str = "common",
    scope_override: Optional[str] = None,
) -> tuple[bool, str, str]:
    auth_base = _provider_auth_url(provider, tenant_id)
    scope = _provider_refresh_scope(provider, scope_override)
    if not auth_base or not scope:
        return False, "Unsupported OAuth provider", ""

    query: dict[str, str] = {
        "response_type": "code",
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "scope": scope,
        "state": state,
    }
    if provider == "oauth_google":
        query.update({"access_type": "offline", "prompt": "consent"})
    url = f"{auth_base}?{urllib.parse.urlencode(query)}"
    return True, "ok", url


def exchange_oauth_authorization_code(
    provider: str,
    code: str,
    client_id: str,
    client_secret: str,
    redirect_uri: str,
    tenant_id: str = "common",
) -> tuple[bool, str, dict[str, Any]]:
    token_url = _provider_token_url(provider, tenant_id)
    if not token_url:
        return False, "Unsupported OAuth provider", {}

    ok, message, data = _post_form(
        token_url,
        {
            "grant_type": "authorization_code",
            "code": code,
            "client_id": client_id,
            "client_secret": client_secret,
            "redirect_uri": redirect_uri,
        },
    )
    if not ok:
        return False, message, {}
    if not data.get("access_token"):
        return False, "OAuth token response missing access_token", {}

    data["expires_at"] = _expires_at_from_seconds(data.get("expires_in"))
    return True, "OAuth login successful", data


def _refresh_oauth_access_token(
    provider: str,
    refresh_token: str,
    client_id: str,
    client_secret: str,
    tenant_id: str = "common",
    scope_override: Optional[str] = None,
) -> tuple[bool, str, dict[str, Any]]:
    token_url = _provider_token_url(provider, tenant_id)
    if not token_url:
        return False, "Unsupported OAuth provider", {}

    payload = {
        "grant_type": "refresh_token",
        "refresh_token": refresh_token,
        "client_id": client_id,
        "client_secret": client_secret,
    }
    scope = _provider_refresh_scope(provider, scope_override)
    if scope:
        payload["scope"] = scope

    ok, message, data = _post_form(token_url, payload)
    if not ok:
        return False, message, {}
    if not data.get("access_token"):
        return False, "Refresh response missing access_token", {}

    data["expires_at"] = _expires_at_from_seconds(data.get("expires_in"))
    return True, "OAuth token refreshed", data


def _get_email_sync_config(db: Session, override: Optional[dict[str, Any]] = None) -> dict[str, Any]:
    settings = get_settings(db)
    base = settings.get("email_sync") if isinstance(settings, dict) else {}
    cfg = dict(base) if isinstance(base, dict) else {}
    if not isinstance(override, dict):
        return cfg

    for key, value in override.items():
        if key in {"imap", "oauth"} and isinstance(value, dict):
            current = cfg.get(key)
            cfg[key] = {**(current if isinstance(current, dict) else {}), **value}
        else:
            cfg[key] = value
    return cfg


def _save_email_sync_config(db: Session, cfg: dict[str, Any]) -> None:
    save_settings(db, {"email_sync": cfg})


def _resolve_connection_runtime(
    db: Session,
    override: Optional[dict[str, Any]] = None,
) -> tuple[bool, str, dict[str, Any]]:
    cfg = _get_email_sync_config(db, override)
    provider = str(cfg.get("provider") or "none").strip().lower()
    imap_cfg = cfg.get("imap") if isinstance(cfg.get("imap"), dict) else {}
    folder = str(imap_cfg.get("folder") or "INBOX").strip() or "INBOX"
    host = str(imap_cfg.get("host") or "").strip()
    username = str(imap_cfg.get("username") or "").strip()
    port_raw = imap_cfg.get("port")
    try:
        port = int(port_raw) if port_raw is not None else 993
    except (TypeError, ValueError):
        port = 993
    use_ssl = _as_bool(imap_cfg.get("use_ssl"), default=True)

    if provider == "imap":
        password = str(imap_cfg.get("password") or "")
        if not host or not username or not password:
            return False, "Missing IMAP host/username/password", {}
        return True, "ok", {
            "provider": provider,
            "mode": "password",
            "host": host,
            "port": port,
            "username": username,
            "password": password,
            "use_ssl": use_ssl,
            "folder": folder,
        }

    if provider in {"oauth_google", "oauth_microsoft"}:
        if not username:
            return False, "Missing IMAP username for OAuth login", {}
        if not host:
            host = _default_imap_host(provider)

        oauth_root = cfg.get("oauth") if isinstance(cfg.get("oauth"), dict) else {}
        providers = oauth_root.get("providers") if isinstance(oauth_root.get("providers"), dict) else {}
        provider_cfg = providers.get(provider) if isinstance(providers.get(provider), dict) else {}

        access_token, refresh_token = resolve_oauth_tokens(provider, provider_cfg, account_hint=username)
        client_id = str(provider_cfg.get("client_id") or "")
        client_secret = str(provider_cfg.get("client_secret") or "")
        tenant_id = str(provider_cfg.get("tenant_id") or "common")
        expires_at = provider_cfg.get("expires_at")

        if not access_token:
            return False, "OAuth access token not found. Complete OAuth login first.", {}

        if _is_expired(expires_at):
            if not refresh_token or not client_id or not client_secret:
                return False, "OAuth token expired and cannot be refreshed", {}
            ok, message, refreshed = _refresh_oauth_access_token(
                provider=provider,
                refresh_token=refresh_token,
                client_id=client_id,
                client_secret=client_secret,
                tenant_id=tenant_id,
            )
            if not ok:
                return False, message, {}

            next_access_token = str(refreshed.get("access_token") or "")
            next_refresh_token = str(refreshed.get("refresh_token") or refresh_token)
            store_oauth_tokens_secure(
                provider=provider,
                provider_cfg=provider_cfg,
                access_token=next_access_token,
                refresh_token=next_refresh_token,
                account_hint=username,
            )
            provider_cfg["token_type"] = str(refreshed.get("token_type") or provider_cfg.get("token_type") or "Bearer")
            provider_cfg["scope"] = str(refreshed.get("scope") or provider_cfg.get("scope") or "")
            provider_cfg["expires_at"] = str(refreshed.get("expires_at") or "")
            providers[provider] = provider_cfg
            oauth_root["providers"] = providers
            cfg["oauth"] = oauth_root
            _save_email_sync_config(db, cfg)
            access_token, _ = resolve_oauth_tokens(provider, provider_cfg, account_hint=username)

        return True, "ok", {
            "provider": provider,
            "mode": "oauth",
            "host": host,
            "port": port,
            "username": username,
            "access_token": access_token,
            "use_ssl": use_ssl,
            "folder": folder,
        }

    return False, "Provider not configured", {}


def _open_imap(host: str, port: int, use_ssl: bool) -> imaplib.IMAP4 | imaplib.IMAP4_SSL:
    if use_ssl:
        return imaplib.IMAP4_SSL(host=host, port=port)
    return imaplib.IMAP4(host=host, port=port)


def _imap_auth_password(conn: imaplib.IMAP4 | imaplib.IMAP4_SSL, username: str, password: str) -> None:
    conn.login(username, password)


def _imap_auth_oauth(conn: imaplib.IMAP4 | imaplib.IMAP4_SSL, username: str, access_token: str) -> None:
    auth_string = f"user={username}\x01auth=Bearer {access_token}\x01\x01"
    conn.authenticate("XOAUTH2", lambda _: auth_string.encode("utf-8"))


def _imap_connect_and_auth(runtime: dict[str, Any]) -> imaplib.IMAP4 | imaplib.IMAP4_SSL:
    conn = _open_imap(runtime["host"], int(runtime["port"]), bool(runtime["use_ssl"]))
    if runtime["mode"] == "oauth":
        _imap_auth_oauth(conn, runtime["username"], runtime["access_token"])
    else:
        _imap_auth_password(conn, runtime["username"], runtime["password"])
    return conn


def _imap_list_folders(runtime: dict[str, Any]) -> tuple[bool, str, list[str]]:
    conn = _imap_connect_and_auth(runtime)
    try:
        status, rows = conn.list()
        if status != "OK":
            return False, "Connected but unable to list folders", []

        folders: list[str] = []
        for row in rows or []:
            decoded = row.decode("utf-8", errors="ignore") if isinstance(row, (bytes, bytearray)) else str(row)
            match = re.search(r'"([^\"]+)"\s*$', decoded)
            folder = match.group(1) if match else decoded.rsplit(" ", 1)[-1]
            folder = folder.strip().strip('"')
            if folder and folder not in folders:
                folders.append(folder)
        folders.sort(key=lambda item: item.lower())
        return True, "IMAP folders loaded", folders
    finally:
        try:
            conn.close()
        except Exception:
            pass
        try:
            conn.logout()
        except Exception:
            pass


def _imap_fetch_body(
    runtime: dict[str, Any],
    folder: str,
    message_id: str,
) -> Optional[str]:
    conn = _imap_connect_and_auth(runtime)

    try:
        status, _ = conn.select(folder, readonly=True)
        if status != "OK":
            return None

        normalized = _normalize_message_id(message_id)
        status, data = conn.search(None, "HEADER", "Message-ID", f'"{normalized}"')
        if status != "OK" or not data or not data[0]:
            return None

        message_num = data[0].split()[-1]
        status, fetched = conn.fetch(message_num, "(RFC822)")
        if status != "OK" or not fetched:
            return None

        raw_bytes: bytes | None = None
        for item in fetched:
            if isinstance(item, tuple) and len(item) >= 2 and isinstance(item[1], (bytes, bytearray)):
                raw_bytes = bytes(item[1])
                break
        if not raw_bytes:
            return None

        parsed = email.message_from_bytes(raw_bytes, policy=policy.default)
        body = _extract_body(parsed)
        return body or None
    finally:
        try:
            conn.close()
        except Exception:
            pass
        try:
            conn.logout()
        except Exception:
            pass


def fetch_email_body_from_provider(db: Session, message: EmailMessage) -> Optional[str]:
    ok, _, runtime = _resolve_connection_runtime(db, None)
    if not ok:
        return None
    folder = (message.folder or "INBOX").strip() or "INBOX"

    try:
        return _imap_fetch_body(runtime=runtime, folder=folder, message_id=message.message_id)
    except Exception:
        return None


def test_email_provider_connection(db: Session, config: dict[str, Any]) -> tuple[bool, str]:
    ok, message, runtime = _resolve_connection_runtime(db, config)
    if not ok:
        return False, message

    conn = _imap_connect_and_auth(runtime)
    try:
        status, _ = conn.select(runtime["folder"], readonly=True)
        if status != "OK":
            return False, f"Connected but unable to open folder '{runtime['folder']}'"
        return True, "IMAP connection successful"
    except Exception as exc:
        return False, f"IMAP authentication/select failed: {exc}"
    finally:
        try:
            conn.close()
        except Exception:
            pass
        try:
            conn.logout()
        except Exception:
            pass


def list_email_provider_folders(db: Session, config: dict[str, Any]) -> tuple[bool, str, list[str]]:
    ok, message, runtime = _resolve_connection_runtime(db, config)
    if not ok:
        return False, message, []
    try:
        return _imap_list_folders(runtime)
    except Exception as exc:
        return False, f"IMAP LIST failed: {exc}", []


def _template_value_map(contact: dict[str, Any]) -> dict[str, str]:
    values: dict[str, str] = {}
    for key, value in contact.items():
        if key == "custom_fields" and isinstance(value, dict):
            for custom_key, custom_value in value.items():
                text = str(custom_value or "")
                values[str(custom_key)] = text
                values[str(custom_key).lower()] = text
            continue
        text = str(value or "")
        values[str(key)] = text
        values[str(key).lower()] = text

    if "name" in values:
        values["Nombre"] = values.get("first_name", values["name"])
        values["nombre"] = values.get("first_name", values["name"])
        values["Apellidos"] = values.get("last_name", "")
        values["apellidos"] = values.get("last_name", "")
    if "first_name" in values:
        values["Nombre"] = values["first_name"]
        values["nombre"] = values["first_name"]
    if "last_name" in values:
        values["Apellidos"] = values["last_name"]
        values["apellidos"] = values["last_name"]
    if "company" in values:
        values["Empresa"] = values["company"]
        values["empresa"] = values["company"]
    if "email" in values:
        values["Email"] = values["email"]
        values["email"] = values["email"]
    return values


def render_email_template(template: str, values: dict[str, str]) -> str:
    pattern = re.compile(r"\{\{\s*([^{}\s]+)\s*\}\}")

    def _replace(match: re.Match[str]) -> str:
        key = match.group(1)
        if key in values:
            return values[key]
        key_lower = key.lower()
        return values.get(key_lower, "")

    return pattern.sub(_replace, template or "")


def list_tracker_contacts_for_email(db: Session, limit: int = 1000) -> list[dict[str, Any]]:
    rows = (
        db.query(Application)
        .order_by(Application.updated_at.desc(), Application.id.desc())
        .limit(max(1, min(limit, 5000)))
        .all()
    )

    contacts: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for row in rows:
        app_contacts = parse_json_list(row.contacts)
        app_properties = parse_properties_json(row.properties_json)
        for item in app_contacts:
            email_value = str(item.get("email") or "").strip()
            if not email_value:
                continue
            name = str(item.get("name") or "").strip()
            dedupe_key = (email_value.lower(), (row.company_name or "").strip().lower())
            if dedupe_key in seen:
                continue
            seen.add(dedupe_key)

            custom_fields: dict[str, str] = {}
            for custom_key, custom_value in app_properties.items():
                if custom_value is None:
                    continue
                custom_fields[str(custom_key)] = str(custom_value)

            contacts.append(
                {
                    "name": name,
                    "first_name": str(item.get("first_name") or name).strip(),
                    "last_name": str(item.get("last_name") or "").strip(),
                    "email": email_value,
                    "company": str(row.company_name or ""),
                    "custom_fields": custom_fields,
                }
            )
    return contacts


def _resolve_google_send_auth(db: Session) -> tuple[bool, str, dict[str, Any]]:
    cfg = _get_email_sync_config(db, None)
    imap_cfg = cfg.get("imap") if isinstance(cfg.get("imap"), dict) else {}
    sender_email = str(imap_cfg.get("username") or "").strip()
    if not sender_email:
        sender_email = str(os.getenv("GOOGLE_SENDER_EMAIL", "") or "").strip()
    if not sender_email:
        # Try to retrieve the email stored during OAuth login
        sender_email = get_google_send_email()
    if not sender_email:
        sender_email = "oauth-google"

    oauth_root = cfg.get("oauth") if isinstance(cfg.get("oauth"), dict) else {}
    providers = oauth_root.get("providers") if isinstance(oauth_root.get("providers"), dict) else {}
    provider_cfg = providers.get("oauth_google") if isinstance(providers.get("oauth_google"), dict) else {}

    access_token, refresh_token = resolve_oauth_tokens("oauth_google", provider_cfg, account_hint=sender_email)
    client_id = str(provider_cfg.get("client_id") or "")
    client_secret = str(provider_cfg.get("client_secret") or "")
    expires_at = provider_cfg.get("expires_at")
    scope = str(provider_cfg.get("scope") or GOOGLE_GMAIL_SEND_SCOPE)

    if not access_token:
        env_ok, env_message, env_access_token = get_valid_google_send_access_token()
        if env_ok:
            return True, "ok", {"access_token": env_access_token, "sent_by": sender_email}
        return False, "Google OAuth access token not found. Start Google login first.", {}

    if _is_expired(expires_at):
        if not refresh_token or not client_id or not client_secret:
            return False, "Google OAuth token expired and cannot be refreshed", {}
        ok, message, refreshed = _refresh_oauth_access_token(
            provider="oauth_google",
            refresh_token=refresh_token,
            client_id=client_id,
            client_secret=client_secret,
            tenant_id="common",
            scope_override=scope,
        )
        if not ok:
            return False, message, {}

        next_access_token = str(refreshed.get("access_token") or "")
        next_refresh_token = str(refreshed.get("refresh_token") or refresh_token)
        store_oauth_tokens_secure(
            provider="oauth_google",
            provider_cfg=provider_cfg,
            access_token=next_access_token,
            refresh_token=next_refresh_token,
            account_hint=sender_email,
        )
        provider_cfg["token_type"] = str(refreshed.get("token_type") or provider_cfg.get("token_type") or "Bearer")
        provider_cfg["scope"] = str(refreshed.get("scope") or provider_cfg.get("scope") or scope)
        provider_cfg["expires_at"] = str(refreshed.get("expires_at") or "")
        providers["oauth_google"] = provider_cfg
        oauth_root["providers"] = providers
        cfg["oauth"] = oauth_root
        _save_email_sync_config(db, cfg)
        access_token, _ = resolve_oauth_tokens("oauth_google", provider_cfg, account_hint=sender_email)

    return True, "ok", {"access_token": access_token, "sent_by": sender_email}


def _gmail_send_message(access_token: str, mime_bytes: bytes) -> tuple[bool, str, str]:
    raw = base64.urlsafe_b64encode(mime_bytes).decode("utf-8")
    attempts = 4
    last_message = "Send failed"
    for attempt in range(attempts):
        ok, message, data, status_code = _post_json(
            GMAIL_SEND_ENDPOINT,
            payload={"raw": raw},
            headers={"Authorization": f"Bearer {access_token}"},
        )
        if ok:
            provider_id = str(data.get("id") or "")
            return True, "Sent", provider_id

        last_message = message
        message_lower = str(message or "").lower()
        retryable = bool(status_code in GMAIL_RETRYABLE_STATUS) or "rate" in message_lower or "quota" in message_lower
        if not retryable or attempt >= attempts - 1:
            break

        backoff_seconds = min(8.0, (2 ** attempt) + random.uniform(0.1, 0.9))
        time.sleep(backoff_seconds)

    return False, f"{last_message} (after retry)", ""


def _daily_window_utc() -> tuple[datetime, datetime]:
    now = datetime.now(timezone.utc)
    start = datetime(year=now.year, month=now.month, day=now.day, tzinfo=timezone.utc)
    end = start + timedelta(days=1)
    return start.replace(tzinfo=None), end.replace(tzinfo=None)


def get_email_send_stats(db: Session, sent_by: str) -> dict[str, Any]:
    start, end = _daily_window_utc()
    sent_today = (
        db.query(func.count(EmailSendLog.id))
        .filter(
            EmailSendLog.sent_by == sent_by,
            EmailSendLog.status == "sent",
            EmailSendLog.created_at >= start,
            EmailSendLog.created_at < end,
        )
        .scalar()
        or 0
    )
    remaining = max(0, EMAIL_DAILY_LIMIT - int(sent_today))
    warning: Optional[str] = None
    if sent_today >= EMAIL_DAILY_LIMIT:
        warning = "Daily limit reached (500/day). Sending paused."
    elif sent_today >= EMAIL_DAILY_WARNING_THRESHOLD:
        warning = f"Approaching daily limit: {sent_today}/{EMAIL_DAILY_LIMIT}"
    return {
        "sent_by": sent_by,
        "sent_today": int(sent_today),
        "remaining_today": remaining,
        "daily_limit": EMAIL_DAILY_LIMIT,
        "warning": warning,
    }


def send_gmail_campaign(
    db: Session,
    subject_template: str,
    body_template: str,
    contacts: list[dict[str, Any]],
) -> dict[str, Any]:
    auth_ok, auth_message, auth = _resolve_google_send_auth(db)
    if not auth_ok:
        return {
            "ok": False,
            "batch_id": "",
            "sent_by": "",
            "total": len(contacts),
            "sent": 0,
            "errors": len(contacts),
            "warning": auth_message,
            "daily_limit": EMAIL_DAILY_LIMIT,
            "sent_today": 0,
            "remaining_today": 0,
            "results": [
                {
                    "email": str(item.get("email") or ""),
                    "name": str(item.get("name") or ""),
                    "status": "error",
                    "message": auth_message,
                    "provider_message_id": None,
                }
                for item in contacts
            ],
        }

    access_token = auth["access_token"]
    sent_by = auth["sent_by"]
    stats_before = get_email_send_stats(db, sent_by)
    remaining_quota = int(stats_before["remaining_today"])
    batch_id = str(uuid.uuid4())

    results: list[dict[str, Any]] = []
    sent = 0
    errors = 0

    for item in contacts:
        recipient = str(item.get("email") or "").strip()
        name = str(item.get("name") or "").strip()
        company = str(item.get("company") or "").strip()

        if not recipient:
            errors += 1
            results.append(
                {
                    "email": "",
                    "name": name,
                    "status": "error",
                    "message": "Missing recipient email",
                    "provider_message_id": None,
                }
            )
            continue

        if remaining_quota <= 0:
            errors += 1
            message = "Daily Gmail limit reached. Try again tomorrow."
            results.append(
                {
                    "email": recipient,
                    "name": name,
                    "status": "error",
                    "message": message,
                    "provider_message_id": None,
                }
            )
            db.add(
                EmailSendLog(
                    batch_id=batch_id,
                    sent_by=sent_by,
                    recipient_name=name,
                    recipient_email=recipient,
                    company=company,
                    subject="",
                    status="error",
                    error_message=message,
                    provider_message_id=None,
                )
            )
            continue

        values = _template_value_map(item)
        subject = render_email_template(subject_template, values)
        body = render_email_template(body_template, values)

        mime = MimeEmailMessage()
        mime["To"] = recipient
        if "@" in sent_by:
            mime["From"] = sent_by
        mime["Subject"] = subject
        mime.set_content(body)

        ok, message, provider_message_id = _gmail_send_message(access_token=access_token, mime_bytes=mime.as_bytes())
        status = "sent" if ok else "error"
        if ok:
            sent += 1
            remaining_quota -= 1
        else:
            errors += 1

        db.add(
            EmailSendLog(
                batch_id=batch_id,
                sent_by=sent_by,
                recipient_name=name,
                recipient_email=recipient,
                company=company,
                subject=subject,
                status=status,
                error_message=None if ok else message,
                provider_message_id=provider_message_id or None,
            )
        )
        results.append(
            {
                "email": recipient,
                "name": name,
                "status": status,
                "message": message,
                "provider_message_id": provider_message_id or None,
            }
        )

    db.commit()
    stats_after = get_email_send_stats(db, sent_by)

    return {
        "ok": sent > 0 and errors == 0,
        "batch_id": batch_id,
        "sent_by": sent_by,
        "total": len(contacts),
        "sent": sent,
        "errors": errors,
        "warning": stats_after.get("warning"),
        "daily_limit": stats_after["daily_limit"],
        "sent_today": stats_after["sent_today"],
        "remaining_today": stats_after["remaining_today"],
        "results": results,
    }
