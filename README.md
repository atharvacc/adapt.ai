# Adapt AI Local Prototype

Local-first prototype for multi-platform social content adaptation.

## What is implemented now

- FastAPI backend with:
  - `POST /v1/runs` for multi-platform variant generation (LinkedIn, X, Instagram, TikTok)
  - `GET /v1/runs/{run_id}` to fetch persisted run state
  - `PUT /v1/runs/{run_id}/nodes/{platform}/variants/{variant_id}` to accept/edit variants
  - `POST /v1/runs/{run_id}/nodes/{platform}/variants/{variant_id}/regenerate` for per-variant regen
  - workflow DAG persistence endpoints:
    - `POST /v1/workflows`, `GET /v1/workflows`
    - `POST /v1/workflows/{workflow_id}/runs`, `GET /v1/workflows/{workflow_id}/runs`
    - `GET /v1/workflows/runs/{run_id}` for node-level DAG state
  - core resource endpoints for accounts, voices, personas, rule sets, workflows, analytics summary
  - health endpoint at `/health`
- React frontend run-studio:
  - source input box
  - generated A/B/C platform variants with rationale panels
  - Accept, Save Edit, and Regenerate actions per variant
  - surface split into `Run Studio`, `Workflow Editor`, `Accounts`, and `Intelligence Hub`
  - route-based navigation via `react-router-dom`
  - Intelligence Hub create/list flows for voices, personas, and rule sets
- Local Docker stack definition:
  - Postgres + pgvector
  - Redis
  - Temporalite
  - ClickHouse
  - MinIO
  - backend + frontend services

## Run locally (without Docker)

Backend:

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Frontend:

```bash
cd frontend
npm install
npm run dev
```

## Run locally (Docker stack)

```bash
docker compose up -d
```

If Docker is not running, start Docker Desktop first and rerun the command.

## Next implementation steps

- Replace stub generation with structured LLM JSON output and retry validation loop
- Add persistent storage for runs/variants/edit deltas
- Build full workflows DAG editor and node-level composition overrides
- Add real OAuth connectors and ingestion jobs per platform
