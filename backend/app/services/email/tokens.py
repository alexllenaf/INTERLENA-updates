"""Secure credential storage & email-sync configuration helpers.

This is the **leaf** module – no internal dependencies on sibling modules.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Optional

from sqlalchemy.orm import Session

from ...settings_store import get_settings, save_settings

try:
    import keyring  # type: ignore
except Exception:
    keyring = None

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

KEYRING_SERVICE_PREFIX = "interview-atlas-email"
GOOGLE_SEND_TOKEN_ACCOUNT = "gmail-send-default"

# ---------- file-based token fallback (when keyring is unavailable) ----------


def _token_file_path() -> Path:
    """Return path to the fallback token JSON file in the app data directory."""
    from ...storage import get_storage_paths

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


# ---------------------------------------------------------------------------
# Core secure-storage primitives
# ---------------------------------------------------------------------------


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


# ---------------------------------------------------------------------------
# High-level token management
# ---------------------------------------------------------------------------


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


# ---------------------------------------------------------------------------
# Email-sync settings helpers (shared by imap / sending / oauth)
# ---------------------------------------------------------------------------


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
