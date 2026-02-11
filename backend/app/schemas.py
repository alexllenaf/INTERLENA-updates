from __future__ import annotations

from datetime import date, datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class DocumentFile(BaseModel):
    id: str
    name: str
    size: Optional[int] = None
    content_type: Optional[str] = None
    uploaded_at: Optional[datetime] = None


class Contact(BaseModel):
    id: str
    name: str
    information: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None


class TodoItem(BaseModel):
    id: str
    task: str
    due_date: Optional[str] = None
    status: Optional[str] = None
    task_location: Optional[str] = None
    notes: Optional[str] = None
    documents_links: Optional[str] = None


class ApplicationBase(BaseModel):
    company_name: str
    position: str
    job_type: str
    stage: str
    outcome: str
    pipeline_order: Optional[int] = None
    location: Optional[str] = None
    application_date: Optional[date] = None
    interview_datetime: Optional[datetime] = None
    followup_date: Optional[date] = None
    interview_rounds: Optional[int] = None
    interview_type: Optional[str] = None
    interviewers: Optional[str] = None
    company_score: Optional[float] = None
    last_round_cleared: Optional[str] = None
    total_rounds: Optional[int] = None
    my_interview_score: Optional[float] = None
    improvement_areas: Optional[str] = None
    skill_to_upgrade: Optional[str] = None
    job_description: Optional[str] = None
    notes: Optional[str] = None
    todo_items: List[TodoItem] = Field(default_factory=list)
    documents_links: Optional[str] = None
    documents_files: List[DocumentFile] = Field(default_factory=list)
    contacts: List[Contact] = Field(default_factory=list)
    favorite: bool = False
    created_by: Optional[str] = None
    properties: Dict[str, str] = Field(default_factory=dict)


class ApplicationCreate(ApplicationBase):
    application_id: Optional[str] = None


class ApplicationUpdate(BaseModel):
    company_name: Optional[str] = None
    position: Optional[str] = None
    job_type: Optional[str] = None
    stage: Optional[str] = None
    outcome: Optional[str] = None
    pipeline_order: Optional[int] = None
    location: Optional[str] = None
    application_date: Optional[date] = None
    interview_datetime: Optional[datetime] = None
    followup_date: Optional[date] = None
    interview_rounds: Optional[int] = None
    interview_type: Optional[str] = None
    interviewers: Optional[str] = None
    company_score: Optional[float] = None
    last_round_cleared: Optional[str] = None
    total_rounds: Optional[int] = None
    my_interview_score: Optional[float] = None
    improvement_areas: Optional[str] = None
    skill_to_upgrade: Optional[str] = None
    job_description: Optional[str] = None
    notes: Optional[str] = None
    todo_items: Optional[List[TodoItem]] = None
    documents_links: Optional[str] = None
    documents_files: Optional[List[DocumentFile]] = None
    contacts: Optional[List[Contact]] = None
    favorite: Optional[bool] = None
    properties: Optional[Dict[str, str]] = None


class ApplicationOut(ApplicationBase):
    id: int
    application_id: str
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    last_viewed: Optional[datetime] = None

    model_config = {"from_attributes": True}


class ViewBase(BaseModel):
    name: str
    view_type: str
    config: Dict[str, Any]


class ViewCreate(ViewBase):
    pass


class ViewUpdate(BaseModel):
    name: Optional[str] = None
    view_type: Optional[str] = None
    config: Optional[Dict[str, Any]] = None


class ViewOut(ViewBase):
    view_id: str
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class SettingsOut(BaseModel):
    settings: Dict[str, Any]


class SettingsIn(BaseModel):
    settings: Dict[str, Any]


class UpdateInfoOut(BaseModel):
    current_version: str
    latest_version: Optional[str] = None
    update_available: bool = False
    url: Optional[str] = None
    notes: Optional[str] = None
    checked_at: Optional[datetime] = None
    error: Optional[str] = None
