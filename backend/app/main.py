from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api.applications import router as applications_router
from .api.backups import router as backups_router
from .api.exports import router as exports_router
from .api.health import router as health_router
from .api.settings import router as settings_router
from .api.views import router as views_router
from .config import get_settings
from .db import init_db
from .db import engine as db_engine
from .startup_metrics import StartupTimer, log_startup_metrics
from .storage import get_storage_manager
from .update_checker import start_update_check
from .version import APP_NAME, APP_VERSION

app = FastAPI(title=f"{APP_NAME} API", version=APP_VERSION)

settings = get_settings()
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def _startup() -> None:
    timer = StartupTimer("startup")
    phases: dict[str, float] = {}
    storage = get_storage_manager()
    storage.prepare(database_url=settings.database_url, uploads_dir=settings.uploads_dir)
    phases["storage_prepare"] = timer.elapsed_ms()
    init_db()
    storage.apply_migrations(db_engine)
    phases["db_init"] = timer.elapsed_ms()
    start_update_check()
    phases["update_check"] = timer.elapsed_ms()
    log_startup_metrics(phases, total_ms=timer.elapsed_ms())


@app.on_event("shutdown")
def _shutdown() -> None:
    get_storage_manager().mark_shutdown()


app.include_router(health_router)
app.include_router(backups_router)
app.include_router(settings_router)
app.include_router(applications_router)
app.include_router(views_router)
app.include_router(exports_router)
