from __future__ import annotations

import json
import uuid
from datetime import date, datetime, timedelta
from typing import Any, Dict, Iterable, List, Optional


def parse_date(value: Any) -> Optional[date]:
    if value in (None, ""):
        return None
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    if isinstance(value, datetime):
        return value.date()
    try:
        return date.fromisoformat(str(value))
    except ValueError:
        try:
            return datetime.fromisoformat(str(value)).date()
        except ValueError:
            return None


def parse_datetime(value: Any) -> Optional[datetime]:
    if value in (None, ""):
        return None
    if isinstance(value, datetime):
        return value
    if isinstance(value, date):
        return datetime.combine(value, datetime.min.time())
    try:
        return datetime.fromisoformat(str(value))
    except ValueError:
        return None


def validate_row(row: Dict[str, Any]) -> List[str]:
    errors: List[str] = []
    app_d = parse_date(row.get("application_date"))
    interview_d = parse_date(row.get("interview_datetime"))
    follow_d = parse_date(row.get("followup_date"))
    if app_d and interview_d and interview_d < app_d:
        errors.append("Interview Date must be on/after Application Date")
    if app_d and follow_d and follow_d < app_d:
        errors.append("Follow-Up Date must be on/after Application Date")
    return errors


def apply_business_rules(
    row: Dict[str, Any], previous: Optional[Dict[str, Any]], stages: List[str]
) -> Dict[str, Any]:
    updated = dict(row)
    outcome = updated.get("outcome")
    if outcome == "Offer" and "Offer" in stages:
        updated["stage"] = "Offer"
    if outcome == "Rejected" and previous is not None:
        updated["stage"] = previous.get("stage")
    return updated


def parse_properties_json(raw: str | None) -> Dict[str, str]:
    if not raw:
        return {}
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    if not isinstance(data, dict):
        return {}
    return {str(k): "" if v is None else str(v) for k, v in data.items()}


def properties_to_json(props: Dict[str, str] | None) -> str:
    if not props:
        return "{}"
    return json.dumps({str(k): "" if v is None else v for k, v in props.items()})


def parse_json_list(raw: str | None) -> List[Dict[str, Any]]:
    if not raw:
        return []
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return []
    if not isinstance(data, list):
        return []
    return [item for item in data if isinstance(item, dict)]


def list_to_json(items: Optional[List[Dict[str, Any]]]) -> str:
    if not items:
        return "[]"
    return json.dumps(items)


def ics_datetime(dt: datetime) -> str:
    return dt.strftime("%Y%m%dT%H%M%S")


def ics_date(d: date) -> str:
    return d.strftime("%Y%m%d")


def build_ics(events: Iterable[Dict[str, Any]]) -> bytes:
    lines: List[str] = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Local Interview Tracker//EN"]
    for event in events:
        lines.append("BEGIN:VEVENT")
        lines.append(f"UID:{event['uid']}")
        lines.append(f"DTSTAMP:{ics_datetime(datetime.utcnow())}")
        lines.append(f"SUMMARY:{event['summary']}")
        if event.get("description"):
            desc = event["description"].replace("\n", "\\n")
            lines.append(f"DESCRIPTION:{desc}")
        if event.get("all_day"):
            lines.append(f"DTSTART;VALUE=DATE:{ics_date(event['start'].date())}")
        else:
            lines.append(f"DTSTART:{ics_datetime(event['start'])}")
            if event.get("end"):
                lines.append(f"DTEND:{ics_datetime(event['end'])}")
        lines.append("END:VEVENT")
    lines.append("END:VCALENDAR")
    return "\n".join(lines).encode("utf-8")


def build_events_for_application(app: Dict[str, Any]) -> List[Dict[str, Any]]:
    events: List[Dict[str, Any]] = []
    interview_dt = parse_datetime(app.get("interview_datetime"))
    followup_dt = parse_datetime(app.get("followup_date"))
    todo_items = app.get("todo_items") or []
    description_bits = []
    if app.get("notes"):
        description_bits.append(str(app.get("notes")))
    if app.get("interviewers"):
        description_bits.append(f"Interviewers: {app.get('interviewers')}")
    description = "\n".join(description_bits) if description_bits else None

    if interview_dt:
        events.append(
            {
                "uid": str(uuid.uuid4()),
                "summary": f"Interview - {app.get('company_name')} - {app.get('position')}",
                "description": description,
                "start": interview_dt,
                "end": interview_dt + timedelta(hours=1),
                "all_day": False,
            }
        )
    if followup_dt:
        events.append(
            {
                "uid": str(uuid.uuid4()),
                "summary": f"Follow-Up - {app.get('company_name')} - {app.get('position')}",
                "description": description,
                "start": followup_dt,
                "all_day": True,
            }
        )
    for todo in todo_items:
        if not isinstance(todo, dict):
            continue
        due_date = parse_date(todo.get("due_date"))
        if not due_date:
            continue
        todo_notes = []
        if todo.get("task_location"):
            todo_notes.append(f"Location: {todo.get('task_location')}")
        if todo.get("notes"):
            todo_notes.append(str(todo.get("notes")))
        if todo.get("documents_links"):
            todo_notes.append(f"Links: {todo.get('documents_links')}")
        todo_description = "\n".join(todo_notes) if todo_notes else None
        task = todo.get("task") or "To-Do"
        events.append(
            {
                "uid": str(todo.get("id") or uuid.uuid4()),
                "summary": f"To-Do - {app.get('company_name')} - {task}",
                "description": todo_description,
                "start": datetime.combine(due_date, datetime.min.time()),
                "all_day": True,
            }
        )
    return events
