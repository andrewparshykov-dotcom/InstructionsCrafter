#!/bin/bash
# InstructionsCrafter domain migration, PHASE 2 (nginx part). DRAFT until Phase 1 is confirmed.
# Converts the legacy instructionscrafter.com site into a permanent redirect to https://instrcrafter.safeshieldins.com,
# keeping path and query string, and starts logging the requested hostname so Phase 3 can be decided on evidence.
# PRECONDITIONS (checked by a human, not by this script):
#   - Phase 1 is complete and verified.
#   - The extension release that points at the new hostname is LIVE on the Chrome Web Store and the team has updated.
#   - The Chrome Web Store privacy-policy URL now points at https://instrcrafter.safeshieldins.com/privacy.
# Run as root. Rollback: phase2_rollback.sh (a single copy-back).
# Usage: CONFIRM=yes bash phase2_legacy_redirect.sh
set -u
# Shared helpers for the InstructionsCrafter domain-migration scripts.
# This file is pasted verbatim at the top of each phase script (Run command takes one script at a time).
# Rules: no backslashes anywhere (Azure Run command mangles them), terse output, root required.
# Checks use curl --resolve so they go to this machine (127.0.0.1) with the right hostname and TLS name,
# which does not depend on the VM being able to reach its own public IP.
want() {
  # want HOST PATH EXPECTED_CODE [http]
  scheme=https; port=443
  if [ "${4:-}" = http ]; then scheme=http; port=80; fi
  code=$(curl -sS -o /dev/null -m 25 --resolve "$1:$port:127.0.0.1" -w '%{http_code}' "$scheme://$1$2" 2>/dev/null)
  if [ "$code" = "$3" ]; then echo "ok    $3  $scheme://$1$2"; else echo "FAIL  got $code wanted $3  $scheme://$1$2"; return 1; fi
}
wantbody() {
  # wantbody HOST PATH SUBSTRING
  body=$(curl -sS -m 25 --resolve "$1:443:127.0.0.1" "https://$1$2" 2>/dev/null)
  case "$body" in *"$3"*) echo "ok    body  https://$1$2";; *) echo "FAIL  body [$body] lacks $3  https://$1$2"; return 1;; esac
}
location_of() {
  # location_of HOST PATH  -> prints the Location header target (redirect_url) of the response
  curl -sS -o /dev/null -m 25 --resolve "$1:443:127.0.0.1" -w '%{redirect_url}' "https://$1$2" 2>/dev/null
}
siblings_ok() {
  rc=0
  want agent.safeshieldins.com / 303 || rc=1
  wantbody claude-files.safeshieldins.com /healthz '"ok":true' || rc=1
  wantbody claude-mail.safeshieldins.com /healthz '"ok":true' || rc=1
  return $rc
}
NEW=instrcrafter.safeshieldins.com
OLD=instructionscrafter.com
SITE=/etc/nginx/sites-available/instruction-generator
TS=$(date +%Y%m%d-%H%M%S)
LOG=/root/phase2-$TS.log
BAK=/root/instruction-generator.site.before-phase2-$TS
fail() { echo "ABORT: $1"; echo "Details: $LOG. Rollback: phase2_rollback.sh"; exit 1; }
restore() { cp -a "$BAK" "$SITE"; rm -f /etc/nginx/conf.d/log_with_host.conf; nginx -t >>"$LOG" 2>&1 && systemctl reload nginx; echo "restored the previous site file from $BAK"; }

echo "== 0 preflight"
[ "${CONFIRM:-no}" = yes ] || fail "read the PRECONDITIONS at the top of this file, then run: CONFIRM=yes bash phase2_legacy_redirect.sh"
[ "$(id -u)" = 0 ] || fail "must run as root"
nginx -t >/dev/null 2>&1 || fail "nginx -t already fails"
[ -e /etc/nginx/sites-enabled/instruction-generator-ssi ] || fail "the Phase 1 site is missing"
[ "$(ls /etc/nginx/sites-enabled | head -1)" = instruction-generator ] || fail "instruction-generator is not the first-loaded site; re-check"
grep -q 'return 308' "$SITE" && fail "the legacy site already redirects; nothing to do"
want "$NEW" /api/health 200 || fail "new hostname is not healthy; fix that first"
want "$OLD" / 404 || fail "baseline: old hostname"
siblings_ok || fail "baseline: a sibling service is unhealthy"

echo "== 1 backups"
tar czf /root/nginx-before-phase2-$TS.tgz /etc/nginx 2>/dev/null || fail "backup /etc/nginx"
tar czf /root/letsencrypt-before-phase2-$TS.tgz /etc/letsencrypt 2>/dev/null || fail "backup /etc/letsencrypt"
cp -a "$SITE" "$BAK" || fail "copy of the legacy site file"
echo "saved $BAK plus the two tgz backups in /root"

echo "== 2 log format that includes the requested hostname"
cat > /etc/nginx/conf.d/log_with_host.conf <<'NGX'
# Default "combined" log lines do not record which hostname was asked for. This format does,
# so the legacy instructionscrafter.com block can prove (Phase 3) that nothing still calls it.
log_format with_host '$remote_addr - [$time_local] "$host" "$request" $status $body_bytes_sent "$http_user_agent"';
NGX

echo "== 3 rewrite the legacy site as a redirect"
cat > "$SITE" <<'NGX'
# LEGACY hostname instructionscrafter.com (+ www): permanent redirect to the company hostname.
# Written by docs/migration/phase2_legacy_redirect.sh (InstructionsCrafter repo), 2026-09.
#
# Keep this file FIRST in sites-enabled until Phase 3: nothing declares default_server, so the
# first-loaded block is the catch-all for unknown hostnames, and it must keep behaving as before.
# Keep the certificate renewing while this file exists: an HTTPS redirect needs a valid cert.
#
# 308, not 301: an old extension build POSTs the recording to /api/jobs/generate. A 308 keeps the
# method and body across the hop; a 301 would turn the POST into a GET and the upload would fail.
server {
    server_name instructionscrafter.com www.instructionscrafter.com;
    access_log /var/log/nginx/instructionscrafter-legacy.access.log with_host;
    client_max_body_size 500M;

    if ($host = www.instructionscrafter.com) {
        return 308 https://instrcrafter.safeshieldins.com$request_uri;
    }
    if ($host = instructionscrafter.com) {
        return 308 https://instrcrafter.safeshieldins.com$request_uri;
    }

    # Any other hostname lands here only because this block is the catch-all.
    # Same behaviour as before Phase 2: proxy to the app.
    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }

    listen [::]:443 ssl ipv6only=on; # managed by Certbot
    listen 443 ssl; # managed by Certbot
    ssl_certificate /etc/letsencrypt/live/instructionscrafter.com/fullchain.pem; # managed by Certbot
    ssl_certificate_key /etc/letsencrypt/live/instructionscrafter.com/privkey.pem; # managed by Certbot
    include /etc/letsencrypt/options-ssl-nginx.conf; # managed by Certbot
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem; # managed by Certbot
}
server {
    if ($host = www.instructionscrafter.com) {
        return 308 https://instrcrafter.safeshieldins.com$request_uri;
    } # managed by Certbot

    if ($host = instructionscrafter.com) {
        return 308 https://instrcrafter.safeshieldins.com$request_uri;
    } # managed by Certbot

    listen 80;
    listen [::]:80;
    server_name instructionscrafter.com www.instructionscrafter.com;
    access_log /var/log/nginx/instructionscrafter-legacy.access.log with_host;
    return 404; # managed by Certbot
}
NGX
if ! nginx -t >>"$LOG" 2>&1; then tail -5 "$LOG"; restore; fail "nginx -t rejected the redirect config; previous file restored"; fi
systemctl reload nginx || fail "nginx reload"

echo "== 4 verify"
rc=0
want "$OLD" / 308 || rc=1
want www.instructionscrafter.com / 308 || rc=1
want "$OLD" / 308 http || rc=1
t=$(location_of "$OLD" '/api/jobs/abc?x=1'); if [ "$t" = "https://$NEW/api/jobs/abc?x=1" ]; then echo "ok    path and query preserved: $t"; else echo "FAIL  redirect target is [$t]"; rc=1; fi
code=$(curl -sS -L -o /dev/null -m 25 --resolve "$OLD:443:127.0.0.1" --resolve "$NEW:443:127.0.0.1" -w '%{http_code}' "https://$OLD/api/health" 2>/dev/null); if [ "$code" = 200 ]; then echo "ok    following the redirect reaches the app (200)"; else echo "FAIL  following the redirect gave $code"; rc=1; fi
code=$(curl -sS -L -o /dev/null -m 25 --resolve "$OLD:443:127.0.0.1" --resolve "$NEW:443:127.0.0.1" -X POST -F title=probe -F password=probe -w '%{http_code}' "https://$OLD/api/jobs/generate" 2>/dev/null); case "$code" in 400|401|413|422) echo "ok    a POST survives the hop (app answered $code, not 405)";; *) echo "FAIL  POST after redirect gave $code (405 means the method was lost)"; rc=1;; esac
want "$NEW" /api/health 200 || rc=1
code=$(curl -sk -o /dev/null -m 25 -w '%{http_code}' https://127.0.0.1/api/health 2>/dev/null); if [ "$code" = 200 ]; then echo "ok    unknown-hostname HTTPS still proxies to the app (catch-all unchanged)"; else echo "FAIL  catch-all HTTPS gave $code"; rc=1; fi
code=$(curl -s -o /dev/null -m 25 -w '%{http_code}' http://127.0.0.1/ 2>/dev/null); if [ "$code" = 404 ]; then echo "ok    unknown-hostname HTTP still answers 404 (catch-all unchanged)"; else echo "FAIL  catch-all HTTP gave $code"; rc=1; fi
siblings_ok || rc=1
echo "legacy log sample (IP masked):"; tail -2 /var/log/nginx/instructionscrafter-legacy.access.log 2>/dev/null | sed -E 's/^[0-9a-f.:]+/x.x.x.x/'
echo "== 5 renewal still works with the redirect in place (staging dry run; the real certificate is untouched)"
if certbot renew --cert-name "$OLD" --dry-run >>"$LOG" 2>&1; then echo "ok    certbot dry-run renewal for $OLD"; else tail -15 "$LOG"; echo "FAIL  dry-run renewal"; rc=1; fi
if [ $rc != 0 ]; then restore; fail "a verification failed; the previous site file was restored"; fi
echo "PHASE 2 (nginx) COMPLETE. Log: $LOG"
echo "Next: run one real generation from an OLD build pointed at https://$OLD (Options page) to confirm the safety net,"
echo "then let /var/log/nginx/instructionscrafter-legacy.access.log accumulate and use phase3_check.sh."
