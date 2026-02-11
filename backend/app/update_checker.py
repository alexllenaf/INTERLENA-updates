from __future__ import annotations

import json
import os
import platform
import re
import subprocess
import threading
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from .version import APP_NAME, APP_VERSION


@dataclass(frozen=True)
class UpdateInfo:
    current_version: str
    latest_version: Optional[str]
    update_available: bool
    url: Optional[str]
    notes: Optional[str]
    checked_at: datetime
    error: Optional[str]


_UPDATE_LOCK = threading.Lock()
_UPDATE_INFO: Optional[UpdateInfo] = None


def _parse_bool(value: str | None, default: bool = True) -> bool:
    if value is None:
        return default
    return value.strip().lower() not in {"0", "false", "no", "off"}


def _version_key(value: str) -> tuple[int, ...]:
    parts = re.split(r"[.+-]", value.strip())
    numbers: list[int] = []
    for part in parts:
        match = re.match(r"(\d+)", part)
        numbers.append(int(match.group(1)) if match else 0)
    return tuple(numbers)


def _is_newer(latest: str, current: str) -> bool:
    latest_key = _version_key(latest)
    current_key = _version_key(current)
    max_len = max(len(latest_key), len(current_key))
    latest_key = latest_key + (0,) * (max_len - len(latest_key))
    current_key = current_key + (0,) * (max_len - len(current_key))
    return latest_key > current_key


def _escape_applescript(value: str) -> str:
    return value.replace("\\\\", "\\\\\\\\").replace('"', '\\"')


def _notify_mac(title: str, message: str) -> None:
    if platform.system() != "Darwin":
        return
    script = f'display notification "{_escape_applescript(message)}" with title "{_escape_applescript(title)}"'
    subprocess.run(["osascript", "-e", script], check=False)


def _parse_payload(payload: dict[str, object]) -> tuple[Optional[str], Optional[str], Optional[str]]:
    latest = payload.get("version") or payload.get("latest") or payload.get("tag")
    url = payload.get("url") or payload.get("download_url") or payload.get("html_url")
    notes = payload.get("notes") or payload.get("changelog")

    platforms = payload.get("platforms")
    if isinstance(platforms, dict):
        platform_key = _platform_key()
        if platform_key and isinstance(platforms.get(platform_key), dict):
            platform_payload = platforms.get(platform_key) or {}
            if isinstance(platform_payload, dict):
                url = platform_payload.get("url") or url
                notes = platform_payload.get("notes") or notes
    latest_str = str(latest) if latest is not None else None
    url_str = str(url) if url is not None else None
    notes_str = str(notes) if notes is not None else None
    return latest_str, url_str, notes_str


def _platform_key() -> Optional[str]:
    system = platform.system().lower()
    machine = platform.machine().lower()
    if system == "darwin":
        if machine in {"arm64", "aarch64"}:
            return "darwin-aarch64"
        return "darwin-x86_64"
    if system == "windows":
        if machine in {"x86", "i386", "i686"}:
            return "windows-i686"
        return "windows-x86_64"
    if system == "linux":
        if machine in {"arm64", "aarch64"}:
            return "linux-aarch64"
        return "linux-x86_64"
    return None


def fetch_update_info(feed_url: str, current_version: str) -> UpdateInfo:
    checked_at = datetime.now(timezone.utc)
    try:
        req = Request(feed_url, headers={"User-Agent": f"{APP_NAME}/{current_version}"})
        with urlopen(req, timeout=6) as response:
            payload = json.load(response)
    except (HTTPError, URLError, json.JSONDecodeError) as exc:
        return UpdateInfo(
            current_version=current_version,
            latest_version=None,
            update_available=False,
            url=None,
            notes=None,
            checked_at=checked_at,
            error=str(exc),
        )

    latest, url, notes = _parse_payload(payload if isinstance(payload, dict) else {})
    update_available = bool(latest) and _is_newer(latest, current_version)
    return UpdateInfo(
        current_version=current_version,
        latest_version=latest,
        update_available=update_available,
        url=url,
        notes=notes,
        checked_at=checked_at,
        error=None,
    )


def _set_cached_update(info: UpdateInfo) -> None:
    global _UPDATE_INFO
    with _UPDATE_LOCK:
        _UPDATE_INFO = info


def get_cached_update() -> UpdateInfo:
    with _UPDATE_LOCK:
        cached = _UPDATE_INFO
    if cached:
        return cached
    return refresh_update(notify=False)


def refresh_update(feed_url: Optional[str] = None, notify: bool = False) -> UpdateInfo:
    feed_url = feed_url or os.getenv("UPDATE_FEED_URL")
    if not feed_url:
        info = UpdateInfo(
            current_version=APP_VERSION,
            latest_version=None,
            update_available=False,
            url=None,
            notes=None,
            checked_at=datetime.now(timezone.utc),
            error="UPDATE_FEED_URL not configured.",
        )
        _set_cached_update(info)
        return info

    info = fetch_update_info(feed_url, APP_VERSION)
    _set_cached_update(info)
    if notify and info.update_available:
        _notify_mac(APP_NAME, f"Nueva versión disponible ({info.latest_version}).")
    return info


def start_update_check() -> None:
    feed_url = os.getenv("UPDATE_FEED_URL")
    if not feed_url:
        return
    notify = _parse_bool(os.getenv("UPDATE_NOTIFY"), default=True)

    thread = threading.Thread(
        target=refresh_update,
        kwargs={"feed_url": feed_url, "notify": notify},
        daemon=True,
        name="update-checker",
    )
    thread.start()


def get_feed_url() -> Optional[str]:
    return os.getenv("UPDATE_FEED_URL")
