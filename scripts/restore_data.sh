#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <backup-directory>"
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="$1"

if [[ ! -d "${BACKUP_DIR}" ]]; then
  echo "Backup directory not found: ${BACKUP_DIR}"
  exit 1
fi

if [[ ! -f "${BACKUP_DIR}/postgres.dump" ]]; then
  echo "Missing ${BACKUP_DIR}/postgres.dump"
  exit 1
fi

echo "Restoring from: ${BACKUP_DIR}"

echo "[1/3] Restoring Postgres..."
docker compose -f "${ROOT_DIR}/docker-compose.yml" exec -T postgres \
  pg_restore -U adapt -d adapt --clean --if-exists < "${BACKUP_DIR}/postgres.dump"

echo "[2/3] Restoring MinIO data volume (if backup exists)..."
if [[ -f "${BACKUP_DIR}/minio-data.tar.gz" ]]; then
  MINIO_CONTAINER_ID="$(
    docker compose -f "${ROOT_DIR}/docker-compose.yml" ps -q minio
  )"
  if [[ -z "${MINIO_CONTAINER_ID}" ]]; then
    echo "MinIO container not running; skipping MinIO restore."
  else
    MINIO_VOLUME_NAME="$(
      docker inspect "${MINIO_CONTAINER_ID}" \
        --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Name}}{{end}}{{end}}'
    )"
    if [[ -z "${MINIO_VOLUME_NAME}" ]]; then
      echo "Could not resolve MinIO volume; skipping MinIO restore."
    else
      docker run --rm \
        -v "${MINIO_VOLUME_NAME}:/data" \
        -v "${BACKUP_DIR}:/backup:ro" \
        alpine:3.20 \
        sh -c 'rm -rf /data/* && tar -xzf /backup/minio-data.tar.gz -C /'
    fi
  fi
else
  echo "No MinIO backup found; skipping."
fi

echo "[3/3] Restore completed."
echo "You may want to restart services:"
echo "  docker compose -f \"${ROOT_DIR}/docker-compose.yml\" restart"
