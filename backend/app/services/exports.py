from __future__ import annotations

import io
import os
from typing import Any, Dict, Iterable, List

from ..crud import application_to_dict
from ..utils import build_events_for_application, build_ics

if os.getenv("EAGER_PANDAS") == "1":  # optional: startup profiling
    import pandas as _pandas  # noqa: F401


def build_ics_bytes(apps: Iterable[Any]) -> bytes:
    events = []
    for app in apps:
        events.extend(build_events_for_application(application_to_dict(app)))
    return build_ics(events)


def build_excel_bytes(apps: Iterable[Any], settings: Dict[str, Any]) -> bytes:
    import pandas as pd

    rows: List[Dict[str, Any]] = []
    custom_keys: List[str] = []
    custom_props = settings.get("custom_properties", [])
    if isinstance(custom_props, list):
        custom_keys = [f"prop__{p.get('key')}" for p in custom_props if p.get("key")]

    for app in apps:
        base = application_to_dict(app)
        props = base.pop("properties", {})
        for key in custom_keys:
            raw_key = key.replace("prop__", "", 1)
            base[key] = props.get(raw_key, "")
        rows.append(base)

    df = pd.DataFrame(rows)
    buffer = io.BytesIO()
    with pd.ExcelWriter(buffer, engine="openpyxl") as writer:
        df.to_excel(writer, index=False, sheet_name="Applications")
    buffer.seek(0)
    return buffer.read()
