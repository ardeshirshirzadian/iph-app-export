#!/usr/bin/env bash
# One-time infra setup: the iph-redis container backing the cacheHandler in
# next.config.mjs / lib/cache-handler-redis.js. Safe to re-run — every step
# checks whether it's already done first.
#
# Run: bash scripts/setup-redis-cache.sh
#
# See REDIS_MIGRATION_PHASE1_POC.md / REDIS_MIGRATION_PHASE2_REPORT.md for
# the full investigation behind these choices.

set -euo pipefail

NETWORK="iph-cache-net"
REDIS_CONTAINER="iph-redis"
APP_CONTAINER="iph-app"

# ── Network ──────────────────────────────────────────────────────────────
# A dedicated network rather than the default `bridge` iph-app/iph-postgres
# currently sit on: Postgres is bound to 0.0.0.0 (internet-exposed) and
# Redis has no auth by default, so this deliberately does NOT mirror that.
# A user-defined bridge network also gives real container-name DNS
# resolution (`iph-redis` resolves from iph-app), unlike the default bridge.
if ! sudo docker network inspect "$NETWORK" >/dev/null 2>&1; then
  echo "Creating network $NETWORK..."
  sudo docker network create "$NETWORK"
else
  echo "Network $NETWORK already exists, skipping."
fi

# ── Redis container ──────────────────────────────────────────────────────
# - No published port at all (not even loopback-only) — reachable only from
#   containers on $NETWORK. More isolated than Postgres currently is.
# - maxmemory 256mb: generous headroom. Actual payload sizes range from
#   under 1.4KB (most admin-config JSON blobs in app_settings) up to just
#   over 1MB (the map/booth layout data, the single largest entry found) —
#   256MB comfortably covers the full ~46-tag working set many times over.
# - allkeys-lru: safe eviction under memory pressure. Every cached entry
#   here is regenerable on a cache miss (it's a cache, not a data store),
#   so LRU eviction never risks losing anything that can't be recomputed.
# - No persistence (--save "" disables RDB snapshots, --appendonly no
#   disables AOF): deliberate. Losing all cached data on a Redis restart
#   just means the next request to each route regenerates it fresh — no
#   different in effect from a cold cache-handler-redis.js fail-open, and
#   avoids the disk I/O and container weight persistence would add for
#   data that's cheap to regenerate anyway.
if ! sudo docker inspect "$REDIS_CONTAINER" >/dev/null 2>&1; then
  echo "Creating $REDIS_CONTAINER container..."
  sudo docker run -d --name "$REDIS_CONTAINER" \
    --network "$NETWORK" \
    --restart unless-stopped \
    redis:7-alpine \
    redis-server --maxmemory 256mb --maxmemory-policy allkeys-lru --save "" --appendonly no
else
  echo "Container $REDIS_CONTAINER already exists, skipping."
fi

# ── Attach iph-app to the network ───────────────────────────────────────
# `docker network connect` on a running container is non-disruptive (adds
# a network interface without a restart) — safe to run against the live
# app container. NOTE: if iph-app is ever removed and recreated (e.g. a
# fresh `docker run` after `docker rm`), it comes back on the default
# bridge ONLY — this step must be repeated (or re-run this whole script)
# after every `docker rm iph-app` + `docker run ... iph-app` cycle, or the
# app won't be able to reach iph-redis and cache-handler-redis.js will
# just fail open (slower, not broken — but you'd lose the Redis benefit
# silently until this is re-run).
if sudo docker inspect "$APP_CONTAINER" >/dev/null 2>&1; then
  if ! sudo docker inspect "$APP_CONTAINER" --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}' | grep -qw "$NETWORK"; then
    echo "Connecting $APP_CONTAINER to $NETWORK..."
    sudo docker network connect "$NETWORK" "$APP_CONTAINER"
  else
    echo "$APP_CONTAINER already connected to $NETWORK, skipping."
  fi
else
  echo "$APP_CONTAINER container not found — run this again after it's deployed, or connect it manually:"
  echo "  docker network connect $NETWORK $APP_CONTAINER"
fi

echo "Done. Verify with: sudo docker exec $REDIS_CONTAINER redis-cli ping"
