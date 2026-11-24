#!/usr/bin/env bash
#
# Creates the Google side of calendar sync, once: a Cloud project with the
# Calendar API, a service account with no IAM roles, and a key that goes
# straight from gcloud into the KidsDash-Data secret over a pipe, so it never
# touches disk. Safe to rerun: existing project/account are reused, but each run
# mints a new key (old ones can be deleted in the console).
#
#   gcloud auth login                       # once, interactively
#   AWS_PROFILE="<your-profile>" scripts/google/create-service-account.sh <project-id>
set -euo pipefail

project="${1:?usage: create-service-account.sh <new-or-existing-project-id>}"
account="kids-dash-sync"
email="${account}@${project}.iam.gserviceaccount.com"

secret_arn=$(aws cloudformation describe-stacks --stack-name KidsDash-Data \
  --query "Stacks[0].Outputs[?contains(OutputKey,'GoogleServiceAccount')].OutputValue" --output text)
[ -n "$secret_arn" ] || { echo "KidsDash-Data secret not found" >&2; exit 1; }

gcloud projects describe "$project" >/dev/null 2>&1 || gcloud projects create "$project" --name="kids-dash"
gcloud services enable calendar-json.googleapis.com --project "$project"
gcloud iam service-accounts describe "$email" --project "$project" >/dev/null 2>&1 ||
  gcloud iam service-accounts create "$account" --project "$project" \
    --display-name "kids-dash calendar sync"

gcloud iam service-accounts keys create /dev/stdout --iam-account "$email" --project "$project" 2>/dev/null |
  aws secretsmanager put-secret-value --secret-id "$secret_arn" --secret-string file:///dev/stdin >/dev/null

echo "Service account $email; key stored in $secret_arn"
