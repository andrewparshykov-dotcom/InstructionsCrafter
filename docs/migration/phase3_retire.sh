#!/bin/bash
# InstructionsCrafter domain migration, PHASE 3: retire the legacy instructionscrafter.com site and its certificate.
# DRAFT until Phase 2 is confirmed. ONLY after phase3_check.sh shows zero extension calls for at least 14 days
# AND every install shows the new extension version.
# After this the new block (instruction-generator-ssi) is the first-loaded block, i.e. the catch-all. Same app, same behaviour.
# Run as root. Rollback: phase3_rollback.sh
# Usage: CONFIRM=yes bash phase3_retire.sh
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
OLD=instructionscrafter.com
NEW=instrcrafter.safeshieldins.com
SITE=/etc/nginx/sites-available/instruction-generator
LINK=/etc/nginx/sites-enabled/instruction-generator
TS=$(date +%Y%m%d-%H%M%S)
LOG=/root/phase3-$TS.log
fail() { echo "ABORT: $1"; echo "Details: $LOG. Rollback: phase3_rollback.sh"; exit 1; }

echo "== 0 preflight"
[ "${CONFIRM:-no}" = yes ] || fail "run phase3_check.sh first; then: CONFIRM=yes bash phase3_retire.sh"
[ "$(id -u)" = 0 ] || fail "must run as root"
nginx -t >/dev/null 2>&1 || fail "nginx -t already fails"
[ -e "$LINK" ] || fail "the legacy site is not enabled; nothing to retire"
[ -e /etc/nginx/sites-enabled/instruction-generator-ssi ] || fail "the new site is missing"
want "$NEW" /api/health 200 || fail "new hostname unhealthy"
siblings_ok || fail "a sibling service is unhealthy"

echo "== 1 backups"
tar czf /root/nginx-before-phase3-$TS.tgz /etc/nginx 2>/dev/null || fail "backup /etc/nginx"
tar czf /root/letsencrypt-before-phase3-$TS.tgz /etc/letsencrypt 2>/dev/null || fail "backup /etc/letsencrypt"
cp -a "$SITE" /root/instruction-generator.site.before-phase3-$TS || fail "copy of the legacy site file"
cp -a /var/log/nginx/instructionscrafter-legacy.access.log /root/instructionscrafter-legacy.access.log.final-$TS 2>/dev/null
echo "saved to /root: nginx + letsencrypt tgz, the site file, and the final legacy log"

echo "== 2 disable the legacy site"
rm -f "$LINK"
if ! nginx -t >>"$LOG" 2>&1; then ln -s "$SITE" "$LINK"; tail -5 "$LOG"; fail "nginx -t failed without the legacy site; link restored, nothing reloaded"; fi
systemctl reload nginx || fail "nginx reload"
sleep 2
mv "$SITE" /root/instruction-generator.site.retired-$TS
echo "sites-enabled order now: $(ls /etc/nginx/sites-enabled)"

echo "== 3 verify the new catch-all"
rc=0
want "$NEW" /api/health 200 || rc=1
want "$NEW" / 404 || rc=1
siblings_ok || rc=1
subj=$(echo | openssl s_client -noservername -connect 127.0.0.1:443 2>/dev/null | openssl x509 -noout -subject 2>/dev/null)
case "$subj" in *"$NEW"*) echo "ok    default certificate is now $NEW";; *) echo "FAIL  default certificate is [$subj]"; rc=1;; esac
code=$(curl -sk -o /dev/null -m 25 -w '%{http_code}' https://127.0.0.1/api/health 2>/dev/null); if [ "$code" = 200 ]; then echo "ok    unknown-hostname HTTPS still proxies to the app"; else echo "FAIL  catch-all HTTPS gave $code"; rc=1; fi
code=$(curl -s -o /dev/null -m 25 -w '%{http_code}' http://127.0.0.1/ 2>/dev/null); if [ "$code" = 404 ]; then echo "ok    unknown-hostname HTTP still answers 404"; else echo "FAIL  catch-all HTTP gave $code"; rc=1; fi
[ $rc = 0 ] || fail "verification failed after disabling the legacy site (rollback available)"

echo "== 4 delete the legacy certificate"
if certbot delete --cert-name "$OLD" --non-interactive >>"$LOG" 2>&1; then echo "ok    certificate $OLD deleted"; else tail -5 "$LOG"; fail "certbot delete failed"; fi
nginx -t >>"$LOG" 2>&1 || fail "nginx -t after certificate deletion"
systemctl reload nginx || fail "reload after certificate deletion"
sleep 2
certbot certificates 2>/dev/null | grep 'Certificate Name'
want "$NEW" /api/health 200 || fail "new hostname unhealthy at the end"
siblings_ok || fail "a sibling service is unhealthy at the end"
echo "PHASE 3 COMPLETE. Log: $LOG"
echo "Reminder: instructionscrafter.com DNS still points here, so browsers now get a certificate warning for it."
echo "Remove its A records when you drop the domain."
