"""IMAP connection, folder listing, and email body fetch.

Depends on: ``tokens``, ``oauth`` (sibling modules).
"""
from __future__ import annotations

import base64
from contextlib import contextmanager
import email
import html
import imaplib
import re
import threading
import time as time_module
from datetime import datetime, timedelta, timezone
from email import policy
from email.header import decode_header, make_header
from email.message import EmailMessage as ParsedEmail
from email.utils import parsedate_to_datetime
from typing import Any, Optional

from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ...models import EmailMessage, EmailReadLog, EmailSyncCursor
from .oauth import _get_active_google_account, _is_expired, _refresh_oauth_access_token
from .tokens import (
    _get_email_sync_config,
    _save_email_sync_config,
    resolve_oauth_tokens,
    store_oauth_tokens_secure,
)

# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

GMAIL_IMAP_DAILY_DOWNLOAD_LIMIT_BYTES = 2500 * 1024 * 1024
GMAIL_IMAP_WARNING_THRESHOLD = 0.8
FULL_CONTENT_BODY_MARKER = "<!-- email-read-mode:full -->"
IMAP_CONNECTION_LOCK_TIMEOUT_SECONDS = 45.0
IMAP_SIMULTANEOUS_CONNECTION_RETRY_DELAYS_SECONDS = (1.0, 2.0)

_IMAP_CONNECTION_LOCK = threading.Lock()


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


def _normalize_content_id(value: Any) -> str:
    raw = str(value or "").strip()
    if raw.startswith("<") and raw.endswith(">"):
        raw = raw[1:-1]
    return raw.strip()


def _format_attachment_size(size_bytes: int) -> str:
    if size_bytes < 1024:
        return f"{size_bytes} B"
    size_kb = size_bytes / 1024
    if size_kb < 1024:
        return f"{size_kb:.1f} KB" if size_kb < 100 else f"{size_kb:.0f} KB"
    size_mb = size_kb / 1024
    return f"{size_mb:.1f} MB" if size_mb < 100 else f"{size_mb:.0f} MB"


def _render_plain_text_body_html(value: str) -> str:
    return f'<pre class="email-send-read-body-pre">{html.escape(str(value or ""))}</pre>'


def _replace_cid_sources(html_body: str, inline_sources: dict[str, str]) -> str:
    if not html_body or not inline_sources:
        return html_body

    def replace(match: re.Match[str]) -> str:
        cid = _normalize_content_id(match.group(1))
        return inline_sources.get(cid, match.group(0))

    return re.sub(r"cid:([^\"'>\s)]+)", replace, html_body, flags=re.IGNORECASE)


def _build_attachment_summary_html(attachments: list[dict[str, Any]]) -> str:
    if not attachments:
        return ""

    rows: list[str] = []
    for item in attachments:
        filename = str(item.get("filename") or "").strip() or "Adjunto"
        content_type = str(item.get("content_type") or "").strip()
        size_bytes = max(0, int(item.get("size_bytes") or 0))
        meta_parts = [part for part in [content_type, _format_attachment_size(size_bytes) if size_bytes > 0 else ""] if part]
        meta_text = " · ".join(meta_parts)
        rows.append(
            (
                f'<li class="email-send-read-body-attachment" data-filename="{html.escape(filename, quote=True)}">'
                f'<span class="email-send-read-body-attachment-copy">'
                f"<strong>{html.escape(filename)}</strong>"
                f'{f"<span>{html.escape(meta_text)}</span>" if meta_text else ""}'
                f"</span>"
                f"</li>"
            )
        )

    return (
        '<section class="email-send-read-body-attachments" data-email-read-attachments="true">'
        "<h4>Adjuntos</h4>"
        f"<ul>{''.join(rows)}</ul>"
        "</section>"
    )


def _extract_body_basic(parsed: ParsedEmail) -> str:
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


def _extract_body_full(parsed: ParsedEmail) -> str:
    plain_parts: list[str] = []
    html_parts: list[str] = []
    inline_sources: dict[str, str] = {}
    attachments: list[dict[str, Any]] = []
    seen_attachment_keys: set[str] = set()

    for part in parsed.walk():
        if part.is_multipart():
            continue

        content_type = str(part.get_content_type() or "").strip().lower()
        disposition = str(part.get_content_disposition() or "").strip().lower()
        filename = _decode_header_text(part.get_filename())
        content_id = _normalize_content_id(part.get("Content-ID"))

        payload_bytes: bytes | None = None
        if disposition == "attachment" or filename or content_id:
            try:
                payload_bytes = part.get_payload(decode=True)
            except Exception:
                payload_bytes = None

        if content_id and content_type.startswith("image/") and payload_bytes:
            inline_sources[content_id] = f"data:{content_type};base64,{base64.b64encode(payload_bytes).decode('ascii')}"

        is_attachment = disposition == "attachment" or bool(filename and not content_type.startswith("text/"))
        if is_attachment:
            attachment_key = f"{filename.lower()}::{content_type}::{len(payload_bytes or b'')}"
            if attachment_key not in seen_attachment_keys:
                seen_attachment_keys.add(attachment_key)
                attachments.append(
                    {
                        "filename": filename or "Adjunto",
                        "content_type": content_type or "application/octet-stream",
                        "size_bytes": len(payload_bytes or b""),
                    }
                )
            continue

        try:
            payload = part.get_content()
        except Exception:
            continue
        if not isinstance(payload, str):
            continue
        if content_type == "text/html":
            html_parts.append(payload)
        elif content_type == "text/plain":
            plain_parts.append(payload)

    body_html = ""
    merged_html = "\n\n".join(part.strip() for part in html_parts if part.strip()).strip()
    if merged_html:
        body_html = _replace_cid_sources(merged_html, inline_sources)
    else:
        merged_plain = "\n\n".join(part.strip() for part in plain_parts if part.strip()).strip()
        if merged_plain:
            body_html = _render_plain_text_body_html(merged_plain)
        else:
            body_html = '<p class="email-send-read-body-empty">Sin contenido.</p>'

    return f"{FULL_CONTENT_BODY_MARKER}{body_html}{_build_attachment_summary_html(attachments)}"


def _extract_body(parsed: ParsedEmail, *, full_content: bool) -> str:
    if full_content:
        return _extract_body_full(parsed)
    return _extract_body_basic(parsed)


def _decode_header_text(value: Any) -> str:
    raw = str(value or "").strip()
    if not raw:
        return ""
    try:
        return str(make_header(decode_header(raw)))
    except Exception:
        return raw


def _parse_email_date(value: Any) -> Optional[datetime]:
    raw = str(value or "").strip()
    if not raw:
        return None
    try:
        parsed = parsedate_to_datetime(raw)
    except Exception:
        return None
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone(timezone.utc).replace(tzinfo=None)
    return parsed


def _parse_folder_list_rows(rows: list[Any]) -> list[str]:
    folders: list[str] = []
    for row in rows or []:
        decoded = row.decode("utf-8", errors="ignore") if isinstance(row, (bytes, bytearray)) else str(row)
        match = re.search(r'"([^\"]+)"\s*$', decoded)
        folder = match.group(1) if match else decoded.rsplit(" ", 1)[-1]
        folder = folder.strip().strip('"')
        if folder and folder not in folders:
            folders.append(folder)
    folders.sort(key=lambda item: item.lower())
    return folders


def _normalize_folder_token(value: str) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip()).lower()


def _imap_mailbox_arg(mailbox: str) -> str:
    value = str(mailbox or "").strip() or "INBOX"
    escaped = value.replace("\\", "\\\\").replace('"', '\\"')
    return f'"{escaped}"'


def _resolve_metadata_folders(
    runtime: dict[str, Any],
    available_folders: list[str],
    requested_folder: Optional[str],
) -> list[str]:
    requested = str(requested_folder or "").strip()
    runtime_folder = str(runtime.get("folder") or "INBOX").strip() or "INBOX"
    normalized_map = {_normalize_folder_token(folder): folder for folder in available_folders}
    resolved: list[str] = []

    def push(folder: str) -> None:
        value = str(folder or "").strip()
        if not value or value in resolved:
            return
        resolved.append(value)

    def push_exact(folder: str) -> bool:
        match = normalized_map.get(_normalize_folder_token(folder))
        if not match:
            return False
        push(match)
        return True

    def push_pattern(pattern: str) -> bool:
        regex = re.compile(pattern, re.IGNORECASE)
        matches = [folder for folder in available_folders if regex.search(folder)]
        for folder in matches:
            push(folder)
        return bool(matches)

    def push_many(folders: list[str]) -> None:
        for folder in folders:
            push(folder)

    def included_for_all(folder: str) -> bool:
        token = _normalize_folder_token(folder)
        excluded_patterns = [
            r"spam",
            r"papelera",
            r"trash",
            r"junk",
            r"deleted",
            r"borrador",
            r"draft",
        ]
        return not any(re.search(pattern, token, re.IGNORECASE) for pattern in excluded_patterns)

    if not requested:
        push_exact(runtime_folder)
        push_pattern(r"(^|/|\[)inbox($|\])")
        push_pattern(r"all\s*mail|(^|/|\[)todos($|\])|todo\s*el\s*correo")
        push_pattern(r"(^|/|\[)archive($|\])|archiv")
        push_pattern(r"sent|enviad")
        push_many([folder for folder in available_folders if included_for_all(folder)])
        if not resolved:
            push(runtime_folder)
        return resolved

    if requested.upper() == "INBOX":
        if not push_exact("INBOX"):
            push_pattern(r"(^|/|\[)inbox($|\])")
        if not resolved:
            push("INBOX")
        return resolved

    if requested.upper() == "SENT":
        if not push_pattern(r"sent|enviad"):
            push("Sent")
        return resolved

    if not push_exact(requested):
        push(requested)
    return resolved


def _parse_search_numbers(data: list[Any]) -> list[bytes]:
    if not data:
        return []
    head = data[0]
    if not head:
        return []
    if isinstance(head, bytes):
        return [item for item in head.split() if item]
    return [str(item).encode("utf-8") for item in str(head).split() if item]


def _message_numbers_for_contact(
    conn: imaplib.IMAP4 | imaplib.IMAP4_SSL,
    contact_email: str,
    since_date: Optional[datetime],
) -> list[bytes]:
    numbers: list[bytes] = []
    seen = set[bytes]()
    for header_name in ("FROM", "TO", "CC"):
        search_args: list[str] = ["HEADER", header_name, f'"{contact_email}"']
        if since_date is not None:
            search_args = ["SINCE", since_date.strftime("%d-%b-%Y"), *search_args]
        status, data = conn.search(None, *search_args)
        if status != "OK":
            continue
        for number in _parse_search_numbers(data):
            if number in seen:
                continue
            seen.add(number)
            numbers.append(number)
    numbers.sort(key=lambda item: int(item))
    return numbers


def _parse_fetch_header_response(fetched: list[Any]) -> tuple[Optional[bytes], bool]:
    header_bytes: Optional[bytes] = None
    is_seen = False
    for item in fetched or []:
        if not isinstance(item, tuple) or len(item) < 2:
            continue
        meta = item[0]
        payload = item[1]
        meta_text = meta.decode("utf-8", errors="ignore") if isinstance(meta, (bytes, bytearray)) else str(meta)
        if "\\Seen" in meta_text:
            is_seen = True
        if isinstance(payload, (bytes, bytearray)):
            header_bytes = bytes(payload)
    return header_bytes, is_seen


def _daily_window_utc() -> tuple[datetime, datetime]:
    now = datetime.now(timezone.utc)
    start = datetime(year=now.year, month=now.month, day=now.day, tzinfo=timezone.utc)
    end = start + timedelta(days=1)
    return start.replace(tzinfo=None), end.replace(tzinfo=None)


def _upsert_email_sync_cursor(
    db: Session,
    contact_id: str,
    folder: str,
    *,
    last_synced_at: Optional[datetime],
    full_history_synced_at: Optional[datetime] = None,
) -> None:
    normalized_folder = str(folder or "").strip() or "INBOX"
    if last_synced_at is None and full_history_synced_at is None:
        return

    try:
        with db.begin_nested():
            cursor = (
                db.query(EmailSyncCursor)
                .filter(EmailSyncCursor.contact_id == contact_id, EmailSyncCursor.folder == normalized_folder)
                .first()
            )
            if cursor:
                if last_synced_at and (cursor.last_synced_at is None or last_synced_at > cursor.last_synced_at):
                    cursor.last_synced_at = last_synced_at
                if full_history_synced_at and (
                    cursor.full_history_synced_at is None or full_history_synced_at > cursor.full_history_synced_at
                ):
                    cursor.full_history_synced_at = full_history_synced_at
            else:
                db.add(
                    EmailSyncCursor(
                        contact_id=contact_id,
                        folder=normalized_folder,
                        last_synced_at=last_synced_at or full_history_synced_at or datetime.utcnow(),
                        full_history_synced_at=full_history_synced_at,
                    )
                )
            db.flush()
    except IntegrityError:
        cursor = (
            db.query(EmailSyncCursor)
            .filter(EmailSyncCursor.contact_id == contact_id, EmailSyncCursor.folder == normalized_folder)
            .first()
        )
        if not cursor:
            return
        if last_synced_at and (cursor.last_synced_at is None or last_synced_at > cursor.last_synced_at):
            cursor.last_synced_at = last_synced_at
        if full_history_synced_at and (
            cursor.full_history_synced_at is None or full_history_synced_at > cursor.full_history_synced_at
        ):
            cursor.full_history_synced_at = full_history_synced_at


def _normalize_read_account_id(runtime: dict[str, Any]) -> str:
    return str(runtime.get("username") or "").strip().lower()


def _read_limit_bytes(runtime: dict[str, Any]) -> int:
    provider = str(runtime.get("provider") or "").strip().lower()
    host = str(runtime.get("host") or "").strip().lower()
    if provider == "oauth_google" or host == "imap.gmail.com":
        return GMAIL_IMAP_DAILY_DOWNLOAD_LIMIT_BYTES
    return 0


def _format_runtime_error(prefix: str, exc: Exception) -> str:
    detail = str(exc).strip() or exc.__class__.__name__
    return f"{prefix}: {detail}"


def _safe_resolve_connection_runtime(
    db: Session,
    override: Optional[dict[str, Any]] = None,
) -> tuple[bool, str, dict[str, Any]]:
    try:
        return _resolve_connection_runtime(db, override)
    except Exception as exc:
        return False, _format_runtime_error("IMAP runtime setup failed", exc), {}


def _record_read_usage(
    db: Session,
    runtime: dict[str, Any],
    operation: str,
    folder: str,
    message_count: int,
    bytes_downloaded: int,
) -> None:
    account_id = _normalize_read_account_id(runtime)
    if not account_id:
        return
    safe_bytes = max(0, int(bytes_downloaded or 0))
    safe_count = max(0, int(message_count or 0))
    if safe_bytes <= 0 and safe_count <= 0:
        return

    bind = db.get_bind()
    if bind is None:
        return

    try:
        with Session(bind=bind) as audit_db:
            audit_db.add(
                EmailReadLog(
                    provider=str(runtime.get("provider") or "none"),
                    account_id=account_id,
                    operation=str(operation or "metadata"),
                    folder=str(folder or "").strip() or None,
                    message_count=safe_count,
                    bytes_downloaded=safe_bytes,
                )
            )
            audit_db.commit()
    except Exception:
        # Read telemetry must never block the mailbox UX.
        return


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
        if provider == "oauth_google" and override is None:
            active_account = _get_active_google_account(db)
            if active_account:
                username = active_account
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


def _close_imap_connection(conn: imaplib.IMAP4 | imaplib.IMAP4_SSL | None) -> None:
    if conn is None:
        return
    try:
        conn.close()
    except Exception:
        pass
    try:
        conn.logout()
    except Exception:
        pass


def _is_too_many_connections_error(exc: Exception) -> bool:
    message = str(exc).strip().lower()
    return "too many simultaneous connections" in message


def _imap_connect_and_auth(runtime: dict[str, Any]) -> imaplib.IMAP4 | imaplib.IMAP4_SSL:
    retry_delays = (0.0, *IMAP_SIMULTANEOUS_CONNECTION_RETRY_DELAYS_SECONDS)
    for attempt_index, delay in enumerate(retry_delays):
        conn: imaplib.IMAP4 | imaplib.IMAP4_SSL | None = None
        if delay > 0:
            # Give the provider a moment to release previous IMAP sessions.
            time_module.sleep(delay)
        try:
            conn = _open_imap(runtime["host"], int(runtime["port"]), bool(runtime["use_ssl"]))
            if runtime["mode"] == "oauth":
                _imap_auth_oauth(conn, runtime["username"], runtime["access_token"])
            else:
                _imap_auth_password(conn, runtime["username"], runtime["password"])
            return conn
        except Exception as exc:
            _close_imap_connection(conn)
            should_retry = attempt_index < len(retry_delays) - 1 and _is_too_many_connections_error(exc)
            if should_retry:
                continue
            raise

    raise RuntimeError("IMAP connection failed")


@contextmanager
def _imap_session(runtime: dict[str, Any]):
    acquired = _IMAP_CONNECTION_LOCK.acquire(timeout=IMAP_CONNECTION_LOCK_TIMEOUT_SECONDS)
    if not acquired:
        raise RuntimeError("IMAP mailbox busy. Another sync is still running.")

    conn: imaplib.IMAP4 | imaplib.IMAP4_SSL | None = None
    try:
        conn = _imap_connect_and_auth(runtime)
        yield conn
    finally:
        _close_imap_connection(conn)
        _IMAP_CONNECTION_LOCK.release()


def _imap_list_folders(runtime: dict[str, Any]) -> tuple[bool, str, list[str]]:
    with _imap_session(runtime) as conn:
        status, rows = conn.list()
        if status != "OK":
            return False, "Connected but unable to list folders", []
        folders = _parse_folder_list_rows(rows or [])
        return True, "IMAP folders loaded", folders


def _imap_fetch_body(
    runtime: dict[str, Any],
    folder: str,
    message_id: str,
    *,
    full_content: bool,
) -> tuple[Optional[str], int]:
    with _imap_session(runtime) as conn:
        status, _ = conn.select(_imap_mailbox_arg(folder), readonly=True)
        if status != "OK":
            return None, 0

        normalized = _normalize_message_id(message_id)
        status, data = conn.search(None, "HEADER", "Message-ID", f'"{normalized}"')
        if status != "OK" or not data or not data[0]:
            return None, 0

        message_num = data[0].split()[-1]
        status, fetched = conn.fetch(message_num, "(RFC822)")
        if status != "OK" or not fetched:
            return None, 0

        raw_bytes: bytes | None = None
        for item in fetched:
            if isinstance(item, tuple) and len(item) >= 2 and isinstance(item[1], (bytes, bytearray)):
                raw_bytes = bytes(item[1])
                break
        if not raw_bytes:
            return None, 0

        parsed = email.message_from_bytes(raw_bytes, policy=policy.default)
        body = _extract_body(parsed, full_content=full_content)
        return body or None, len(raw_bytes)


def _imap_list_metadata_for_contact(
    conn: imaplib.IMAP4 | imaplib.IMAP4_SSL,
    db: Session,
    runtime: dict[str, Any],
    contact_email: str,
    requested_folder: Optional[str],
    limit: Optional[int],
    start_date: Optional[datetime],
) -> list[dict[str, Any]]:
    status, rows = conn.list()
    available_folders = _parse_folder_list_rows(rows or []) if status == "OK" else []
    candidate_folders = _resolve_metadata_folders(runtime, available_folders, requested_folder)
    if not candidate_folders:
        candidate_folders = [str(runtime.get("folder") or "INBOX").strip() or "INBOX"]

    messages: list[dict[str, Any]] = []
    downloaded_bytes = 0
    fetched_headers = 0
    sync_completed_at = datetime.utcnow()
    cursor_dirty = False

    for folder in candidate_folders:
        select_status, _ = conn.select(_imap_mailbox_arg(folder), readonly=True)
        if select_status != "OK":
            continue

        cursor = (
            db.query(EmailSyncCursor)
            .filter(EmailSyncCursor.contact_id == contact_email, EmailSyncCursor.folder == folder)
            .first()
        )
        normalized_start_date = start_date.replace(tzinfo=None) if start_date and start_date.tzinfo is not None else start_date
        needs_full_history = normalized_start_date is None and (cursor is None or cursor.full_history_synced_at is None)
        since_date: Optional[datetime] = normalized_start_date
        if since_date is None and not needs_full_history and cursor and cursor.last_synced_at:
            since_date = cursor.last_synced_at - timedelta(days=1)

        message_numbers = _message_numbers_for_contact(conn, contact_email, since_date)
        if limit is not None:
            message_numbers = message_numbers[-max(1, min(limit, 5000)) :]

        folder_max_seen_date: Optional[datetime] = None
        if not message_numbers:
            if needs_full_history and limit is None and normalized_start_date is None:
                _upsert_email_sync_cursor(
                    db,
                    contact_email,
                    folder,
                    last_synced_at=sync_completed_at,
                    full_history_synced_at=sync_completed_at,
                )
                cursor_dirty = True
            continue

        for number in reversed(message_numbers):
            fetch_status, fetched = conn.fetch(number, "(BODY.PEEK[HEADER.FIELDS (MESSAGE-ID FROM TO CC SUBJECT DATE)] FLAGS)")
            if fetch_status != "OK" or not fetched:
                continue
            header_bytes, is_seen = _parse_fetch_header_response(fetched)
            if not header_bytes:
                continue
            downloaded_bytes += len(header_bytes)
            fetched_headers += 1
            try:
                parsed = email.message_from_bytes(header_bytes, policy=policy.default)
            except Exception:
                continue

            message_id = _normalize_message_id(str(parsed.get("Message-ID") or "").strip())
            if not message_id:
                continue

            message_date = _parse_email_date(parsed.get("Date"))
            if message_date is None:
                continue
            if normalized_start_date is not None and message_date < normalized_start_date:
                continue
            if folder_max_seen_date is None or message_date > folder_max_seen_date:
                folder_max_seen_date = message_date

            messages.append(
                {
                    "message_id": message_id,
                    "from_address": _decode_header_text(parsed.get("From")),
                    "to_address": " ".join(
                        part
                        for part in (
                            _decode_header_text(parsed.get("To")),
                            _decode_header_text(parsed.get("Cc")),
                        )
                        if part
                    ),
                    "subject": _decode_header_text(parsed.get("Subject")),
                    "date": message_date,
                    "is_read": is_seen,
                    "folder": folder,
                }
            )

        _upsert_email_sync_cursor(
            db,
            contact_email,
            folder,
            last_synced_at=folder_max_seen_date,
            full_history_synced_at=sync_completed_at if needs_full_history and limit is None and normalized_start_date is None else None,
        )
        cursor_dirty = True

    if cursor_dirty:
        db.commit()

    _record_read_usage(
        db,
        runtime=runtime,
        operation="metadata",
        folder=requested_folder or "ALL",
        message_count=fetched_headers,
        bytes_downloaded=downloaded_bytes,
    )

    deduped: dict[str, dict[str, Any]] = {}
    for item in sorted(messages, key=lambda row: row["date"], reverse=True):
        message_id = _normalize_message_id(str(item.get("message_id") or "").strip())
        if not message_id or message_id in deduped:
            continue
        deduped[message_id] = item
        if limit is not None and len(deduped) >= max(1, min(limit, 5000)):
            break
    return list(deduped.values())


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def fetch_email_body_from_provider(db: Session, message: EmailMessage, *, full_content: bool = False) -> Optional[str]:
    ok, _, runtime = _safe_resolve_connection_runtime(db, None)
    if not ok:
        return None
    folder = (message.folder or "INBOX").strip() or "INBOX"

    try:
        body, downloaded_bytes = _imap_fetch_body(
            runtime=runtime,
            folder=folder,
            message_id=message.message_id,
            full_content=full_content,
        )
        _record_read_usage(
            db,
            runtime=runtime,
            operation="body",
            folder=folder,
            message_count=1 if downloaded_bytes > 0 else 0,
            bytes_downloaded=downloaded_bytes,
        )
        return body
    except Exception:
        return None


def list_email_metadata_from_provider(
    db: Session,
    contact_email: str,
    folder: Optional[str] = None,
    limit: Optional[int] = None,
    start_date: Optional[datetime] = None,
) -> tuple[bool, str, list[dict[str, Any]]]:
    target_email = str(contact_email or "").strip()
    if not target_email:
        return False, "Missing contact email", []

    ok, message, runtime = _safe_resolve_connection_runtime(db, None)
    if not ok:
        return False, message, []

    try:
        with _imap_session(runtime) as conn:
            try:
                rows = _imap_list_metadata_for_contact(
                    conn=conn,
                    db=db,
                    runtime=runtime,
                    contact_email=target_email,
                    requested_folder=folder,
                    limit=limit,
                    start_date=start_date,
                )
            except Exception as exc:
                return False, f"IMAP metadata sync failed: {exc}", []
    except Exception as exc:
        return False, _format_runtime_error("IMAP connection failed", exc), []
    return True, "IMAP metadata loaded", rows


def get_email_read_stats(db: Session) -> dict[str, Any]:
    ok, message, runtime = _safe_resolve_connection_runtime(db, None)
    if not ok:
        return {
            "connected": False,
            "provider": "none",
            "account_id": "",
            "downloaded_today_bytes": 0,
            "remaining_today_bytes": 0,
            "daily_limit_bytes": 0,
            "used_percent": 0.0,
            "tracked_by_app": True,
            "warning": message,
            "limit_label": None,
        }

    provider = str(runtime.get("provider") or "none")
    account_id = _normalize_read_account_id(runtime)
    daily_limit_bytes = _read_limit_bytes(runtime)
    start, end = _daily_window_utc()
    downloaded_today = (
        db.query(func.coalesce(func.sum(EmailReadLog.bytes_downloaded), 0))
        .filter(
            EmailReadLog.provider == provider,
            EmailReadLog.account_id == account_id,
            EmailReadLog.created_at >= start,
            EmailReadLog.created_at < end,
        )
        .scalar()
        or 0
    )
    downloaded_today = int(downloaded_today)

    if daily_limit_bytes <= 0:
        return {
            "connected": True,
            "provider": provider,
            "account_id": account_id,
            "downloaded_today_bytes": downloaded_today,
            "remaining_today_bytes": 0,
            "daily_limit_bytes": 0,
            "used_percent": 0.0,
            "tracked_by_app": True,
            "warning": "No hay un límite diario de lectura conocido para el proveedor activo.",
            "limit_label": None,
        }

    remaining_today = max(0, daily_limit_bytes - downloaded_today)
    used_percent = round((downloaded_today / daily_limit_bytes) * 100, 1) if daily_limit_bytes > 0 else 0.0
    warning: Optional[str] = None
    if downloaded_today >= daily_limit_bytes:
        warning = "Límite diario estimado de lectura IMAP de Gmail alcanzado."
    elif downloaded_today >= int(daily_limit_bytes * GMAIL_IMAP_WARNING_THRESHOLD):
        warning = f"Acercándote al límite diario estimado de lectura de Gmail: {used_percent:.1f}% usado."

    return {
        "connected": True,
        "provider": provider,
        "account_id": account_id,
        "downloaded_today_bytes": downloaded_today,
        "remaining_today_bytes": remaining_today,
        "daily_limit_bytes": daily_limit_bytes,
        "used_percent": used_percent,
        "tracked_by_app": True,
        "warning": warning,
        "limit_label": "Descarga diaria IMAP de Gmail",
    }


def test_email_provider_connection(db: Session, config: dict[str, Any]) -> tuple[bool, str]:
    ok, message, runtime = _safe_resolve_connection_runtime(db, config)
    if not ok:
        return False, message

    try:
        with _imap_session(runtime) as conn:
            status, _ = conn.select(_imap_mailbox_arg(runtime["folder"]), readonly=True)
            if status != "OK":
                return False, f"Connected but unable to open folder '{runtime['folder']}'"
            return True, "IMAP connection successful"
    except Exception as exc:
        return False, _format_runtime_error("IMAP authentication/select failed", exc)


def list_email_provider_folders(db: Session, config: dict[str, Any]) -> tuple[bool, str, list[str]]:
    ok, message, runtime = _safe_resolve_connection_runtime(db, config)
    if not ok:
        return False, message, []
    try:
        return _imap_list_folders(runtime)
    except Exception as exc:
        return False, f"IMAP LIST failed: {exc}", []
