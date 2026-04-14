#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="${ROOT_DIR}/backups/${TIMESTAMP}"

mkdir -p "${BACKUP_DIR}"

echo "Creating backup in: ${BACKUP_DIR}"

echo "[1/3] Backing up Postgres..."
docker compose -f "${ROOT_DIR}/docker-compose.yml" exec -T postgres \
  pg_dump -U adapt -d adapt -Fc > "${BACKUP_DIR}/postgres.dump"

echo "[2/3] Backing up MinIO data volume..."
MINIO_CONTAINER_ID="$(
  docker compose -f "${ROOT_DIR}/docker-compose.yml" ps -q minio
)"

if [[ -z "${MINIO_CONTAINER_ID}" ]]; then
  echo "MinIO container not running; skipping MinIO backup."
else
  MINIO_VOLUME_NAME="$(
    docker inspect "${MINIO_CONTAINER_ID}" \
      --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Name}}{{end}}{{end}}'
  )"
  if [[ -z "${MINIO_VOLUME_NAME}" ]]; then
    echo "Could not resolve MinIO volume; skipping MinIO backup."
  else
    docker run --rm \
      -v "${MINIO_VOLUME_NAME}:/data:ro" \
      -v "${BACKUP_DIR}:/backup" \
      alpine:3.20 \
      sh -c 'tar -czf /backup/minio-data.tar.gz -C / data'
  fi
fi

echo "[3/3] Writing metadata..."
cat > "${BACKUP_DIR}/metadata.txt" <<EOF
created_at=${TIMESTAMP}
project_root=${ROOT_DIR}
contains_postgres_dump=true
contains_minio_tar=$( [[ -f "${BACKUP_DIR}/minio-data.tar.gz" ]] && echo true || echo false )
EOF

echo "Backup complete:"
echo "  - ${BACKUP_DIR}/postgres.dump"
if [[ -f "${BACKUP_DIR}/minio-data.tar.gz" ]]; then
  echo "  - ${BACKUP_DIR}/minio-data.tar.gz"
fi
echo "  - ${BACKUP_DIR}/metadata.txt"
