"""Gmail sending, email campaigns, templates, and contacts.

Depends on: ``tokens``, ``oauth`` (sibling modules).
"""
from __future__ import annotations

import base64
from datetime import datetime, timedelta, timezone
import json
import os
import random
import re
import time
import urllib.error
import urllib.request
import uuid
from email.message import EmailMessage as MimeEmailMessage
from html.parser import HTMLParser
from typing import Any, Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from ...models import Application, EmailSendLog
from ...utils import parse_json_list, parse_properties_json
from .oauth import (
    GOOGLE_GMAIL_SEND_SCOPE,
    _is_expired,
    _post_json,
    _refresh_oauth_access_token,
    get_google_send_email,
    get_valid_google_send_access_token,
    _get_active_google_account,
)
from .tokens import (
    _get_email_sync_config,
    _save_email_sync_config,
    resolve_oauth_tokens,
    store_oauth_tokens_secure,
)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

GMAIL_SEND_ENDPOINT = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send"
EMAIL_DAILY_LIMIT = 500
EMAIL_DAILY_WARNING_THRESHOLD = 450
GMAIL_RETRYABLE_STATUS = {429, 500, 502, 503, 504}

# ---------------------------------------------------------------------------
# HTML detection & plain-text extraction
# ---------------------------------------------------------------------------

_HTML_TAG_RE = re.compile(r"<(?:p|div|br|h[1-6]|ul|ol|li|a|strong|em|span|table|img)[\s>/]", re.IGNORECASE)


def _looks_like_html(text: str) -> bool:
    """Return True if *text* appears to contain meaningful HTML tags."""
    return bool(_HTML_TAG_RE.search(text or ""))


class _HTMLTextExtractor(HTMLParser):
    """Minimal HTML→plain-text converter for the email fallback."""

    def __init__(self) -> None:
        super().__init__()
        self._pieces: list[str] = []

    def handle_data(self, data: str) -> None:
        self._pieces.append(data)

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in ("br", "p", "div", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6"):
            self._pieces.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag in ("p", "div", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6"):
            self._pieces.append("\n")

    def get_text(self) -> str:
        return re.sub(r"\n{3,}", "\n\n", "".join(self._pieces)).strip()


def _html_to_plain(html: str) -> str:
    """Best-effort HTML→plain-text conversion (no external deps)."""
    extractor = _HTMLTextExtractor()
    extractor.feed(html)
    return extractor.get_text()


def _build_mime_email(
    to: str, from_addr: str, subject: str, body: str,
) -> MimeEmailMessage:
    """Build a MimeEmailMessage, sending as HTML with plain-text fallback
    when *body* contains HTML tags, otherwise plain text."""
    mime = MimeEmailMessage()
    mime["To"] = to
    if from_addr and "@" in from_addr:
        mime["From"] = from_addr
    mime["Subject"] = subject

    if _looks_like_html(body):
        plain = _html_to_plain(body)
        mime.set_content(plain)
        mime.add_alternative(body, subtype="html")
    else:
        mime.set_content(body)
    return mime

# ---------------------------------------------------------------------------
# Validation / simple send
# ---------------------------------------------------------------------------


def validate_no_header_injection(value: str, field_name: str) -> None:
    if "\r" in value or "\n" in value:
        raise ValueError(f"Invalid {field_name}: header injection detected")


def send_gmail_message(access_token: str, to_email: str, subject: str, body: str, from_email: str = "") -> tuple[bool, str, str]:
    mime = _build_mime_email(to=to_email, from_addr=from_email.strip(), subject=subject, body=body)
    return _gmail_send_message(access_token=access_token, mime_bytes=mime.as_bytes())


# ---------------------------------------------------------------------------
# Templates
# ---------------------------------------------------------------------------


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


# ---------------------------------------------------------------------------
# Contacts
# ---------------------------------------------------------------------------


def list_tracker_contacts_for_email(db: Session, limit: int = 1000) -> list[dict[str, Any]]:
    from ...settings_store import get_settings as _get_all_settings

    rows = (
        db.query(Application)
        .order_by(Application.updated_at.desc(), Application.id.desc())
        .limit(max(1, min(limit, 5000)))
        .all()
    )

    # Build a lookup from property key → human-readable name
    all_settings = _get_all_settings(db)
    custom_props = all_settings.get("custom_properties", [])
    prop_label_map: dict[str, str] = {}
    if isinstance(custom_props, list):
        for prop in custom_props:
            if isinstance(prop, dict) and prop.get("key") and prop.get("name"):
                prop_label_map[str(prop["key"])] = str(prop["name"])

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

            # Start with ALL standard Application-level fields so they
            # are available as merge-tag variables in email templates.
            custom_fields: dict[str, str] = {}

            # -- Standard application columns ---------------------------------
            _app_fields = {
                "Posición": row.position,
                "Tipo de empleo": row.job_type,
                "Ubicación": row.location,
                "Etapa": row.stage,
                "Resultado": row.outcome,
                "Fecha aplicación": str(row.application_date or ""),
                "Fecha entrevista": str(row.interview_datetime or ""),
                "Fecha seguimiento": str(row.followup_date or ""),
                "Rondas entrevista": str(row.interview_rounds or ""),
                "Tipo entrevista": row.interview_type,
                "Entrevistadores": row.interviewers,
                "Puntuación empresa": str(row.company_score or ""),
                "Última ronda superada": row.last_round_cleared,
                "Total rondas": str(row.total_rounds or ""),
                "Mi puntuación": str(row.my_interview_score or ""),
                "Áreas de mejora": row.improvement_areas,
                "Skill a mejorar": row.skill_to_upgrade,
                "Notas": row.notes,
            }
            for field_key, field_val in _app_fields.items():
                text = str(field_val or "").strip()
                if text and text not in ("None", "0", "0.0"):
                    custom_fields[field_key] = text

            # -- Custom properties from properties_json (resolve IDs to names)
            for custom_key, custom_value in app_properties.items():
                if custom_value is None:
                    continue
                # Resolve raw property key to human-readable name if possible
                display_key = prop_label_map.get(str(custom_key), str(custom_key))
                custom_fields[display_key] = str(custom_value)

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


# ---------------------------------------------------------------------------
# Google Send auth resolution
# ---------------------------------------------------------------------------


def _resolve_google_send_auth(db: Session) -> tuple[bool, str, dict[str, Any]]:
    cfg = _get_email_sync_config(db, None)

    # --- Multi-account: prefer the explicitly selected active account ---
    active_account = _get_active_google_account(db)

    imap_cfg = cfg.get("imap") if isinstance(cfg.get("imap"), dict) else {}
    sender_email = str(imap_cfg.get("username") or "").strip()
    if not sender_email:
        sender_email = str(os.getenv("GOOGLE_SENDER_EMAIL", "") or "").strip()
    if not sender_email:
        sender_email = active_account or get_google_send_email()
    if not sender_email:
        sender_email = "oauth-google"

    # Override sender with the active multi-account selection
    if active_account:
        sender_email = active_account

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


# ---------------------------------------------------------------------------
# Low-level Gmail API send
# ---------------------------------------------------------------------------


def _gmail_send_message(access_token: str, mime_bytes: bytes) -> tuple[bool, str, str]:
    raw = base64.urlsafe_b64encode(mime_bytes).decode("utf-8")
    attempts = 4
    last_message = "Send failed"
    retries_done = 0
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

        # 403 with "insufficient authentication scopes" is NOT retryable – the
        # token simply doesn't carry the gmail.send scope.  Return a specific,
        # actionable error so the UI can guide the user.
        if status_code == 403 and "scope" in message_lower:
            return False, (
                f"{message}. El token OAuth no incluye el permiso gmail.send. "
                "Verifica que la Gmail API esté habilitada en Google Cloud Console, "
                "desconecta la cuenta y vuelve a autorizar."
            ), ""

        retryable = bool(status_code in GMAIL_RETRYABLE_STATUS) or "rate" in message_lower or "quota" in message_lower
        if not retryable or attempt >= attempts - 1:
            break

        retries_done += 1
        backoff_seconds = min(8.0, (2 ** attempt) + random.uniform(0.1, 0.9))
        time.sleep(backoff_seconds)

    suffix = f" (after {retries_done} retries)" if retries_done else ""
    return False, f"{last_message}{suffix}", ""


# ---------------------------------------------------------------------------
# Stats & campaign
# ---------------------------------------------------------------------------


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

        mime = _build_mime_email(to=recipient, from_addr=sent_by, subject=subject, body=body)

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
