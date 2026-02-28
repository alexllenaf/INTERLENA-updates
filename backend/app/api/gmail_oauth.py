from __future__ import annotations

import base64
from collections import defaultdict, deque
import hashlib
import hmac
import html
import os
import secrets
import threading
import time
import urllib.parse
from typing import Any, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from sqlalchemy.orm import Session

from ..db import get_db
from ..schemas import GmailSendIn, GmailSendOut
from ..services.emails import (
    GOOGLE_OAUTH_AUTH_URL,
    GOOGLE_SCOPE,
    exchange_google_code_pkce,
    get_google_oauth_backend_config,
    get_valid_google_send_access_token,
    disconnect_google_send_oauth,
    disconnect_single_google_account,
    list_google_accounts,
    select_google_account,
    send_gmail_message,
    store_google_send_tokens_secure,
    validate_no_header_injection,
)

router = APIRouter(tags=["gmail-oauth"])

_PENDING_PKCE: dict[str, dict[str, str | float]] = {}
_PENDING_PKCE_TTL_SECONDS = 600
_SEND_RATE_HITS: dict[str, deque[float]] = defaultdict(deque)
_SEND_RATE_LOCK = threading.Lock()


def _get_api_token() -> str:
    return str(os.getenv("APP_API_TOKEN", "") or "").strip()


def _require_api_auth(authorization: Optional[str] = Header(None)) -> str:
    expected = _get_api_token()
    if not expected:
        raise HTTPException(status_code=503, detail="APP_API_TOKEN is not configured")
    raw = str(authorization or "").strip()
    if not raw.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    token = raw[7:].strip()
    if not token or not hmac.compare_digest(token, expected):
        raise HTTPException(status_code=401, detail="Invalid bearer token")
    return token


def _rate_limit_check(subject_key: str) -> None:
    limit = max(1, int(str(os.getenv("GMAIL_SEND_RATE_LIMIT", "20") or "20")))
    window_seconds = max(1, int(str(os.getenv("GMAIL_SEND_RATE_WINDOW_SECONDS", "60") or "60")))
    now = time.time()
    cutoff = now - window_seconds

    with _SEND_RATE_LOCK:
        queue = _SEND_RATE_HITS[subject_key]
        while queue and queue[0] < cutoff:
            queue.popleft()
        if len(queue) >= limit:
            retry_after = max(1, int(queue[0] + window_seconds - now))
            raise HTTPException(
                status_code=429,
                detail="Rate limit exceeded for /gmail/send",
                headers={"Retry-After": str(retry_after)},
            )
        queue.append(now)


def _cleanup_pending_pkce() -> None:
    now = time.time()
    stale = [
        state
        for state, payload in _PENDING_PKCE.items()
        if now - float(payload.get("created_at", 0)) > _PENDING_PKCE_TTL_SECONDS
    ]
    for state in stale:
        _PENDING_PKCE.pop(state, None)


def _code_challenge_from_verifier(code_verifier: str) -> str:
    digest = hashlib.sha256(code_verifier.encode("utf-8")).digest()
    return base64.urlsafe_b64encode(digest).decode("utf-8").rstrip("=")


@router.get("/oauth/google/check")
@router.get("/api/oauth/google/check")
def oauth_google_check() -> dict[str, object]:
    """Pre-flight check: verify Google OAuth config is complete before starting the flow."""
    ok, message, cfg = get_google_oauth_backend_config()
    if not ok:
        return {"ok": False, "error": message}
    client_secret = str(cfg.get("client_secret") or "").strip()
    if not client_secret:
        return {
            "ok": False,
            "error": (
                "Falta el client_secret de Google OAuth. "
                "Configúralo en la variable de entorno GOOGLE_CLIENT_SECRET "
                "o en Ajustes > Email sync > OAuth > Google > Client Secret."
            ),
        }
    return {"ok": True, "error": None}


@router.get("/oauth/google/start", response_model=None)
@router.get("/api/oauth/google/start", response_model=None)
def oauth_google_start() -> RedirectResponse | HTMLResponse:
    ok, message, cfg = get_google_oauth_backend_config()
    if not ok:
        return HTMLResponse(
            f"<html><body><h2>OAuth config error</h2><p>{html.escape(message)}</p></body></html>",
            status_code=500,
        )
    client_secret = str(cfg.get("client_secret") or "").strip()
    if not client_secret:
        return HTMLResponse(
            "<html><body>"
            "<h2>OAuth config incompleta</h2>"
            "<p>Falta el <code>client_secret</code> de Google OAuth.</p>"
            "<p>Configúralo en la variable de entorno <code>GOOGLE_CLIENT_SECRET</code> "
            "o en <b>Ajustes &gt; Email sync &gt; OAuth &gt; Google &gt; Client Secret</b>.</p>"
            "<p>Puedes cerrar esta pestaña.</p>"
            "</body></html>",
            status_code=400,
        )

    _cleanup_pending_pkce()
    state = secrets.token_urlsafe(24)
    code_verifier = secrets.token_urlsafe(64)
    code_challenge = _code_challenge_from_verifier(code_verifier)

    _PENDING_PKCE[state] = {
        "code_verifier": code_verifier,
        "created_at": time.time(),
    }

    query = {
        "client_id": cfg["client_id"],
        "redirect_uri": cfg["redirect_uri"],
        "response_type": "code",
        "scope": f"{GOOGLE_SCOPE} openid email",
        "access_type": "offline",
        "prompt": "consent",
        "state": state,
        "code_challenge": code_challenge,
        "code_challenge_method": "S256",
    }
    auth_url = f"{GOOGLE_OAUTH_AUTH_URL}?{urllib.parse.urlencode(query)}"
    return RedirectResponse(url=auth_url, status_code=302)


def _oauth_result_page(status: str, title: str, detail: str) -> HTMLResponse:
    """Generate a polished OAuth result page (success / warning / error)."""
    color_map = {
        "success": {"bg": "#f0fdf4", "border": "#22c55e", "icon": "✅", "accent": "#16a34a"},
        "warning": {"bg": "#fffbeb", "border": "#f59e0b", "icon": "⚠️", "accent": "#d97706"},
        "error":   {"bg": "#fef2f2", "border": "#ef4444", "icon": "❌", "accent": "#dc2626"},
    }
    colors = color_map.get(status, color_map["error"])
    status_code = 200 if status == "success" else 400

    page_html = f"""\
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Interview Atlas – OAuth</title>
  <style>
    *, *::before, *::after {{ box-sizing: border-box; margin: 0; padding: 0; }}
    body {{
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f8fafc;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 1rem;
    }}
    .card {{
      background: #fff;
      border-radius: 16px;
      box-shadow: 0 4px 24px rgba(0,0,0,.08);
      max-width: 440px;
      width: 100%;
      overflow: hidden;
      text-align: center;
    }}
    .banner {{
      background: {colors['bg']};
      border-bottom: 3px solid {colors['border']};
      padding: 2rem 1.5rem 1.5rem;
    }}
    .icon {{ font-size: 3rem; margin-bottom: .5rem; }}
    .banner h1 {{
      font-size: 1.35rem;
      font-weight: 700;
      color: {colors['accent']};
    }}
    .body {{
      padding: 1.5rem 2rem 2rem;
      color: #475569;
      font-size: .95rem;
      line-height: 1.6;
    }}
    .body p {{ margin-bottom: 1rem; }}
    .hint {{
      font-size: .85rem;
      color: #94a3b8;
    }}
    .close-btn {{
      display: inline-block;
      margin-top: .5rem;
      padding: .6rem 1.6rem;
      background: {colors['accent']};
      color: #fff;
      border: none;
      border-radius: 8px;
      font-size: .9rem;
      font-weight: 600;
      cursor: pointer;
      text-decoration: none;
      transition: opacity .15s;
    }}
    .close-btn:hover {{ opacity: .85; }}
  </style>
</head>
<body>
  <div class="card">
    <div class="banner">
      <div class="icon">{colors['icon']}</div>
      <h1>{title}</h1>
    </div>
    <div class="body">
      <p>{detail}</p>
      <button class="close-btn" onclick="window.close()">Cerrar ventana</button>
      <p class="hint">Si la ventana no se cierra, puedes cerrarla manualmente.</p>
    </div>
  </div>
  <script>
    // Auto-close after 4 seconds on success
    {"setTimeout(function(){ window.close(); }, 4000);" if status == "success" else ""}
  </script>
</body>
</html>"""
    return HTMLResponse(page_html, status_code=status_code)


@router.get("/oauth/google/callback", response_class=HTMLResponse)
@router.get("/api/oauth/google/callback", response_class=HTMLResponse)
def oauth_google_callback(
    code: Optional[str] = Query(None),
    state: Optional[str] = Query(None),
    error: Optional[str] = Query(None),
    db: Session = Depends(get_db),
) -> HTMLResponse:
    if error:
        return _oauth_result_page("error", "Autorización cancelada", html.escape(error))
    if not state or not code:
        return _oauth_result_page("error", "Autorización fallida", "Faltan parámetros code/state en la respuesta de Google.")

    _cleanup_pending_pkce()
    pending = _PENDING_PKCE.pop(state, None)
    if not pending:
        return _oauth_result_page("error", "Sesión expirada", "El estado OAuth ha expirado o es inválido. Vuelve a la app e inténtalo de nuevo.")

    code_verifier = str(pending.get("code_verifier") or "")
    ok, message, token_data = exchange_google_code_pkce(code=code, code_verifier=code_verifier)
    if not ok:
        return _oauth_result_page("error", "Error al conectar", html.escape(message))

    saved_ok, saved_message = store_google_send_tokens_secure(token_data, db=db)
    if not saved_ok:
        return _oauth_result_page(
            "warning",
            "Conexión parcial",
            f"{html.escape(saved_message)}<br>Si falta el refresh_token, revoca el acceso de la app en Google y autoriza de nuevo.",
        )

    return _oauth_result_page("success", "¡Cuenta conectada!", html.escape(saved_message))


@router.post("/gmail/send", response_model=GmailSendOut)
@router.post("/api/gmail/send", response_model=GmailSendOut)
def gmail_send(
    payload: GmailSendIn,
    request: Request,
    _: str = Depends(_require_api_auth),
) -> GmailSendOut:
    try:
        validate_no_header_injection(str(payload.to or ""), "to")
        validate_no_header_injection(str(payload.subject or ""), "subject")
        validate_no_header_injection(str(payload.body or ""), "body")
        validate_no_header_injection(str(payload.from_email or ""), "from_email")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    subject_key = str(request.client.host if request.client else "unknown")
    _rate_limit_check(subject_key)

    ok, message, access_token = get_valid_google_send_access_token()
    if not ok:
        raise HTTPException(status_code=401, detail=message)

    sent, send_message, provider_message_id = send_gmail_message(
        access_token=access_token,
        to_email=payload.to,
        subject=payload.subject,
        body=payload.body,
        from_email=str(payload.from_email or ""),
    )
    if not sent:
        raise HTTPException(status_code=502, detail=send_message)

    return GmailSendOut(ok=True, message="Sent", provider_message_id=provider_message_id or None)


@router.post("/oauth/google/disconnect")
@router.post("/api/oauth/google/disconnect")
def oauth_google_disconnect(db: Session = Depends(get_db)) -> dict[str, str | bool]:
    ok, message = disconnect_google_send_oauth(db)
    return {"ok": ok, "message": message}


# ---------------------------------------------------------------------------
# Multi-account endpoints
# ---------------------------------------------------------------------------


@router.get("/oauth/google/accounts")
@router.get("/api/oauth/google/accounts")
def google_accounts_list(db: Session = Depends(get_db)) -> dict[str, Any]:
    """Return all connected Google accounts with which one is active."""
    accounts = list_google_accounts(db)
    return {"ok": True, "accounts": accounts}


@router.post("/oauth/google/accounts/select")
@router.post("/api/oauth/google/accounts/select")
def google_account_select(
    payload: dict[str, str],
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    email = str(payload.get("email") or "").strip()
    if not email:
        raise HTTPException(status_code=400, detail="'email' is required")
    ok, message = select_google_account(db, email)
    if not ok:
        raise HTTPException(status_code=404, detail=message)
    return {"ok": True, "message": message}


@router.post("/oauth/google/accounts/disconnect")
@router.post("/api/oauth/google/accounts/disconnect")
def google_account_disconnect_single(
    payload: dict[str, str],
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    email = str(payload.get("email") or "").strip()
    if not email:
        raise HTTPException(status_code=400, detail="'email' is required")
    ok, message = disconnect_single_google_account(db, email)
    if not ok:
        raise HTTPException(status_code=404, detail=message)
    return {"ok": True, "message": message}
