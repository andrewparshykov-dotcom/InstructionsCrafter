#!/bin/bash
# PHASE 3 GATE CHECK (read-only): is anything still calling instructionscrafter.com?
# Reads the legacy access log written since Phase 2. Extension traffic = lines whose hostname is
# instructionscrafter.com or www.instructionscrafter.com AND whose path starts with /api/.
# Everything else in that log is internet background noise hitting the catch-all, which never reaches zero.
# Lines from curl are our own verification probes and are not counted.
# Run as root (log files are readable by root only).
set -u
L=/var/log/nginx/instructionscrafter-legacy.access.log
[ -f "$L" ] || { echo "no legacy log yet ($L): Phase 2 has not run, or nothing has been logged"; exit 0; }
pat='instructionscrafter.com" "(GET|POST|OPTIONS) /api/'
echo "file | extension-calls | all-legacy-hostname-lines | first line date"
for f in $L $L.1; do
  [ -f "$f" ] && echo "$(basename $f) | $(grep -E "$pat" $f | grep -vc "curl/") | $(grep -c 'instructionscrafter.com"' $f) | $(head -1 $f | cut -d'[' -f2 | cut -d']' -f1)"
done
for f in $L.*.gz; do
  [ -f "$f" ] && echo "$(basename $f) | $(zgrep -E "$pat" $f | grep -vc "curl/") | $(zgrep -c 'instructionscrafter.com"' $f) | $(zcat $f | head -1 | cut -d'[' -f2 | cut -d']' -f1)"
done
echo
echo "most recent extension call to the legacy hostname (IP masked), if any:"
{ for f in $L.*.gz; do [ -f "$f" ] && zgrep -hE "$pat" "$f"; done; grep -hE "$pat" $L.1 $L 2>/dev/null; } | grep -v "curl/" | tail -1 | sed -E 's/^[0-9a-f.:]+/x.x.x.x/'
echo
echo "Safe to retire when: extension-calls is 0 in EVERY row, the oldest row is at least 14 days old,"
echo "and every team member's chrome://extensions page shows the new version (1.3.0 or later)."
