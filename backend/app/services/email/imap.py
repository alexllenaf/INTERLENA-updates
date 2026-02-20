"""IMAP connection, folder listing, and email body fetch.

Depends on: ``tokens``, ``oauth`` (sibling modules).
"""
from __future__ import annotations

import email
import imaplib
import re
from email import policy
from email.message import EmailMessage as ParsedEmail
from typing import Any, Optional

from sqlalchemy.orm import Session

from ...models import EmailMessage
from .oauth import _is_expired, _refresh_oauth_access_token
from .tokens import (
    _get_email_sync_config,
    _save_email_sync_config,
    resolve_oauth_tokens,
    store_oauth_tokens_secure,
)

# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


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


# ---------------------------------------------------------------------------
# Connection runtime
# ---------------------------------------------------------------------------


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


# ---------------------------------------------------------------------------
# Low-level IMAP primitives
# ---------------------------------------------------------------------------


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


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


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
