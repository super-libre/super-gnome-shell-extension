#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-only
#
# A GNOME Shell in a window, with the extension enabled, against the running
# Super Voice daemon.
#
#     tools/nested-shell.sh <extension zip> <uuid>
#
# The nested shell's extensions, settings and cache are its own, in a
# directory removed when it exits. Its state directory is yours, so the
# session token it stores outlives the run: Super Voice asks you to allow
# the extension once, not every time. Set SUPER_VOICE_HTTP_SOCKET to point it
# at another daemon, such as tools/fake-daemon.ts.
set -euo pipefail

zip=$(realpath "$1")
uuid=$2

root=$(mktemp -d -p "${XDG_RUNTIME_DIR:-/tmp}" svx-nested.XXXX)
trap 'rm -rf "$root"' EXIT
export XDG_DATA_HOME=$root/data XDG_CONFIG_HOME=$root/config XDG_CACHE_HOME=$root/cache
export GSETTINGS_BACKEND=keyfile
mkdir -p "$XDG_CONFIG_HOME/glib-2.0/settings"

gnome-extensions install --force "$zip"
cat > "$XDG_CONFIG_HOME/glib-2.0/settings/keyfile" <<EOF
[org/gnome/shell]
enabled-extensions=['$uuid']
disable-user-extensions=false
welcome-dialog-last-shown-version='999'
EOF

echo "Starting a nested GNOME Shell. Close its window to stop."
echo "The extension logs to this terminal, prefixed [Super Voice]."
dbus-run-session -- gnome-shell --devkit --wayland 2>&1 |
    grep --line-buffered -E '\[Super Voice\]|super-voice@|JS ERROR|JS WARNING'
