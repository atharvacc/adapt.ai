import logging
import os

logging.basicConfig(
    level=logging.INFO,
    format="%(levelname)s:%(name)s:%(message)s",
)
logging.getLogger("app").setLevel(logging.DEBUG)

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text as sa_text

from app.api.v1.runs import router as runs_router
from app.api.v1.resources import router as resources_router
from app.api.v1.workflows import router as workflows_router
from app.api.v1.oauth import router as oauth_router
from app.api.v1.config import router as config_router
from app.api.v1.scrape import router as scrape_router
from app.api.v1.uploads import router as uploads_router
from app.api.v1.devtools import router as devtools_router
from app.core.settings import settings
from app.db.models import Base
from app.db.session import engine

app = FastAPI(title=settings.app_name)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(runs_router)
app.include_router(resources_router)
app.include_router(workflows_router)
app.include_router(oauth_router)
app.include_router(config_router)
app.include_router(scrape_router)
app.include_router(uploads_router)
app.include_router(devtools_router)

_UPLOAD_DIR = os.path.join(os.path.dirname(__file__), "..", "uploads")
os.makedirs(_UPLOAD_DIR, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=_UPLOAD_DIR), name="uploads")

Base.metadata.create_all(bind=engine)

_NEW_COLUMNS = [
    ("accounts", "follower_data", "JSONB DEFAULT '{}'::jsonb"),
    ("personas", "demographics", "JSONB DEFAULT '{}'::jsonb"),
    ("personas", "interests", "JSONB DEFAULT '[]'::jsonb"),
    ("personas", "content_preferences", "JSONB DEFAULT '{}'::jsonb"),
    ("personas", "goals_and_triggers", "JSONB DEFAULT '{}'::jsonb"),
    ("personas", "source_account_ids", "JSONB DEFAULT '[]'::jsonb"),
    ("personas", "status", "VARCHAR(32) DEFAULT 'active'"),
    ("workflow_runs", "source_images", "JSONB DEFAULT '[]'::jsonb"),
    ("workflow_node_states", "validation_results", "JSONB DEFAULT '[]'::jsonb"),
    ("workflow_definitions", "default_audience_ids", "JSONB DEFAULT '[]'::jsonb"),
    ("workflow_definitions", "default_rule_set_id", "VARCHAR(36)"),
    ("workflow_node_states", "started_at", "TIMESTAMP"),
]

with engine.connect() as conn:
    try:
        conn.execute(sa_text("CREATE EXTENSION IF NOT EXISTS vector"))
    except Exception:
        pass
    for table, col, col_type in _NEW_COLUMNS:
        try:
            conn.execute(sa_text(f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {col} {col_type}"))
        except Exception:
            pass
    conn.commit()


def _configure_langsmith():
    """Push LangSmith env vars so LangChain auto-traces when a key is set."""
    from app.db.session import SessionLocal
    from app.core.config_store import get_config
    try:
        db = SessionLocal()
        try:
            api_key = get_config(db, "langsmith_api_key")
            project = get_config(db, "langsmith_project") or "adapt-ai"
        finally:
            db.close()
    except Exception:
        api_key = settings.langsmith_api_key
        project = settings.langsmith_project or "adapt-ai"

    if api_key:
        os.environ["LANGCHAIN_TRACING_V2"] = "true"
        os.environ["LANGCHAIN_API_KEY"] = api_key
        os.environ["LANGCHAIN_PROJECT"] = project
    else:
        os.environ.pop("LANGCHAIN_TRACING_V2", None)


_configure_langsmith()


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "env": settings.environment}
