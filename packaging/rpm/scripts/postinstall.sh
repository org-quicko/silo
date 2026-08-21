#!/bin/sh
# rpm passes 1 on a fresh install and 2 on an upgrade.
set -e

systemctl daemon-reload >/dev/null 2>&1 || :

if [ "$1" = "1" ]; then
  # `preset` rather than `enable`: it applies the machine's own policy, which
  # on RHEL-family distributions leaves a third-party unit disabled. A package
  # manager should not open a port on a host nobody has configured yet.
  systemctl preset silo.service >/dev/null 2>&1 || :

  cat >&2 <<'EOF'

silo is installed but not running. Start it with:

    sudo systemctl enable --now silo

On first start silo prints a root API key to the journal, once and never
again. Read it with:

    sudo journalctl -u silo | grep -A2 'root API key'

EOF
else
  systemctl try-restart silo.service >/dev/null 2>&1 || :
fi
