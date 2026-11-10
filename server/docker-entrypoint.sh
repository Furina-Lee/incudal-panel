#!/bin/sh
set -eu

cd /app/server

MIGRATION_ATTEMPTS="${MIGRATION_ATTEMPTS:-30}"
MIGRATION_RETRY_SECONDS="${MIGRATION_RETRY_SECONDS:-2}"

case "$MIGRATION_ATTEMPTS" in
  ''|*[!0-9]*)
    echo "[startup] MIGRATION_ATTEMPTS must be a positive integer" >&2
    exit 1
    ;;
esac

case "$MIGRATION_RETRY_SECONDS" in
  ''|*[!0-9]*)
    echo "[startup] MIGRATION_RETRY_SECONDS must be a non-negative integer" >&2
    exit 1
    ;;
esac

if [ "$MIGRATION_ATTEMPTS" -lt 1 ]; then
  echo "[startup] MIGRATION_ATTEMPTS must be at least 1" >&2
  exit 1
fi

echo "[startup] Waiting for PostgreSQL and applying database migrations..."

attempt=1
while :; do
  echo "[startup] Prisma migration attempt ${attempt}/${MIGRATION_ATTEMPTS}"
  if npx prisma migrate deploy; then
    echo "[startup] Database migrations completed"
    break
  fi

  if [ "$attempt" -ge "$MIGRATION_ATTEMPTS" ]; then
    echo "[startup] Database migrations failed after ${MIGRATION_ATTEMPTS} attempts; application will not start" >&2
    exit 1
  fi

  echo "[startup] Database is not ready or migration failed; retrying in ${MIGRATION_RETRY_SECONDS}s..." >&2
  attempt=$((attempt + 1))
  sleep "$MIGRATION_RETRY_SECONDS"
done

echo "[startup] Starting application..."
cd /app
exec node server/dist/app.js
