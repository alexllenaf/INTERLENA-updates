from __future__ import annotations

from datetime import datetime
from sqlalchemy import Boolean, Column, Date, DateTime, Float, Index, Integer, String, Text
from sqlalchemy.orm import declarative_base

Base = declarative_base()


class Application(Base):
    __tablename__ = "applications"

    id = Column(Integer, primary_key=True, index=True)
    application_id = Column(String, unique=True, index=True)
    company_name = Column(String, nullable=False)
    position = Column(String, nullable=False)
    job_type = Column(String, nullable=False)
    location = Column(String)
    stage = Column(String, nullable=False)
    outcome = Column(String, nullable=False)
    pipeline_order = Column(Integer)
    application_date = Column(Date)
    interview_datetime = Column(DateTime)
    followup_date = Column(Date)
    interview_rounds = Column(Integer)
    interview_type = Column(String)
    interviewers = Column(Text)
    company_score = Column(Float)
    last_round_cleared = Column(String)
    total_rounds = Column(Integer)
    my_interview_score = Column(Float)
    improvement_areas = Column(Text)
    skill_to_upgrade = Column(Text)
    job_description = Column(Text)
    notes = Column(Text)
    todo_items = Column(Text)
    documents_links = Column(Text)
    documents_files = Column(Text)
    contacts = Column(Text)
    favorite = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow)
    last_viewed = Column(DateTime)
    created_by = Column(String)
    properties_json = Column(Text)


class View(Base):
    __tablename__ = "views"

    view_id = Column(String, primary_key=True, index=True)
    name = Column(String, nullable=False)
    view_type = Column(String, nullable=False)
    config = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow)


class Setting(Base):
    __tablename__ = "settings"

    key = Column(String, primary_key=True)
    value = Column(Text, nullable=False)


class EmailMessage(Base):
    __tablename__ = "email_messages"
    __table_args__ = (
        Index("ix_email_messages_contact_id", "contact_id"),
        Index("ix_email_messages_date", "date"),
        Index("ix_email_messages_contact_date", "contact_id", "date"),
    )

    message_id = Column(String, primary_key=True, index=True)
    contact_id = Column(String, nullable=False)
    from_address = Column(String, nullable=False)
    to_address = Column(String, nullable=False)
    subject = Column(String, nullable=False)
    date = Column(DateTime, nullable=False)
    is_read = Column(Boolean, default=False, nullable=False)
    folder = Column(String, nullable=False)
    body = Column(Text)
    body_downloaded_at = Column(DateTime)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class EmailSyncCursor(Base):
    __tablename__ = "email_sync_cursors"

    contact_id = Column(String, primary_key=True)
    folder = Column(String, primary_key=True)
    last_synced_at = Column(DateTime, nullable=False)


class EmailSendLog(Base):
    __tablename__ = "email_send_logs"
    __table_args__ = (
        Index("ix_email_send_logs_sent_by_created_at", "sent_by", "created_at"),
        Index("ix_email_send_logs_batch_id", "batch_id"),
        Index("ix_email_send_logs_status", "status"),
    )

    id = Column(Integer, primary_key=True, index=True)
    batch_id = Column(String, nullable=False)
    sent_by = Column(String, nullable=False)
    recipient_name = Column(String)
    recipient_email = Column(String, nullable=False)
    company = Column(String)
    subject = Column(String, nullable=False)
    status = Column(String, nullable=False)
    error_message = Column(Text)
    provider_message_id = Column(String)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
