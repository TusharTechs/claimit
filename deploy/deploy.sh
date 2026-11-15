#!/usr/bin/env bash
# Build locally, ship to the VM, install production deps, restart.
#   GCP_PROJECT=... GCP_ZONE=us-central1-a VM=claimit HOST=1-2-3-4.sslip.io ./deploy/deploy.sh [--bootstrap]
# Secrets come from your local .env (NEXCONN_*) and are written to /etc/claimit.env (root-only) on the VM.
set -euo pipefail
cd "$(dirname "$0")/.."

: "${GCP_PROJECT:?set GCP_PROJECT}"
: "${HOST:?set HOST, e.g. 35-224-27-222.sslip.io}"
GCP_ZONE="${GCP_ZONE:-us-central1-a}"
VM="${VM:-claimit}"
SSH=(gcloud compute ssh "$VM" --project="$GCP_PROJECT" --zone="$GCP_ZONE" --quiet --command)
SCP=(gcloud compute scp --project="$GCP_PROJECT" --zone="$GCP_ZONE" --quiet)

if [ "${1:-}" = "--bootstrap" ]; then
  "${SCP[@]}" deploy/bootstrap.sh "$VM":/tmp/bootstrap.sh
  "${SSH[@]}" "sudo bash /tmp/bootstrap.sh $HOST"
fi

echo "› building web app"
npm run build >/dev/null

echo "› packaging"
TMP="$(mktemp -d)"
COPYFILE_DISABLE=1 tar --no-xattrs -czf "$TMP/claimit.tgz" package.json package-lock.json server shared dist deploy/claimit.service

# Runtime env file (secrets stay out of the tarball and the repo)
grep -E '^NEXCONN_(APP_KEY|APP_SECRET|AREA)=' .env > "$TMP/claimit.env"
{ echo "PORT=8787"; echo "DATA_DIR=/var/lib/claimit"; echo "PUBLIC_URL=https://$HOST"; } >> "$TMP/claimit.env"
grep -E '^(HOLD_SECONDS|MAX_WAITLIST|ADMIN_KEY)=' .env >> "$TMP/claimit.env" || true

echo "› uploading"
"${SCP[@]}" "$TMP/claimit.tgz" "$TMP/claimit.env" "$VM":/tmp/
rm -rf "$TMP"

echo "› installing on VM"
"${SSH[@]}" "set -e
  sudo install -m 600 -o root -g root /tmp/claimit.env /etc/claimit.env && rm /tmp/claimit.env
  sudo rm -rf /opt/claimit/server /opt/claimit/shared /opt/claimit/dist
  sudo tar -xzf /tmp/claimit.tgz -C /opt/claimit && rm /tmp/claimit.tgz
  sudo chown -R claimit:claimit /opt/claimit
  cd /opt/claimit && sudo -u claimit npm ci --omit=dev --no-audit --no-fund --loglevel=error
  sudo cp /opt/claimit/deploy/claimit.service /etc/systemd/system/claimit.service
  sudo systemctl daemon-reload && sudo systemctl enable claimit >/dev/null 2>&1 && sudo systemctl restart claimit
  sleep 3 && systemctl is-active claimit && curl -s localhost:8787/api/config | sed -E 's/\"appKey\":\"[^\"]+\"/\"appKey\":\"<set>\"/'"

echo "› live at https://$HOST"
