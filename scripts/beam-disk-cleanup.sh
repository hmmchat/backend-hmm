#!/usr/bin/env bash
#
# Weekly disk guardrail for a single-node Docker host (Compose / small VPS).
#
# Previous versions broke production by:
#   - docker image prune -a  → removes layers; can desync vs container metadata
#   - rm -rf /var/lib/containerd/* → Docker CE uses containerd; this caused
#     "RW layer not found" / "RWLayer unexpectedly nil" after the next restart
#
# This script NEVER: prunes with -a, touches /var/lib/containerd, stops Docker,
# or deletes anything under /var/lib/docker by hand.
#
# Deploy: sudo install -m 0755 scripts/beam-disk-cleanup.sh /usr/local/sbin/beam-disk-cleanup.sh
#
set -euo pipefail

LOG_TAG="beam-disk-cleanup"

log() {
  logger -t "$LOG_TAG" -- "$*" 2>/dev/null || true
  printf '%s %s\n' "$(date -Is)" "$*"
}

dir_gib() {
  local path="$1"
  local kib
  kib=$(du -sk "$path" 2>/dev/null | awk '{print $1}' || echo 0)
  echo $(( kib / 1024 / 1024 ))
}

log "Starting disk cleanup (safe mode)"
df -h / || true

if command -v journalctl >/dev/null 2>&1; then
  log "Vacuum journald (keep 7 days)"
  journalctl --vacuum-time=7d >/dev/null 2>&1 || true
fi

if command -v apt-get >/dev/null 2>&1; then
  log "apt-get clean"
  apt-get clean >/dev/null 2>&1 || true
fi

if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  log "Docker: df + safe prune (no image prune -a)"
  docker system df 2>/dev/null || true
  # Stopped containers, unused networks, dangling images only, build cache — NOT -a
  docker system prune -f
  docker builder prune -f >/dev/null 2>&1 || true
else
  log "Docker not running or not available; skipping docker prune"
fi

# --- containerd: report only ---
# Docker CE uses containerd for images/snapshots. NEVER rm -rf /var/lib/containerd here.
if [[ -d /var/lib/containerd ]]; then
  c_gib="$(dir_gib /var/lib/containerd)"
  log "/var/lib/containerd is ~${c_gib}GiB (informational only; not wiped by this script)"
  if [[ "${c_gib}" -ge 10 ]]; then
    log "WARN: containerd data is large. Fix by removing unused images with safe prunes,"
    log "      moving workloads, or resizing disk — do not delete /var/lib/containerd on a Docker host."
  fi
fi

log "Done"
df -h / || true

exit 0
