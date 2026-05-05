#!/bin/bash
set -euo pipefail

NAS_USER=Filippo
NAS_HOST=192.168.1.93
LOCAL_DIR="$(cd "$(dirname "$0")" && pwd)"
REMOTE_STAGE=/tmp/analisi-gara-deploy
RUN_SEED=0
SSH_OPTS=(
  -o ControlMaster=auto
  -o ControlPersist=10m
  -o ControlPath=/tmp/analisi-gara-deploy-%C
)

cleanup_ssh() {
  ssh "${SSH_OPTS[@]}" -O exit "$NAS_USER@$NAS_HOST" >/dev/null 2>&1 || true
}

trap cleanup_ssh EXIT

remote_ssh() {
  ssh "${SSH_OPTS[@]}" "$NAS_USER@$NAS_HOST" "$@"
}

read -r -p "Vuoi eseguire anche il seed arbitri DR1 2025/2026? [s/N] " SEED_REFEREES
case "$SEED_REFEREES" in
  s|S|y|Y) RUN_SEED=1 ;;
esac

echo "▶ Build frontend..."
cd "$LOCAL_DIR"
npm run build

echo "▶ Apro connessione SSH riutilizzabile..."
remote_ssh "true"

echo "▶ Preparo cartella temporanea sul NAS..."
remote_ssh "rm -rf '$REMOTE_STAGE' && mkdir -p '$REMOTE_STAGE'"

echo "▶ Trasferimento codice sul NAS..."
tar czf - \
  --exclude='AnalisiGara/node_modules' \
  --exclude='AnalisiGara/.git' \
  --exclude='AnalisiGara/storage' \
  --exclude='AnalisiGara/.env' \
  -C "$(dirname "$LOCAL_DIR")" "$(basename "$LOCAL_DIR")" \
  | remote_ssh "cd '$REMOTE_STAGE' && tar xzf - --strip-components=1"

echo "▶ Backup DB, installazione e migrazioni..."
ssh "${SSH_OPTS[@]}" -tt "$NAS_USER@$NAS_HOST" "
set -e
sudo -v

REMOTE_DIR=\$(systemctl show -p WorkingDirectory --value analisi-gara)
if [ -z \"\$REMOTE_DIR\" ] || [ \"\$REMOTE_DIR\" = '/' ]; then
  REMOTE_DIR='/home/Filippo/AnalisiGara'
fi

SERVICE_ENV=\$(systemctl show -p Environment --value analisi-gara)
REMOTE_STORAGE=\$(printf '%s\n' \"\$SERVICE_ENV\" | tr ' ' '\n' | sed -n 's/^STORAGE_DIR=//p' | tail -1)
if [ -z \"\$REMOTE_STORAGE\" ]; then
  REMOTE_STORAGE=\"\$REMOTE_DIR/storage\"
fi

BACKUP_DIR=\"\$REMOTE_STORAGE/backups/deploy-\"\$(date +%Y%m%d-%H%M%S)

echo '  • Directory servizio:' \"\$REMOTE_DIR\"
echo '  • Storage servizio:' \"\$REMOTE_STORAGE\"

echo '  • Dipendenze production in staging'
cd '$REMOTE_STAGE'
npm install --omit=dev

echo '  • Stop servizio'
sudo systemctl stop analisi-gara || true

echo '  • Backup database in' \"\$BACKUP_DIR\"
sudo mkdir -p \"\$REMOTE_DIR\" \"\$REMOTE_STORAGE/data\" \"\$REMOTE_STORAGE/backups\" \"\$REMOTE_STORAGE/uploads/profiles\" \"\$REMOTE_STORAGE/output\" \"\$BACKUP_DIR\"
if sudo test -f \"\$REMOTE_STORAGE/data/rapporti.sqlite\"; then
  sudo cp -p \"\$REMOTE_STORAGE/data/rapporti.sqlite\"* \"\$BACKUP_DIR\"/ 2>/dev/null || true
else
  echo '    Nessun DB esistente trovato: verrà creato al primo avvio.'
fi

echo '  • Migrazioni DB'
cd '$REMOTE_STAGE'
sudo env STORAGE_DIR=\"\$REMOTE_STORAGE\" NODE_ENV=production node --input-type=module -e \"import { initializeDatabase, closeDatabase } from './src/database/connection.js'; initializeDatabase(); closeDatabase();\"

echo '  • Cleanup PDF legacy storage/output/report-*'
sudo find \"\$REMOTE_STORAGE/output\" -maxdepth 1 -type d -name 'report-*' -exec rm -rf {} +

if [ '$RUN_SEED' = '1' ]; then
  echo '  • Seed arbitri DR1 2025/2026'
  sudo env STORAGE_DIR=\"\$REMOTE_STORAGE\" NODE_ENV=production node scripts/seed-referees.js
else
  echo '  • Seed arbitri saltato'
fi

echo '  • Copia nuova webapp'
sudo cp -a '$REMOTE_STAGE'/. \"\$REMOTE_DIR\"/

echo '  • Riavvio servizio'
sudo systemctl start analisi-gara
sudo systemctl status analisi-gara --no-pager -l | sed -n '1,18p'

echo '  • Smoke test locale NAS'
for i in 1 2 3 4 5; do
  if curl -fsS http://127.0.0.1:3000/api/health; then
    break
  fi
  if [ \"\$i\" = '5' ]; then
    echo 'Smoke test fallito dopo 5 tentativi.'
    exit 1
  fi
  sleep 1
done
echo
echo '  • Backup DB:' \"\$BACKUP_DIR\"
"

echo ""
echo "✓ Deploy completato."
echo "  Locale:   http://$NAS_HOST:3000"
echo "  Internet: https://encircle-outsmart-exploring.ngrok-free.dev"
