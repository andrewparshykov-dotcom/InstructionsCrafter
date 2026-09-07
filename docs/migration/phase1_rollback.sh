#!/bin/bash
# PHASE 1 ROLLBACK: disables the instrcrafter.safeshieldins.com site again. Every other site is untouched.
# Usage: bash phase1_rollback.sh                    keeps the new certificate (harmless, renews on its own)
#        DELETE_CERT=yes bash phase1_rollback.sh    also deletes the new certificate
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
TS=$(date +%Y%m%d-%H%M%S)
[ "$(id -u)" = 0 ] || { echo "must run as root"; exit 1; }
rm -f /etc/nginx/sites-enabled/$NAME
if [ -e /etc/nginx/sites-available/$NAME ]; then mv /etc/nginx/sites-available/$NAME /root/$NAME.removed-$TS; echo "site file moved to /root/$NAME.removed-$TS"; fi
if ! nginx -t; then
  B=$(ls -t /root/nginx-before-phase1-*.tgz 2>/dev/null | head -1)
  echo "nginx -t failed; restoring /etc/nginx from $B"
  [ -n "$B" ] && tar xzf "$B" -C / && rm -f /etc/nginx/sites-enabled/$NAME
  nginx -t || { echo "STILL FAILING: nginx was NOT reloaded, the running config is unchanged; investigate before reloading"; exit 1; }
fi
systemctl reload nginx && echo "nginx reloaded"
if [ "${DELETE_CERT:-no}" = yes ]; then certbot delete --cert-name "$NEW" --non-interactive && echo "certificate $NEW deleted"; fi
want instructionscrafter.com /api/health 200
want instructionscrafter.com / 404
siblings_ok
echo "sites-enabled order: $(ls /etc/nginx/sites-enabled)"
echo "ROLLBACK DONE"
