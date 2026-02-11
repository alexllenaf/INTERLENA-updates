from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..db import get_db
from ..schemas import SettingsIn, SettingsOut
from ..settings_store import get_settings as load_settings, save_settings

router = APIRouter(prefix="/api")


@router.get("/settings", response_model=SettingsOut)
def get_settings_api(db: Session = Depends(get_db)) -> SettingsOut:
    return SettingsOut(settings=load_settings(db))


@router.put("/settings", response_model=SettingsOut)
def save_settings_api(payload: SettingsIn, db: Session = Depends(get_db)) -> SettingsOut:
    save_settings(db, payload.settings)
    return SettingsOut(settings=load_settings(db))
