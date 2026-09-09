# Building the iph-app frontend image

## Standard build (US relay server, CI, most environments)

    cd frontend
    docker build -t iph-app .

Uses the official npm registry (https://registry.npmjs.org) by default.

## Building on the production VPS (37.152.190.227)

This VPS cannot complete a TLS handshake to `registry.npmjs.org` (SNI-based
network filtering — TCP and DNS to the host succeed, only the TLS handshake
hangs forever). `registry.npmmirror.com`, `repo.huaweicloud.com` and
`registry.yarnpkg.com` are blocked the same way.

`https://mirrors.tencent.com/npm/` IS reachable and serves a complete npm
registry (verified 2026-09-09: `npm ping`, `npm view`, `npm pack` all work).
Integrity is still enforced against the committed `package-lock.json`
(lockfileVersion 3 — npm checks each package sha512 hash regardless of which
registry serves the bytes), so the mirror cannot alter package contents.

Build command to use on this VPS:

    cd /home/ubuntu/iph-app/frontend
    setsid nohup sudo docker build \
      --build-arg NPM_REGISTRY=https://mirrors.tencent.com/npm/ \
      -t iph-app . > /tmp/iph-app-build.log 2>&1 < /dev/null &

(`setsid nohup ... &` so the build survives an SSH disconnect. Poll
`/tmp/iph-app-build.log` for `Successfully built`.)

The registry override is a Dockerfile build-arg (`ARG NPM_REGISTRY`, default
official npm) — it is NOT baked into `.npmrc` or `package.json`, so no other
environment is affected.
