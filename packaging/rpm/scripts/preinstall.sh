#!/bin/sh
# Runs before the files land, because they are owned by a user that has to
# exist first. Idempotent: an upgrade runs this again over an account that is
# already there, and reinstalling must not disturb the uid owning /var/lib/silo.
set -e

getent group silo >/dev/null 2>&1 || groupadd --system silo
getent passwd silo >/dev/null 2>&1 || useradd \
  --system \
  --gid silo \
  --home-dir /var/lib/silo \
  --no-create-home \
  --shell /sbin/nologin \
  --comment "silo headless CMS" \
  silo
