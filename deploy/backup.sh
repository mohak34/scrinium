#!/usr/bin/env bash
# Nightly backup of the vault + sqlite db. Run via cron, e.g.:
#   0 3 * * * /opt/scrinium/app/deploy/backup.sh
set -euo pipefail

SRC_VAULT="/opt/scrinium/vault"
SRC_DB="/opt/scrinium/data/scrinium.db"
DEST="/opt/scrinium/backups"
STAMP=$(date +%Y-%m-%d)

mkdir -p "$DEST"
tar -czf "$DEST/scrinium-$STAMP.tar.gz" -C /opt/scrinium vault data

# keep last 14 days locally
find "$DEST" -name 'scrinium-*.tar.gz' -mtime +14 -delete

# Optional: rsync the fresh archive off-box too, e.g.:
# rsync "$DEST/scrinium-$STAMP.tar.gz" user@backup-host:/backups/scrinium/
