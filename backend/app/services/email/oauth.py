"""OAuth flows – Google PKCE, generic OAuth (Google & Microsoft), token refresh.

Depends on: ``tokens`` (sibling module).
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
import json
import os
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Optional

from sqlalchemy.orm import Session

from ...settings_store import get_settings
from .tokens import (
    GOOGLE_SEND_TOKEN_ACCOUNT,
    _delete_token_secure,
    _get_email_sync_config,
    _load_token_secure,
    _save_email_sync_config,
    _save_token_secure,
    resolve_oauth_tokens,
)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

GOOGLE_SCOPE = "https://mail.google.com/"
GOOGLE_GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send"
MICROSOFT_SCOPE = "https://outlook.office.com/IMAP.AccessAsUser.All offline_access"
GOOGLE_OAUTH_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_OAUTH_REVOKE_URL = "https://oauth2.googleapis.com/revoke"
GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo"

_GOOGLE_SEND_ACCESS_CACHE: dict[str, str] = {
    "access_token": "",
    "expires_at": "",
}

# ---------------------------------------------------------------------------
# Google-specific helpers
# ---------------------------------------------------------------------------


def _google_oauth_redirect_uri() -> str:
    configured = str(os.getenv("GOOGLE_OAUTH_REDIRECT_URI", "") or "").strip()
    if configured:
        return configured
    port = str(os.getenv("GOOGLE_OAUTH_PORT", "8000") or "8000").strip() or "8000"
    return f"http://127.0.0.1:{port}/oauth/google/callback"


def _google_oauth_settings_fallback() -> dict[str, str]:
    try:
        from ...db import SessionLocal
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

    # Validate that Google actually granted the gmail.send scope.
    granted_scope = str(data.get("scope") or "")
    if granted_scope and "gmail.send" not in granted_scope:
        return False, (
            "Google no concedió el permiso gmail.send (scopes recibidos: "
            f"{granted_scope}). Asegúrate de que la Gmail API esté habilitada "
            "en Google Cloud Console y vuelve a autorizar."
        ), {}

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


# ---------------------------------------------------------------------------
# Multi-account registry  (stored in settings → email_sync.google_accounts)
# ---------------------------------------------------------------------------


def _get_google_accounts_list(db: Session) -> list[str]:
    """Return the ordered list of connected Google account emails."""
    cfg = _get_email_sync_config(db, None)
    raw = cfg.get("google_accounts")
    if isinstance(raw, list):
        return [str(e) for e in raw if isinstance(e, str) and e.strip()]
    return []


def _save_google_accounts_list(db: Session, accounts: list[str]) -> None:
    cfg = _get_email_sync_config(db, None)
    cfg["google_accounts"] = accounts
    _save_email_sync_config(db, cfg)


def _get_active_google_account(db: Session) -> str:
    cfg = _get_email_sync_config(db, None)
    return str(cfg.get("google_active_account") or "").strip()


def _set_active_google_account(db: Session, email: str) -> None:
    cfg = _get_email_sync_config(db, None)
    cfg["google_active_account"] = email
    _save_email_sync_config(db, cfg)


def register_google_account(db: Session, email: str) -> None:
    """Add *email* to the connected-accounts list (idempotent) and mark it active."""
    if not email:
        return
    accounts = _get_google_accounts_list(db)
    if email not in accounts:
        accounts.append(email)
        _save_google_accounts_list(db, accounts)
    _set_active_google_account(db, email)


def list_google_accounts(db: Session) -> list[dict[str, Any]]:
    """Return [{email, active}] for every connected Google account."""
    accounts = _get_google_accounts_list(db)
    active = _get_active_google_account(db)
    # If no active set but accounts exist, first one is active
    if accounts and not active:
        active = accounts[0]
    return [{"email": a, "active": a == active} for a in accounts]


def select_google_account(db: Session, email: str) -> tuple[bool, str]:
    accounts = _get_google_accounts_list(db)
    if email not in accounts:
        return False, f"La cuenta {email} no está conectada."
    _set_active_google_account(db, email)
    # Also update the legacy single-account pointer so _resolve_google_send_auth works
    _save_google_send_email(email)
    return True, f"Cuenta activa: {email}"


def disconnect_single_google_account(db: Session, email: str) -> tuple[bool, str]:
    """Disconnect one specific Google account, keeping the others."""
    accounts = _get_google_accounts_list(db)
    if email not in accounts:
        return False, f"La cuenta {email} no está conectada."

    # Revoke token
    refresh = _load_token_secure("oauth_google", "refresh_token", email)
    if refresh:
        _post_form(GOOGLE_OAUTH_REVOKE_URL, {"token": refresh})

    # Delete stored tokens for this account
    for kind in ("refresh_token", "access_token", "user_email"):
        _delete_token_secure("oauth_google", kind, email)

    # Remove from list
    accounts = [a for a in accounts if a != email]
    _save_google_accounts_list(db, accounts)

    # If it was the active account, switch to the first remaining (or clear)
    active = _get_active_google_account(db)
    if active == email:
        new_active = accounts[0] if accounts else ""
        _set_active_google_account(db, new_active)
        if new_active:
            _save_google_send_email(new_active)

    # Clear cache if it was the active sending account
    _cache_google_send_access_token("", "")

    if accounts:
        return True, f"Cuenta {email} desconectada. Activa: {accounts[0]}"
    return True, f"Cuenta {email} desconectada. No quedan cuentas conectadas."


def store_google_send_tokens_secure(token_data: dict[str, Any], db: Optional[Session] = None) -> tuple[bool, str]:
    access_token = str(token_data.get("access_token") or "")
    if not access_token:
        return False, "OAuth response missing access_token"

    _cache_google_send_access_token(access_token, token_data.get("expires_at"))

    # Fetch and store the actual Gmail address
    user_email = fetch_google_user_email(access_token)
    if user_email:
        _save_google_send_email(user_email)

    refresh_token = str(token_data.get("refresh_token") or "")

    # --- Multi-account: store tokens keyed by email (in addition to legacy default) ---
    if user_email and refresh_token:
        _save_token_secure("oauth_google", "refresh_token", user_email, refresh_token)
        _save_token_secure("oauth_google", "access_token", user_email, access_token)
        _save_token_secure("oauth_google", "user_email", user_email, user_email)
        # Register in multi-account list
        if db is not None:
            register_google_account(db, user_email)

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


# ---------------------------------------------------------------------------
# Generic OAuth helpers (timestamp / scope / URLs / HTTP)
# ---------------------------------------------------------------------------


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


# ---------------------------------------------------------------------------
# Generic OAuth authorization / exchange / refresh
# ---------------------------------------------------------------------------


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
