#!/bin/sh
# 0 means the package is going away; anything else is an upgrade, which must
# not stop the service.
set -e

if [ "$1" = "0" ]; then
  systemctl --no-reload disable --now silo.service >/dev/null 2>&1 || :
fi
