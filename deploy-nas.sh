#!/bin/bash
set -e

NAS_USER=Filippo
NAS_HOST=192.168.1.93
LOCAL_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "▶ Build frontend..."
cd "$LOCAL_DIR"
npm run build

echo "▶ Trasferimento sul NAS..."
tar czf - \
  --exclude='AnalisiGara/node_modules' \
  --exclude='AnalisiGara/.git' \
  --exclude='AnalisiGara/storage' \
  --exclude='AnalisiGara/.env' \
  -C "$(dirname "$LOCAL_DIR")" "$(basename "$LOCAL_DIR")" \
  | ssh "$NAS_USER@$NAS_HOST" "cd ~ && tar xzf -"

echo "▶ Riavvio server..."
ssh "$NAS_USER@$NAS_HOST" "sudo systemctl restart analisi-gara"

echo ""
echo "✓ Deploy completato."
echo "  Locale:   http://$NAS_HOST:3000"
echo "  Internet: https://encircle-outsmart-exploring.ngrok-free.dev"
