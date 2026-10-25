#!/usr/bin/env bash
# =============================================================================
#  By Room — one-time Google Cloud setup. Run it ONCE in Google Cloud Shell
#  (the terminal button at the top of console.cloud.google.com — nothing to install).
#
#    bash setup.sh <PROJECT_ID>
#
#  It creates, in region me-west1 (Tel Aviv):
#    * two storage buckets: <project>-byroom-work (temporary work files) and <project>-byroom-archive (PDF sheets)
#    * an image registry for the processing job
#    * three service accounts, each with only what it needs:
#        byroom-worker  – the processing job itself (reads/writes the buckets, reads the database secret)
#        byroom-api     – the Supabase functions (upload sessions, signed links, starting the job)
#        byroom-deploy  – GitHub, to publish a new version of the job
#    * a secret holding the Supabase database connection string (you paste it when asked)
#  It prints two keys at the end: one goes to GitHub, one to Supabase. Neither is ever sent in chat.
#  Running it again is safe: what exists is left as it is.
# =============================================================================
set -euo pipefail
PROJECT="${1:?usage: bash setup.sh <PROJECT_ID>}"
REGION="me-west1"
# addresses allowed to upload from the browser (the site; add a custom domain here if the site moves)
ORIGINS="${ORIGINS:-https://marcellakravitz-bot.github.io}"
WORK="${PROJECT}-byroom-work"
ARCHIVE="${PROJECT}-byroom-archive"

gcloud config set project "$PROJECT"
echo "== APIs"
gcloud services enable run.googleapis.com storage.googleapis.com artifactregistry.googleapis.com \
  secretmanager.googleapis.com iam.googleapis.com iamcredentials.googleapis.com

echo "== buckets"
for B in "$WORK" "$ARCHIVE"; do
  gcloud storage buckets describe "gs://$B" >/dev/null 2>&1 || \
    gcloud storage buckets create "gs://$B" --location="$REGION" --uniform-bucket-level-access --public-access-prevention
done
# the browser uploads straight to the work bucket, so the site's address must be allowed there
cat > /tmp/cors.json <<EOF
[{"origin": [$(echo "$ORIGINS" | sed 's/[^ ][^ ]*/"&"/g; s/ /, /g')], "method": ["PUT", "POST", "GET", "OPTIONS"],
  "responseHeader": ["Content-Type", "Content-Range", "Range", "x-goog-resumable", "Location"], "maxAgeSeconds": 3600}]
EOF
gcloud storage buckets update "gs://$WORK" --cors-file=/tmp/cors.json
gcloud storage buckets update "gs://$ARCHIVE" --cors-file=/tmp/cors.json
# No automatic deletion rule: finished files are deleted only by the administrator, from the "work files" screen.
# (An upload abandoned half-way leaves no file; its session simply expires after a week.)

echo "== image registry"
gcloud artifacts repositories describe byroom --location="$REGION" >/dev/null 2>&1 || \
  gcloud artifacts repositories create byroom --repository-format=docker --location="$REGION"

echo "== service accounts"
for SA in byroom-worker byroom-api byroom-deploy; do
  gcloud iam service-accounts describe "$SA@$PROJECT.iam.gserviceaccount.com" >/dev/null 2>&1 || \
    gcloud iam service-accounts create "$SA" --display-name "By Room $SA"
done
W="byroom-worker@$PROJECT.iam.gserviceaccount.com"
A="byroom-api@$PROJECT.iam.gserviceaccount.com"
D="byroom-deploy@$PROJECT.iam.gserviceaccount.com"
for B in "$WORK" "$ARCHIVE"; do
  gcloud storage buckets add-iam-policy-binding "gs://$B" --member="serviceAccount:$W" --role=roles/storage.objectAdmin >/dev/null
  gcloud storage buckets add-iam-policy-binding "gs://$B" --member="serviceAccount:$A" --role=roles/storage.objectAdmin >/dev/null
done
gcloud projects add-iam-policy-binding "$PROJECT" --member="serviceAccount:$A" --role=roles/run.developer --condition=None >/dev/null
gcloud projects add-iam-policy-binding "$PROJECT" --member="serviceAccount:$D" --role=roles/run.admin --condition=None >/dev/null
gcloud projects add-iam-policy-binding "$PROJECT" --member="serviceAccount:$D" --role=roles/artifactregistry.writer --condition=None >/dev/null
gcloud iam service-accounts add-iam-policy-binding "$W" --member="serviceAccount:$D" --role=roles/iam.serviceAccountUser >/dev/null

echo "== database secret"
if ! gcloud secrets describe byroom-database-url >/dev/null 2>&1; then
  echo "Paste the Supabase connection string (Supabase > Project Settings > Database > Connection string > URI, session pooler)."
  echo "It is stored only in Google Secret Manager:"
  read -rs DBURL
  printf '%s' "$DBURL" | gcloud secrets create byroom-database-url --data-file=- --replication-policy=automatic
fi
gcloud secrets add-iam-policy-binding byroom-database-url --member="serviceAccount:$W" --role=roles/secretmanager.secretAccessor >/dev/null

echo "== keys"
gcloud iam service-accounts keys create /tmp/byroom-deploy-key.json --iam-account="$D"
gcloud iam service-accounts keys create /tmp/byroom-api-key.json --iam-account="$A"
cat <<EOF

Done. Two keys were created in Cloud Shell. Open each with:  cat /tmp/<name>  and copy its whole text.

1) GitHub  > the dashboard repository > Settings > Secrets and variables > Actions
     Secret   GCP_SA_KEY      = content of /tmp/byroom-deploy-key.json
     Variable GCP_PROJECT     = $PROJECT
     Variable GCP_REGION      = $REGION
     Variable WORK_BUCKET     = $WORK
     Variable ARCHIVE_BUCKET  = $ARCHIVE

2) Supabase > Edge Functions > Secrets
     GCP_SA_KEY      = content of /tmp/byroom-api-key.json
     GCP_PROJECT     = $PROJECT
     GCP_REGION      = $REGION
     GCP_JOB         = byroom-worker
     WORK_BUCKET     = $WORK
     ARCHIVE_BUCKET  = $ARCHIVE

Then delete the key files:  rm /tmp/byroom-*-key.json
EOF
