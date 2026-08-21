#!/bin/sh
set -e

systemctl daemon-reload >/dev/null 2>&1 || :

# The silo user and /var/lib/silo are left behind on purpose. The data
# directory is the user's content, and removing the account that owns it would
# orphan the files to a bare uid — `dnf remove` is not `rm -rf my database`.
