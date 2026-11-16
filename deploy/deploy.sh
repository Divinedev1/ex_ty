#!/bin/sh
set -eu

TAG=${1:?usage: deploy.sh <image-tag>}
cd "$(dirname "$0")"

[ -f .env ] || { echo "missing .env" >&2; exit 1; }
[ -f app.env ] || { echo "missing app.env" >&2; exit 1; }

set -a
. ./.env
set +a

PREV=$(cat .current-tag 2>/dev/null || true)
export IMAGE_TAG="$TAG"

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
compose() { docker compose -f compose.prod.yaml "$@"; }

log "deploying ${IMAGE_NAME}:${TAG}"
if [ -n "${GHCR_TOKEN:-}" ]; then
    printf '%s' "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USER" --password-stdin >/dev/null
fi

compose pull app migrate
compose up -d --wait postgres redis rabbit_mq

mkdir -p backups
DUMP="backups/pre-${TAG}.sql"
if compose exec -T postgres pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" > "$DUMP"; then
    gzip -f "$DUMP"
    log "backed up database to ${DUMP}.gz"
else
    rm -f "$DUMP"
    log "database backup failed; aborting"
    exit 1
fi
find backups -type f -name 'pre-*.sql.gz' -mtime +7 -delete

if ! compose up -d --wait --remove-orphans; then
    log "deployment failed"
    if [ -n "$PREV" ]; then
        log "rolling back to ${PREV}"
        IMAGE_TAG="$PREV" compose up -d --wait --remove-orphans || true
    fi
    exit 1
fi

healthy=0
i=0
while [ "$i" -lt 30 ]; do
    if curl -fsS http://127.0.0.1:8080/health/ready >/dev/null; then
        healthy=1
        break
    fi
    i=$((i + 1))
    sleep 2
done

if [ "$healthy" -ne 1 ]; then
    log "readiness check failed"
    if [ -n "$PREV" ]; then
        log "rolling back to ${PREV}"
        IMAGE_TAG="$PREV" compose up -d --wait --remove-orphans || true
    fi
    exit 1
fi

printf '%s\n' "$TAG" > .current-tag
docker image prune -af --filter "until=168h" >/dev/null 2>&1 || true
log "deployed ${IMAGE_NAME}:${TAG}"
