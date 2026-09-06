#!/bin/bash
# InstructionsCrafter domain migration, PHASE 0 (read-only). Confirms the VM facts in the preflight report.
# Changes nothing. Run as root (Azure Run command is root; over SSH: sudo bash -s < phase0_vm_readonly.sh).
set -u
echo "== sites-enabled (alphabetical load order; the FIRST block is the catch-all for unknown hostnames)"
ls /etc/nginx/sites-enabled
echo "== nginx -t"; nginx -t 2>&1 | tail -1
echo "== certificates"; certbot certificates 2>/dev/null | grep -E 'Certificate Name|Expiry'
echo "== certificate served when no hostname is sent (proves which block is the catch-all)"
echo | openssl s_client -noservername -connect 127.0.0.1:443 2>/dev/null | openssl x509 -noout -subject
echo "== custom log_format lines in nginx.conf (0 = default format, requested hostname is NOT logged)"
grep -cE '^[[:space:]]*log_format' /etc/nginx/nginx.conf
echo "== services"; for s in nginx instruction-generator; do echo "$s: $(systemctl is-active $s)"; done
echo "== the app already answers on the new hostname through the catch-all (certificate check skipped)"
curl -sk -m 15 --resolve instrcrafter.safeshieldins.com:443:127.0.0.1 https://instrcrafter.safeshieldins.com/api/health; echo
echo "== extension API calls in the shared access log, per file (all hostnames mixed together)"
for f in /var/log/nginx/access.log /var/log/nginx/access.log.1; do [ -f "$f" ] && echo "$(basename $f) $(grep -cE '(GET|POST) /api/(jobs|generate)' $f)"; done
for f in /var/log/nginx/access.log.*.gz; do [ -f "$f" ] && echo "$(basename $f) $(zgrep -cE '(GET|POST) /api/(jobs|generate)' $f)"; done
