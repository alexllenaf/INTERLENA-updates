from __future__ import annotations

import json
from typing import Any, Dict

from ..models import View
from ..schemas import ViewOut


def parse_view_config(raw: str | None) -> Dict[str, Any]:
    if not raw:
        return {}
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    if not isinstance(data, dict):
        return {}
    return data


def to_view_out(view: View) -> ViewOut:
    return ViewOut(
        view_id=view.view_id,
        name=view.name,
        view_type=view.view_type,
        config=parse_view_config(view.config or "{}"),
        created_at=view.created_at,
        updated_at=view.updated_at,
    )
