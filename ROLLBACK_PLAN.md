# Rollback plan — multi-container → single-container

Practically drilled on 2026-08-16 (not just documented): full rollback took **~1.1s**, full roll-forward back to the 3-instance state took **~3.9s** (mostly replica container startup). Both directions verified working (direct `curl` to each instance + through Nginx) before restoring the tested 3-instance deployment.

## Rollback (3 instances → 1)

```bash
# 1. Restore the single-backend Nginx config (no upstream block)
sudo cp /etc/nginx/sites-available/iph-superapp /etc/nginx/sites-available/iph-superapp.lb-backup
# edit sites-available/iph-superapp: replace `proxy_pass http://iph_app_backend;`
# with `proxy_pass http://127.0.0.1:3002;` and remove the `upstream iph_app_backend {...}` block
sudo nginx -t   # MUST pass before reload — this Nginx instance also serves appapn,
                # chatbot.iphexpo.com, and 2 rasayesh.com booking domains
sudo systemctl reload nginx

# 2. Stop (don't remove) the extra replicas — keeps them ready for fast roll-forward
sudo docker stop iph-app-3010 iph-app-3011
```

`iph-app` on port 3002 keeps running throughout — it's the one Nginx falls back to. No container restart needed on the primary instance, so this path has zero downtime for traffic already landing on 3002 and only a momentary reload blip (Nginx reload is graceful — in-flight connections finish on the old worker) for traffic that would have gone to 3010/3011.

## Roll-forward (1 instance → 3)

```bash
sudo docker start iph-app-3010 iph-app-3011
sleep 3   # let them finish booting + connect to Redis before sending traffic
sudo nginx -t   # re-validate the load-balanced config (restore from backup or re-edit)
sudo systemctl reload nginx
```

## Why this is safe to drill live

- `proxy.js`'s Redis-backed cache (the fix deployed in this task) fails open to a direct DB query if Redis is unreachable — this doesn't come up during a normal rollback (Redis itself isn't touched), but means single-container operation post-rollback is functionally identical to how the app behaved before any of this scaling work, module-scope caches and all — verified in isolation earlier in this task.
- Stopping (not removing) the replica containers keeps their image/config intact, so roll-forward doesn't require a rebuild — just `docker start`.
- Nginx's default `proxy_next_upstream` behavior means even mid-rollback, if a request happens to land on a upstream mid-stop, Nginx retries the next one automatically — this was relied on during the original 3002 image swap in this deployment and held up.

## Full re-verification after either direction

```bash
# Individual instance health (bypass Nginx)
for port in 3002 3010 3011; do curl -s -o /dev/null -w "$port: %{http_code}\n" http://localhost:$port/login; done

# Through Nginx (force IPv4 — an unrelated pre-existing default_server catches ::1 on this host)
curl -4 -s -o /dev/null -w "%{http_code}\n" -H "Host: app.iphexpo.com" http://127.0.0.1/login
```

## What rollback does NOT undo

- The `proxy.js` code change (Redis-backed `getAppPages()`/`getCurrentTokenVersion()`) stays in the deployed image regardless of instance count — it's backward-compatible with single-instance operation (same fail-open behavior verified in isolation), so there's no separate "code rollback" needed alongside the "instance count rollback." If a full revert to the pre-fix code is ever needed, that's a separate `git revert` + rebuild, not part of this fast-path drill.
