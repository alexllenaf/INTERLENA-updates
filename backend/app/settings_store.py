from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any, Dict

from sqlalchemy.orm import Session

from .models import Setting

DEFAULT_SETTINGS: Dict[str, Any] = {
    "stages": ["Applied", "Screening", "HR", "Technical", "Final Interview", "Offer"],
    "outcomes": ["In Progress", "Offer", "Rejected", "On Hold"],
    "job_types": ["Internship", "Full-time", "Part-time", "Graduate Program"],
    "job_type_colors": {
        "Internship": "#BEE3F8",
        "Full-time": "#C6F6D5",
        "Part-time": "#FED7D7",
        "Graduate Program": "#FAF089",
    },
    "stage_colors": {
        "Applied": "#CBD5E0",
        "Screening": "#63B3ED",
        "HR": "#F6AD55",
        "Technical": "#4FD1C5",
        "Final Interview": "#9F7AEA",
        "Offer": "#68D391",
    },
    "outcome_colors": {
        "In Progress": "#F6C453",
        "Offer": "#2F855A",
        "Rejected": "#C53030",
        "On Hold": "#718096",
    },
    "score_scale": {"min": 0.0, "max": 10.0},
    "table_columns": [
        "company_name",
        "position",
        "job_type",
        "location",
        "stage",
        "outcome",
        "application_date",
        "interview_datetime",
        "followup_date",
        "interview_rounds",
        "interview_type",
        "interviewers",
        "company_score",
        "contacts",
        "last_round_cleared",
        "total_rounds",
        "my_interview_score",
        "improvement_areas",
        "skill_to_upgrade",
        "job_description",
        "notes",
        "documents_links",
        "favorite",
    ],
    "hidden_columns": [
        "job_description",
        "notes",
        "improvement_areas",
        "skill_to_upgrade",
        "documents_links",
    ],
    "column_widths": {},
    "column_labels": {},
    "table_density": "comfortable",
    "dark_mode": False,
    "custom_properties": [],
    "page_configs": {},
    "brand_profile": {
        "name": "Tu Nombre",
        "role": "Ingeniero Industrial IA",
        "avatarSrc": "/brand-avatar.svg",
        "avatarAlt": "Foto de perfil",
    },
}


def _parse_updated_at(value: Any) -> datetime | None:
    if not isinstance(value, str):
        return None
    raw = value.strip()
    if not raw:
        return None
    if raw.endswith("Z"):
        raw = f"{raw[:-1]}+00:00"
    try:
        dt = datetime.fromisoformat(raw)
    except ValueError:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _merge_page_configs(current: Any, incoming: Any) -> Dict[str, Any]:
    current_pages = current if isinstance(current, dict) else {}
    incoming_pages = incoming if isinstance(incoming, dict) else {}
    merged: Dict[str, Any] = dict(current_pages)

    for page_id, next_cfg in incoming_pages.items():
        prev_cfg = merged.get(page_id)
        if not isinstance(next_cfg, dict):
            merged[page_id] = next_cfg
            continue
        if not isinstance(prev_cfg, dict):
            merged[page_id] = next_cfg
            continue

        prev_ts = _parse_updated_at(prev_cfg.get("updated_at"))
        next_ts = _parse_updated_at(next_cfg.get("updated_at"))

        # Keep newest config to avoid stale overwrite from concurrent saves.
        if prev_ts is not None and next_ts is not None:
            merged[page_id] = next_cfg if next_ts > prev_ts else prev_cfg
            continue

        # If only incoming has timestamp, prefer incoming.
        if prev_ts is None and next_ts is not None:
            merged[page_id] = next_cfg
            continue

        # If only current has timestamp, keep current to avoid losing newer data.
        if prev_ts is not None and next_ts is None:
            merged[page_id] = prev_cfg
            continue

        # Legacy payloads without timestamps on both sides: keep incoming.
        merged[page_id] = next_cfg

    return merged


def get_settings(db: Session) -> Dict[str, Any]:
    row = db.get(Setting, "settings")
    if not row:
        return dict(DEFAULT_SETTINGS)
    try:
        parsed = json.loads(row.value)
    except json.JSONDecodeError:
        return dict(DEFAULT_SETTINGS)
    merged = dict(DEFAULT_SETTINGS)
    merged.update(parsed)
    return merged


def save_settings(db: Session, settings: Dict[str, Any]) -> None:
    existing = db.get(Setting, "settings")
    current: Dict[str, Any] = {}
    if existing:
        try:
            parsed = json.loads(existing.value)
            if isinstance(parsed, dict):
                current = parsed
        except json.JSONDecodeError:
            current = {}

    merged = dict(current)
    merged.update(settings)
    merged["page_configs"] = _merge_page_configs(
        current.get("page_configs"),
        settings.get("page_configs")
    )

    payload = json.dumps(merged)
    if existing:
        existing.value = payload
    else:
        db.add(Setting(key="settings", value=payload))
    db.commit()


def get_ui_state(db: Session) -> Dict[str, Any]:
    row = db.get(Setting, "ui_state")
    if not row:
        return {}
    try:
        return json.loads(row.value)
    except json.JSONDecodeError:
        return {}


def save_ui_state(db: Session, state: Dict[str, Any]) -> None:
    payload = json.dumps(state)
    existing = db.get(Setting, "ui_state")
    if existing:
        existing.value = payload
    else:
        db.add(Setting(key="ui_state", value=payload))
    db.commit()
