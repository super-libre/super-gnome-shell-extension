#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-only
#
# A GNOME Shell in a window, with the extension enabled, against the running
# Super Voice daemon.
#
#     tools/nested-shell.sh <extension zip> <uuid>
#
# The nested shell's extensions, settings, cache and runtime directory are its
# own, in a directory removed when it exits. Its state directory is yours, so the
# session token it stores outlives the run: Super Voice asks you to allow
# the extension once, not every time. Set SUPER_VOICE_HTTP_SOCKET to point it
# at another daemon, such as tools/fake-daemon.ts.
set -euo pipefail

zip=$(realpath "$1")
uuid=$2

runtime=${XDG_RUNTIME_DIR:-/run/user/$(id -u)}
root=$(mktemp -d -p "$runtime" svx-nested.XXXX)
trap 'rm -rf "$root"' EXIT
# The nested shell gets a runtime directory of its own, before the private
# bus starts: the bus hands it to every service it activates, and on the real
# one the document portal the shell's portal activates unmounts the session's
# own $XDG_RUNTIME_DIR/doc as it exits, breaking the Flatpak apps and panel
# applets running there. What it still needs from the real one is named by
# path: the desktop's Wayland socket, to open its window on, and the daemon's.
case ${WAYLAND_DISPLAY:-wayland-0} in
    /*) ;;
    *) export WAYLAND_DISPLAY="$runtime/${WAYLAND_DISPLAY:-wayland-0}" ;;
esac
export SUPER_VOICE_HTTP_SOCKET=${SUPER_VOICE_HTTP_SOCKET:-$runtime/voice/super-voice-http.sock}
export XDG_RUNTIME_DIR=$root
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
