from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..db import get_db
from ..schemas import (
    OnboardingCompleteIn,
    OnboardingCompleteOut,
    OnboardingStatusOut,
    OnboardingTemplateOut,
)
from ..services.canonical import canonical_schema_ready, get_meta_bool
from ..services.onboarding import list_templates, seed_from_template

router = APIRouter(prefix="/api")


def _ensure_canonical_ready(db: Session) -> None:
    if canonical_schema_ready(db):
        return
    raise HTTPException(status_code=503, detail="Canonical schema is not ready yet")


@router.get("/onboarding/status", response_model=OnboardingStatusOut)
def onboarding_status_api(db: Session = Depends(get_db)) -> OnboardingStatusOut:
    _ensure_canonical_ready(db)
    return OnboardingStatusOut(completed=get_meta_bool(db, "onboarding_completed", default=False))


@router.get("/onboarding/templates", response_model=list[OnboardingTemplateOut])
def onboarding_templates_api(db: Session = Depends(get_db)) -> list[OnboardingTemplateOut]:
    _ensure_canonical_ready(db)
    return [OnboardingTemplateOut(**item) for item in list_templates()]


@router.post("/onboarding/complete", response_model=OnboardingCompleteOut)
def onboarding_complete_api(
    payload: OnboardingCompleteIn,
    db: Session = Depends(get_db),
) -> OnboardingCompleteOut:
    _ensure_canonical_ready(db)

    if get_meta_bool(db, "onboarding_completed", default=False):
        raise HTTPException(status_code=409, detail="Onboarding already completed")

    try:
        seeded = seed_from_template(
            db,
            template_id=payload.template_id,
            workspace_name=payload.workspace_name,
        )
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    db.commit()
    return OnboardingCompleteOut(
        completed=True,
        home_page_id=seeded["home_page_id"],
        seed_version=seeded["seed_version"],
    )
