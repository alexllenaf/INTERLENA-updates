from __future__ import annotations

from typing import Dict

import json
import os
from urllib.parse import unquote, urlparse
from urllib.request import Request, urlopen

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse

from ..schemas import UpdateInfoOut
from ..storage import get_storage_manager
from ..update_checker import _platform_key, get_cached_update, get_feed_url

router = APIRouter(prefix="/api")


@router.get("/health")
def health() -> Dict[str, str]:
    return {"status": "ok"}


@router.get("/update", response_model=UpdateInfoOut)
def get_update_status() -> UpdateInfoOut:
    info = get_cached_update()
    return UpdateInfoOut(
        current_version=info.current_version,
        latest_version=info.latest_version,
        update_available=info.update_available,
        url=info.url,
        notes=info.notes,
        checked_at=info.checked_at,
        error=info.error,
    )


@router.get("/storage")
def storage_status() -> Dict[str, str]:
    manager = get_storage_manager()
    return {
        "data_dir": str(manager.paths.base_dir),
        "db_path": str(manager.paths.db_path),
        "uploads_dir": str(manager.paths.uploads_dir),
        "backups_dir": str(manager.paths.backups_dir),
        "state_path": str(manager.paths.state_path),
        "update_feed": get_feed_url() or "",
    }


def _load_update_payload() -> dict:
    feed_url = get_feed_url()
    if not feed_url:
        raise HTTPException(status_code=404, detail="UPDATE_FEED_URL not configured.")
    if feed_url.startswith("file://"):
        path = unquote(urlparse(feed_url).path)
        if not os.path.exists(path):
            raise HTTPException(status_code=404, detail="Update feed not found.")
        with open(path, "r", encoding="utf-8") as handle:
            return json.load(handle) if handle else {}
    req = Request(feed_url, headers={"User-Agent": "Interview Atlas"})
    with urlopen(req, timeout=6) as response:
        return json.load(response)


def _ensure_platform_payload(payload: dict) -> dict:
    if not isinstance(payload, dict):
        return {}
    if isinstance(payload.get("platforms"), dict):
        return payload

    url = payload.get("url") or payload.get("download_url") or payload.get("html_url")
    if not isinstance(url, str) or not url:
        return payload

    platform_key = _platform_key()
    if not platform_key:
        return payload

    platform_payload: Dict[str, str] = {"url": url}
    if url.startswith("file://"):
        sig_path = unquote(urlparse(url).path) + ".sig"
        if os.path.exists(sig_path):
            with open(sig_path, "r", encoding="utf-8") as handle:
                signature = handle.read().strip()
                if signature:
                    platform_payload["signature"] = signature

    payload = dict(payload)
    payload["platforms"] = {platform_key: platform_payload}
    return payload


@router.get("/update/manifest")
def update_manifest() -> JSONResponse:
    payload = _ensure_platform_payload(_load_update_payload())
    return JSONResponse(content=payload)


@router.get("/update/package")
def update_package() -> StreamingResponse:
    payload = _ensure_platform_payload(_load_update_payload())
    platform_key = _platform_key()
    platform_payload = payload.get("platforms", {}).get(platform_key, {}) if platform_key else {}
    url = platform_payload.get("url") or payload.get("url")
    if not url or not isinstance(url, str):
        raise HTTPException(status_code=404, detail="Update package URL missing.")

    if url.startswith("file://"):
        path = unquote(urlparse(url).path)
        if not os.path.exists(path):
            raise HTTPException(status_code=404, detail="Update package not found.")
        filename = os.path.basename(path)
        return FileResponse(path, media_type="application/gzip", filename=filename)

    response = urlopen(Request(url, headers={"User-Agent": "Interview Atlas"}), timeout=10)
    filename = os.path.basename(urlparse(url).path) or "update.tar.gz"
    return StreamingResponse(
        response,
        media_type="application/gzip",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )
