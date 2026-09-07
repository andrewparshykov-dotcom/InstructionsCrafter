#!/bin/bash
# InstructionsCrafter domain migration, PHASE 1 (additive).
# Adds https://instrcrafter.safeshieldins.com as a second hostname for the backend (uvicorn on 127.0.0.1:8000).
# Does NOT touch the instruction-generator site or the instructionscrafter.com certificate.
# Run as root: Azure Run command already is; over SSH use: sudo bash -s < phase1_add_hostname.sh
# Aborts at the first failed check and says what to do. Rollback: phase1_rollback.sh
# Run-command safe: no backslashes anywhere in this file.
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
  local rc=0
  want agent.safeshieldins.com / 303 || rc=1
  wantbody claude-files.safeshieldins.com /healthz '"ok":true' || rc=1
  wantbody claude-mail.safeshieldins.com /healthz '"ok":true' || rc=1
  return $rc
}
NEW=instrcrafter.safeshieldins.com
NAME=instruction-generator-ssi
SITE=/etc/nginx/sites-available/$NAME
LINK=/etc/nginx/sites-enabled/$NAME
TS=$(date +%Y%m%d-%H%M%S)
LOG=/root/phase1-$TS.log
fail() { echo "ABORT: $1"; echo "Details: $LOG (if it exists). Rollback: phase1_rollback.sh"; exit 1; }

echo "== 0 preflight"
[ "$(id -u)" = 0 ] || fail "must run as root"
nginx -t >/dev/null 2>&1 || fail "nginx -t already fails; fix that first"
[ -e "$SITE" ] && fail "$SITE already exists"
[ -e "$LINK" ] && fail "$LINK already exists"
[ "$(ls /etc/nginx/sites-enabled | head -1)" = instruction-generator ] || fail "instruction-generator is not the first-loaded site any more; re-check the layout"
getent ahostsv4 "$NEW" | grep -q '4.227.180.120' || fail "DNS for $NEW does not point at this VM"
certbot certificates 2>/dev/null | grep -q "Certificate Name: $NEW" && fail "a certificate for $NEW already exists"
want instructionscrafter.com / 404 || fail "baseline: old hostname root"
want instructionscrafter.com /api/health 200 || fail "baseline: old hostname api"
siblings_ok || fail "baseline: a sibling service is unhealthy"

echo "== 1 backups"
tar czf /root/nginx-before-phase1-$TS.tgz /etc/nginx 2>/dev/null || fail "backup of /etc/nginx"
tar czf /root/letsencrypt-before-phase1-$TS.tgz /etc/letsencrypt 2>/dev/null || fail "backup of /etc/letsencrypt"
echo "saved /root/nginx-before-phase1-$TS.tgz and /root/letsencrypt-before-phase1-$TS.tgz"

echo "== 2 new site (HTTP only; certbot adds the HTTPS half in step 3)"
cat > "$SITE" <<'NGX'
# InstructionsCrafter backend (uvicorn on 127.0.0.1:8000) at https://instrcrafter.safeshieldins.com/
# Added by docs/migration/phase1_add_hostname.sh (InstructionsCrafter repo), 2026-09.
# instruction-generator (instructionscrafter.com) is the legacy hostname for the same app.
#
# This file name must keep sorting AFTER "instruction-generator" in sites-enabled:
# nothing declares default_server, so nginx's first-loaded block is the catch-all for
# unknown hostnames, and that must stay instruction-generator until Phase 3 retires it.
server {
    listen 80;
    listen [::]:80;
    server_name instrcrafter.safeshieldins.com;

    access_log /var/log/nginx/instrcrafter.access.log;
    error_log /var/log/nginx/instrcrafter.error.log;

    client_max_body_size 500M;

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
}
NGX
ln -s "$SITE" "$LINK"
if ! nginx -t >>"$LOG" 2>&1; then rm -f "$LINK" "$SITE"; tail -5 "$LOG"; fail "nginx -t rejected the new site; it was removed again, nothing is changed"; fi
systemctl reload nginx || fail "nginx reload"
sleep 2
echo "sites-enabled order: $(ls /etc/nginx/sites-enabled)"
want instructionscrafter.com /api/health 200 || fail "old hostname broke after reload"
siblings_ok || fail "a sibling broke after reload"
want "$NEW" /api/health 200 http || fail "new hostname over HTTP does not reach the app"

echo "== 3 certificate for $NEW only (scoped with --cert-name and -d)"
if ! certbot --nginx --non-interactive --agree-tos --redirect --cert-name "$NEW" -d "$NEW" >>"$LOG" 2>&1; then tail -15 "$LOG"; fail "certbot failed (certbot restores the nginx config itself)"; fi
nginx -t >>"$LOG" 2>&1 || fail "nginx -t after certbot"
systemctl reload nginx || fail "nginx reload after certbot"
sleep 2

echo "== 4 verify"
rc=0
want "$NEW" /api/health 200 || rc=1
want "$NEW" / 404 || rc=1
want "$NEW" /privacy 200 || rc=1
want "$NEW" /api/health 301 http || rc=1
want instructionscrafter.com /api/health 200 || rc=1
want instructionscrafter.com / 404 || rc=1
want www.instructionscrafter.com / 404 || rc=1
siblings_ok || rc=1
if curl -sS -m 25 -D - -o /dev/null --resolve "$NEW:443:127.0.0.1" -H 'Origin: chrome-extension://fcogglgcploggfgchifbeaoofljfgmoc' "https://$NEW/api/health" 2>/dev/null | grep -qi 'access-control-allow-origin: chrome-extension'; then echo "ok    CORS header on new hostname"; else echo "FAIL  no CORS header on new hostname"; rc=1; fi
echo "default certificate (no hostname sent) is still: $(echo | openssl s_client -noservername -connect 127.0.0.1:443 2>/dev/null | openssl x509 -noout -subject 2>/dev/null)"
echo "new hostname certificate: $(echo | openssl s_client -servername $NEW -connect 127.0.0.1:443 2>/dev/null | openssl x509 -noout -subject -enddate 2>/dev/null | paste -sd ' ')"
certbot certificates 2>/dev/null | grep -A2 "Certificate Name: $NEW" | grep -E 'Name|Expiry'
echo "sites-enabled order: $(ls /etc/nginx/sites-enabled)"
[ $rc = 0 ] || fail "a verification check failed (see above)"
echo "PHASE 1 COMPLETE. Log: $LOG"
