#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="${ROOT_DIR}/backend"
FRONTEND_DIR="${ROOT_DIR}/frontend"
LOG_DIR="${ROOT_DIR}/logs"
BACKEND_LOG="${LOG_DIR}/backend.log"
FRONTEND_LOG="${LOG_DIR}/frontend.log"
BACKEND_PID_FILE="${LOG_DIR}/backend.pid"
FRONTEND_PID_FILE="${LOG_DIR}/frontend.pid"
BACKEND_URL="http://127.0.0.1:8000"
FRONTEND_URL="http://127.0.0.1:5173"
BACKEND_PORT="8000"

kill_listener_on_port() {
  local port="$1"
  local pids
  pids="$(lsof -tiTCP:${port} -sTCP:LISTEN || true)"
  if [[ -n "${pids}" ]]; then
    echo "==> Killing stale listener(s) on port ${port}: ${pids}"
    # shellcheck disable=SC2086
    kill ${pids} || true
    sleep 1
    pids="$(lsof -tiTCP:${port} -sTCP:LISTEN || true)"
    if [[ -n "${pids}" ]]; then
      echo "==> Force killing listener(s) on port ${port}: ${pids}"
      # shellcheck disable=SC2086
      kill -9 ${pids} || true
      sleep 1
    fi
  fi
}

usage() {
  cat <<EOF
Usage: $0

One-command setup for a new machine:
1) starts Docker infra
2) installs backend/frontend dependencies
3) starts backend + frontend
4) prepopulates demo data
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1"
      usage
      exit 1
      ;;
  esac
done

echo "==> Project root: ${ROOT_DIR}"

echo "==> Checking required tools..."
for tool in docker python3 npm; do
  if ! command -v "${tool}" >/dev/null 2>&1; then
    echo "Missing required tool: ${tool}"
    exit 1
  fi
done

if ! docker info >/dev/null 2>&1; then
  echo "Docker is not running. Start Docker Desktop and retry."
  exit 1
fi

echo "==> Starting infrastructure (Postgres, Redis, Temporal, ClickHouse, MinIO)..."
docker compose -f "${ROOT_DIR}/docker-compose.yml" up -d

echo "==> Preparing backend environment..."
if [[ ! -f "${BACKEND_DIR}/.env" && -f "${BACKEND_DIR}/.env.example" ]]; then
  cp "${BACKEND_DIR}/.env.example" "${BACKEND_DIR}/.env"
  echo "Created backend/.env from .env.example"
fi

if [[ ! -d "${BACKEND_DIR}/.venv" ]]; then
  python3 -m venv "${BACKEND_DIR}/.venv"
fi

"${BACKEND_DIR}/.venv/bin/python" -m pip install --upgrade pip
"${BACKEND_DIR}/.venv/bin/pip" install -r "${BACKEND_DIR}/requirements.txt"

echo "==> Installing frontend dependencies..."
npm --prefix "${FRONTEND_DIR}" install

mkdir -p "${LOG_DIR}"

if lsof -tiTCP:${BACKEND_PORT} -sTCP:LISTEN >/dev/null 2>&1; then
  echo "==> Port ${BACKEND_PORT} is occupied. Restarting backend listener..."
  kill_listener_on_port "${BACKEND_PORT}"
fi

echo "==> Starting backend..."
(
  cd "${BACKEND_DIR}"
  nohup ./.venv/bin/uvicorn app.main:app --reload --host 127.0.0.1 --port 8000 \
    > "${BACKEND_LOG}" 2>&1 &
  echo $! > "${BACKEND_PID_FILE}"
)

echo "==> Starting frontend..."
(
  cd "${FRONTEND_DIR}"
  nohup npm run dev -- --host 127.0.0.1 --port 5173 \
    > "${FRONTEND_LOG}" 2>&1 &
  echo $! > "${FRONTEND_PID_FILE}"
)

echo "==> Prepopulating demo data..."
"${BACKEND_DIR}/.venv/bin/python" - <<'PY'
import json
import time
import urllib.request
import urllib.error

BASE = "http://127.0.0.1:8000"

def req(method, path, payload=None):
    last_exc = None
    for _ in range(5):
        try:
            url = BASE + path
            data = None
            headers = {}
            if payload is not None:
                data = json.dumps(payload).encode("utf-8")
                headers["Content-Type"] = "application/json"
            request = urllib.request.Request(url, data=data, headers=headers, method=method)
            with urllib.request.urlopen(request, timeout=30) as resp:
                body = resp.read().decode("utf-8")
                return json.loads(body) if body else None
        except Exception as exc:
            last_exc = exc
            time.sleep(1)
    raise last_exc

voices = req("GET", "/v1/voices")
personas = req("GET", "/v1/personas")
rule_sets = req("GET", "/v1/rule-sets")
workflows = req("GET", "/v1/workflows")

if not voices:
    req("POST", "/v1/voices", {
        "name": "Default Brand Voice",
        "purpose": "Educational, concise, practical content",
        "source_account_ids": [],
        "training_period": "6mo",
    })
    voices = req("GET", "/v1/voices")

if not personas:
    req("POST", "/v1/personas", {
        "name": "Growth Marketer",
        "persona_type": "audience",
        "description": "Busy marketer looking for actionable social strategy",
        "writing_approach": "Practical and example-driven",
        "enabled_tools": [
            "audience_platform_research",
            "trends_social_listening",
        ],
    })
    personas = req("GET", "/v1/personas")

if not rule_sets:
    seeded = req("POST", "/v1/rule-sets/seed")
    rule_sets = seeded if isinstance(seeded, list) else req("GET", "/v1/rule-sets")

if not workflows:
    voice_id = voices[0]["id"] if voices else None
    persona_id = personas[0]["id"] if personas else None
    rule_set_id = rule_sets[0]["id"] if rule_sets else None
    req("POST", "/v1/workflows", {
        "name": "Default Adapt Workflow",
        "description": "Auto-generated starter workflow",
        "platforms": ["linkedin", "x", "instagram", "facebook"],
        "default_voice_id": voice_id,
        "default_agent_id": persona_id,
        "default_audience_ids": [],
        "default_rule_set_id": rule_set_id,
        "per_platform_config": {},
    })

print("Demo data ready.")
PY

echo
echo "Setup complete. Everything is running."
echo
echo "Frontend: ${FRONTEND_URL}"
echo "Backend health: ${BACKEND_URL}/health"
echo "Backend log: ${BACKEND_LOG}"
echo "Frontend log: ${FRONTEND_LOG}"
echo "Note: add API keys in ${BACKEND_DIR}/.env or in-app Settings."
