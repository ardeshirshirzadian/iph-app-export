#!/usr/bin/env bash
# Recreates the 3 production iph-app containers (iph-app-3010, iph-app-3011,
# iph-app) one at a time from a given image tag.
#
# This is the ONLY way to recreate these containers. Never hand-type a
# `docker run` for a deploy -- a hand-typed command dropped the uploads bind
# mount on 2026-09-24 and again on 2026-10-02 (public/uploads is a bind mount
# per CLAUDE.md's File Upload Persistence Rule; forgetting -v silently serves
# everything from the image's empty uploads dir until the next restart).
#
# Every flag below was captured verbatim from `docker inspect` on the then-
# live containers on 2026-10-02 (see CLAUDE.md's Deploy section) and verified
# to reproduce identical Image/Mounts/PortBindings/NetworkMode/RestartPolicy/
# env-var-names before this script replaced hand-typed commands as the
# deploy procedure. If any of these ever need to change (new mount, new
# port, new network), change it HERE and re-verify with `docker inspect`,
# not ad hoc on the command line.
#
# Usage: sudo bash deploy.sh <image-tag>
# Example: sudo bash deploy.sh iph-app:release-20261005-somefeature
#
# This script only recreates containers -- it does NOT build the image, diff
# it against what's running, or tag a rollback/release. Those steps (per
# CLAUDE.md's Deploy section) happen before/after calling this script.
set -euo pipefail

IMAGE="${1:?Usage: deploy.sh <image-tag>}"
ENV_FILE="/home/ubuntu/iph-app/frontend/.env.local"
UPLOADS_MOUNT="/home/ubuntu/iph-superapp-uploads:/app/public/uploads"
NETWORK="iph-cache-net"

if ! docker image inspect "$IMAGE" > /dev/null 2>&1; then
  echo "Image $IMAGE not found locally. Build it first (see BUILD.md)." >&2
  exit 1
fi

# name:port pairs, recreated one at a time so nginx's upstream always has at
# least 2 of 3 backends up during the rollout.
CONTAINERS=(
  "iph-app-3010:3010"
  "iph-app-3011:3011"
  "iph-app:3002"
)

for entry in "${CONTAINERS[@]}"; do
  name="${entry%%:*}"
  port="${entry##*:}"
  echo "=== Recreating $name (port $port) from $IMAGE ==="
  docker stop "$name"
  docker rm "$name"
  docker run -d --name "$name" \
    --network "$NETWORK" \
    -p "0.0.0.0:${port}:3000" \
    --env-file "$ENV_FILE" \
    -e NODE_ENV=production \
    -v "$UPLOADS_MOUNT" \
    "$IMAGE"
  sleep 5
  code=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:${port}/")
  echo "$name responded HTTP $code"
  if [ "$code" != "307" ] && [ "$code" != "200" ]; then
    echo "WARNING: $name did not respond as expected after recreate -- check 'docker logs $name' before continuing to the next container." >&2
  fi
done

echo "Done. Sanity check: docker inspect <name> --format '{{json .Mounts}}' on each."
