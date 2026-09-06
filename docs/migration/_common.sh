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
