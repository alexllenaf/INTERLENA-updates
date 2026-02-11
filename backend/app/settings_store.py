from __future__ import annotations

import json
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
    "brand_profile": {
        "name": "Tu Nombre",
        "role": "Ingeniero Industrial IA",
        "avatarSrc": "/brand-avatar.svg",
        "avatarAlt": "Foto de perfil",
    },
}


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
    payload = json.dumps(settings)
    existing = db.get(Setting, "settings")
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
