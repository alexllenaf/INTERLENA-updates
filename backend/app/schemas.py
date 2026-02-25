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
    first_name: Optional[str] = None
    last_name: Optional[str] = None
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
    application_date: Optional[datetime] = None
    interview_datetime: Optional[datetime] = None
    followup_date: Optional[datetime] = None
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
    application_date: Optional[datetime] = None
    interview_datetime: Optional[datetime] = None
    followup_date: Optional[datetime] = None
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


class EmailMetadataIn(BaseModel):
    message_id: str
    from_address: str
    to_address: str
    subject: str
    date: datetime
    is_read: bool = False
    folder: str = "INBOX"


class EmailMetadataOut(EmailMetadataIn):
    contact_id: str
    body_cached: bool = False


class EmailMetadataSyncIn(BaseModel):
    contact_id: str
    folder: str = "INBOX"
    messages: List[EmailMetadataIn] = Field(default_factory=list)


class EmailMetadataSyncOut(BaseModel):
    contact_id: str
    folder: str
    cutoff_date: datetime
    last_synced_at: Optional[datetime] = None
    inserted: int
    skipped_existing: int
    skipped_out_of_window: int


class EmailBodyUpsertIn(BaseModel):
    body: str


class EmailBodyOut(BaseModel):
    message_id: str
    body: str
    cached: bool


class EmailImapConfigIn(BaseModel):
    host: str
    port: int = 993
    username: str
    password: str
    use_ssl: bool = True
    folder: str = "INBOX"


class EmailConnectionTestIn(BaseModel):
    provider: str = "none"
    imap: Optional[EmailImapConfigIn] = None


class EmailConnectionTestOut(BaseModel):
    ok: bool
    provider: str
    message: str


class EmailFoldersListOut(BaseModel):
    ok: bool
    provider: str
    message: str
    folders: List[str] = Field(default_factory=list)


class EmailOAuthStartIn(BaseModel):
    provider: str
    client_id: str
    client_secret: str
    redirect_uri: Optional[str] = None
    tenant_id: Optional[str] = None
    scope: Optional[str] = None


class EmailOAuthStartOut(BaseModel):
    ok: bool
    provider: str
    message: str
    state: str
    auth_url: str


class EmailSendContactIn(BaseModel):
    name: Optional[str] = None
    email: str
    company: Optional[str] = None
    custom_fields: Dict[str, str] = Field(default_factory=dict)


class EmailSendBatchIn(BaseModel):
    subject_template: str
    body_template: str
    contacts: List[EmailSendContactIn] = Field(default_factory=list)


class EmailSendContactOut(BaseModel):
    name: str
    first_name: str = ""
    last_name: str = ""
    email: str
    company: str
    custom_fields: Dict[str, str] = Field(default_factory=dict)


class EmailSendResultItemOut(BaseModel):
    email: str
    name: str
    status: str
    message: str
    provider_message_id: Optional[str] = None


class EmailSendStatsOut(BaseModel):
    connected: bool = False
    sent_by: str
    sent_today: int
    remaining_today: int
    daily_limit: int
    warning: Optional[str] = None


class EmailSendBatchOut(BaseModel):
    ok: bool
    batch_id: str
    sent_by: str
    total: int
    sent: int
    errors: int
    warning: Optional[str] = None
    daily_limit: int
    sent_today: int
    remaining_today: int
    results: List[EmailSendResultItemOut] = Field(default_factory=list)


class GmailSendIn(BaseModel):
    to: str
    subject: str
    body: str
    from_email: Optional[str] = None


class GmailSendOut(BaseModel):
    ok: bool
    message: str
    provider_message_id: Optional[str] = None
