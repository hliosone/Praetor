#!/bin/sh
# The simulator serves its Unix sockets from its working directory: a volume shared with the TEE services, which
# mount it where dstack lives in a CVM. umask 0 lets their non-root user connect.
set -eu
cd /var/run/dstack
rm -f ./*.sock ./*.sock.lock
cp /opt/sim/* .
umask 000
exec ./dstack-simulator
