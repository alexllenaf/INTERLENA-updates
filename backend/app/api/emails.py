from __future__ import annotations

import html
import secrets
import time
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import HTMLResponse
from sqlalchemy.orm import Session

from ..crud import (
    fetch_and_cache_email_body,
    get_email_body,
    list_email_metadata,
    sync_email_metadata,
    upsert_email_body_once,
)
from ..db import get_db
from ..settings_store import get_settings as load_settings, save_settings
from ..schemas import (
    EmailBodyOut,
    EmailConnectionTestIn,
    EmailConnectionTestOut,
    EmailSendBatchIn,
    EmailSendBatchOut,
    EmailSendContactOut,
    EmailSendStatsOut,
    EmailFoldersListOut,
    EmailOAuthStartIn,
    EmailOAuthStartOut,
    EmailBodyUpsertIn,
    EmailMetadataOut,
    EmailMetadataSyncIn,
    EmailMetadataSyncOut,
)
from ..services.emails import (
    build_oauth_authorization_url,
    exchange_oauth_authorization_code,
    get_email_send_stats,
    list_email_provider_folders,
    list_tracker_contacts_for_email,
    send_gmail_campaign,
    store_oauth_tokens_secure,
    _resolve_google_send_auth,
    test_email_provider_connection,
)

router = APIRouter(prefix="/api/email", tags=["email"])

_OAUTH_PENDING: dict[str, dict[str, str | float]] = {}
_OAUTH_PENDING_TTL_SECONDS = 600
_READ_PARKED_MESSAGE = "Lectura de correos aparcada temporalmente. Solo envío habilitado."


def _is_read_enabled(db: Session) -> bool:
    settings = load_settings(db)
    if not isinstance(settings, dict):
        return False
    email_sync = settings.get("email_sync")
    if not isinstance(email_sync, dict):
        return False
    return bool(email_sync.get("read_enabled"))


def _cleanup_oauth_pending() -> None:
    now = time.time()
    stale = [state for state, payload in _OAUTH_PENDING.items() if now - float(payload.get("created_at", 0)) > _OAUTH_PENDING_TTL_SECONDS]
    for state in stale:
        _OAUTH_PENDING.pop(state, None)


@router.post("/oauth/start", response_model=EmailOAuthStartOut)
def oauth_start_api(payload: EmailOAuthStartIn, request: Request, db: Session = Depends(get_db)) -> EmailOAuthStartOut:
    provider = (payload.provider or "").strip().lower()
    if provider not in {"oauth_google", "oauth_microsoft"}:
        raise HTTPException(status_code=400, detail="Unsupported OAuth provider")

    _cleanup_oauth_pending()
    state = secrets.token_urlsafe(24)
    default_redirect = str(request.url_for("oauth_callback_api", provider=provider))
    redirect_uri = (payload.redirect_uri or default_redirect).strip()
    tenant_id = (payload.tenant_id or "common").strip() or "common"

    ok, message, auth_url = build_oauth_authorization_url(
        provider=provider,
        client_id=payload.client_id,
        redirect_uri=redirect_uri,
        state=state,
        tenant_id=tenant_id,
        scope_override=(payload.scope or None),
    )
    if not ok:
        raise HTTPException(status_code=400, detail=message)

    _OAUTH_PENDING[state] = {
        "provider": provider,
        "client_id": payload.client_id,
        "client_secret": payload.client_secret,
        "redirect_uri": redirect_uri,
        "tenant_id": tenant_id,
        "scope": (payload.scope or "").strip(),
        "created_at": time.time(),
    }

    return EmailOAuthStartOut(ok=True, provider=provider, message="OAuth URL generated", state=state, auth_url=auth_url)


@router.get("/oauth/callback/{provider}", response_class=HTMLResponse)
def oauth_callback_api(
    provider: str,
    code: Optional[str] = Query(None),
    state: Optional[str] = Query(None),
    error: Optional[str] = Query(None),
    db: Session = Depends(get_db),
) -> HTMLResponse:
    safe_provider = (provider or "").strip().lower()
    if error:
        return HTMLResponse(
            f"<html><body><h2>OAuth failed</h2><p>{html.escape(error)}</p><p>You can close this window.</p></body></html>",
            status_code=400,
        )
    if not state or not code:
        return HTMLResponse(
            "<html><body><h2>OAuth failed</h2><p>Missing code/state.</p><p>You can close this window.</p></body></html>",
            status_code=400,
        )

    _cleanup_oauth_pending()
    pending = _OAUTH_PENDING.pop(state, None)
    if not pending:
        return HTMLResponse(
            "<html><body><h2>OAuth failed</h2><p>State expired or invalid.</p><p>You can close this window.</p></body></html>",
            status_code=400,
        )
    if str(pending.get("provider") or "") != safe_provider:
        return HTMLResponse(
            "<html><body><h2>OAuth failed</h2><p>Provider mismatch.</p><p>You can close this window.</p></body></html>",
            status_code=400,
        )

    ok, message, token_data = exchange_oauth_authorization_code(
        provider=safe_provider,
        code=code,
        client_id=str(pending.get("client_id") or ""),
        client_secret=str(pending.get("client_secret") or ""),
        redirect_uri=str(pending.get("redirect_uri") or ""),
        tenant_id=str(pending.get("tenant_id") or "common"),
    )
    if not ok:
        return HTMLResponse(
            f"<html><body><h2>OAuth failed</h2><p>{html.escape(message)}</p><p>You can close this window.</p></body></html>",
            status_code=400,
        )

    settings = load_settings(db)
    email_sync = settings.get("email_sync") if isinstance(settings, dict) else {}
    email_sync = dict(email_sync) if isinstance(email_sync, dict) else {}
    oauth_root = email_sync.get("oauth") if isinstance(email_sync.get("oauth"), dict) else {}
    oauth_root = dict(oauth_root)
    providers = oauth_root.get("providers") if isinstance(oauth_root.get("providers"), dict) else {}
    providers = dict(providers)

    provider_cfg = providers.get(safe_provider) if isinstance(providers.get(safe_provider), dict) else {}
    provider_cfg = dict(provider_cfg)
    account_hint = ""
    if isinstance(email_sync.get("imap"), dict):
        account_hint = str((email_sync.get("imap") or {}).get("username") or "")

    refresh_token_value = str(token_data.get("refresh_token") or provider_cfg.get("refresh_token") or "")
    store_oauth_tokens_secure(
        provider=safe_provider,
        provider_cfg=provider_cfg,
        access_token=str(token_data.get("access_token") or ""),
        refresh_token=refresh_token_value,
        account_hint=account_hint,
    )
    provider_cfg.update(
        {
            "client_id": str(pending.get("client_id") or ""),
            "client_secret": str(pending.get("client_secret") or ""),
            "redirect_uri": str(pending.get("redirect_uri") or ""),
            "tenant_id": str(pending.get("tenant_id") or "common"),
            "token_type": str(token_data.get("token_type") or provider_cfg.get("token_type") or "Bearer"),
            "scope": str(token_data.get("scope") or provider_cfg.get("scope") or ""),
            "expires_at": str(token_data.get("expires_at") or ""),
        }
    )
    providers[safe_provider] = provider_cfg
    oauth_root["providers"] = providers
    email_sync["oauth"] = oauth_root
    email_sync["provider"] = safe_provider
    save_settings(db, {"email_sync": email_sync})

    return HTMLResponse(
        f"<html><body><h2>OAuth connected</h2><p>{html.escape(message)}</p><p>Provider: {html.escape(safe_provider)}</p><p>You can close this window and return to the app.</p></body></html>",
        status_code=200,
    )


@router.get("/send/contacts-source", response_model=List[EmailSendContactOut])
def list_send_contacts_source_api(
    limit: int = Query(500, ge=1, le=5000),
    db: Session = Depends(get_db),
) -> List[EmailSendContactOut]:
    rows = list_tracker_contacts_for_email(db, limit=limit)
    return [EmailSendContactOut(**row) for row in rows]


@router.get("/send/stats", response_model=EmailSendStatsOut)
def get_send_stats_api(db: Session = Depends(get_db)) -> EmailSendStatsOut:
    ok, message, auth = _resolve_google_send_auth(db)
    sent_by = str(auth.get("sent_by") or "") if ok else ""
    if not ok or not sent_by:
        return EmailSendStatsOut(
            connected=False,
            sent_by=sent_by,
            sent_today=0,
            remaining_today=0,
            daily_limit=500,
            warning=message,
        )
    data = get_email_send_stats(db, sent_by)
    return EmailSendStatsOut(connected=True, **data)


@router.post("/send/batch", response_model=EmailSendBatchOut)
def send_batch_api(payload: EmailSendBatchIn, db: Session = Depends(get_db)) -> EmailSendBatchOut:
    result = send_gmail_campaign(
        db,
        subject_template=payload.subject_template,
        body_template=payload.body_template,
        contacts=[item.model_dump() for item in payload.contacts],
    )
    return EmailSendBatchOut(**result)


@router.post("/test-connection", response_model=EmailConnectionTestOut)
def test_connection_api(payload: EmailConnectionTestIn, db: Session = Depends(get_db)) -> EmailConnectionTestOut:
    config = payload.model_dump()
    ok, message = test_email_provider_connection(db, config)
    return EmailConnectionTestOut(ok=ok, provider=(payload.provider or "none"), message=message)


@router.post("/list-folders", response_model=EmailFoldersListOut)
def list_folders_api(payload: EmailConnectionTestIn, db: Session = Depends(get_db)) -> EmailFoldersListOut:
    config = payload.model_dump()
    ok, message, folders = list_email_provider_folders(db, config)
    return EmailFoldersListOut(
        ok=ok,
        provider=(payload.provider or "none"),
        message=message,
        folders=folders,
    )


@router.post("/sync-metadata", response_model=EmailMetadataSyncOut)
def sync_metadata_api(payload: EmailMetadataSyncIn, db: Session = Depends(get_db)) -> EmailMetadataSyncOut:
    if not _is_read_enabled(db):
        raise HTTPException(status_code=501, detail=_READ_PARKED_MESSAGE)
    result = sync_email_metadata(
        db,
        contact_id=payload.contact_id,
        folder=payload.folder,
        messages=[item.model_dump() for item in payload.messages],
    )
    return EmailMetadataSyncOut(**result)


@router.get("/messages", response_model=List[EmailMetadataOut])
def list_messages_api(
    contact_id: str = Query(...),
    folder: Optional[str] = Query(None),
    limit: int = Query(200, ge=1, le=500),
    db: Session = Depends(get_db),
) -> List[EmailMetadataOut]:
    if not _is_read_enabled(db):
        raise HTTPException(status_code=501, detail=_READ_PARKED_MESSAGE)
    rows = list_email_metadata(db, contact_id=contact_id, folder=folder, limit=limit)
    return [
        EmailMetadataOut(
            message_id=row.message_id,
            contact_id=row.contact_id,
            from_address=row.from_address,
            to_address=row.to_address,
            subject=row.subject,
            date=row.date,
            is_read=bool(row.is_read),
            folder=row.folder,
            body_cached=bool(row.body),
        )
        for row in rows
    ]


@router.get("/messages/{message_id}/body", response_model=EmailBodyOut)
def get_message_body_api(message_id: str, db: Session = Depends(get_db)) -> EmailBodyOut:
    if not _is_read_enabled(db):
        raise HTTPException(status_code=501, detail=_READ_PARKED_MESSAGE)
    body = get_email_body(db, message_id)
    if body is not None:
        return EmailBodyOut(message_id=message_id, body=body, cached=True)

    fetched = fetch_and_cache_email_body(db, message_id)
    if not fetched:
        raise HTTPException(status_code=404, detail="Email body not available")
    return EmailBodyOut(**fetched)


@router.put("/messages/{message_id}/body", response_model=EmailBodyOut)
def upsert_message_body_api(
    message_id: str,
    payload: EmailBodyUpsertIn,
    db: Session = Depends(get_db),
) -> EmailBodyOut:
    if not _is_read_enabled(db):
        raise HTTPException(status_code=501, detail=_READ_PARKED_MESSAGE)
    try:
        data = upsert_email_body_once(db, message_id, payload.body)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return EmailBodyOut(**data)
