#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-only
#
# Drives the extension in a headless GNOME Shell against tools/fake-daemon.ts
# and screenshots the top bar in each state, into screenshots/.
#
#     tools/smoke.sh <extension zip> <uuid> <settings schema>
#
# Everything the shell reads or writes is kept in a directory of its own:
# its settings, extensions, cache, runtime directory and the token the
# extension stores. The real session and the real daemon are never touched.
set -euo pipefail

zip=$(realpath "$1")
uuid=$2
schema=$3
repo=$(cd "$(dirname "$0")/.." && pwd)
out="$repo/screenshots"

if [[ "${SMOKE_INSIDE:-}" != 1 ]]; then
    # Unix socket paths are capped at 108 bytes, so the sockets live in a
    # short directory under the runtime dir.
    root=$(mktemp -d -p "${XDG_RUNTIME_DIR:-/tmp}" svx-smoke.XXXX)
    trap 'pkill -f "fake-daemon.ts $root/" 2>/dev/null || true; rm -rf "$root"' EXIT
    export SMOKE_ROOT=$root
    # The runtime directory too, before the private bus starts: the bus hands
    # it to every service it activates. On the real one, the document portal
    # the shell's portal activates unmounts the session's own
    # $XDG_RUNTIME_DIR/doc as it exits, which breaks the Flatpak apps and
    # panel applets running there. mktemp made it 0700, as the spec asks.
    export XDG_RUNTIME_DIR=$root
    export XDG_DATA_HOME=$root/data XDG_CONFIG_HOME=$root/config
    export XDG_CACHE_HOME=$root/cache XDG_STATE_HOME=$root/state
    export GSETTINGS_BACKEND=keyfile
    export SUPER_VOICE_HTTP_SOCKET=$root/daemon.sock
    mkdir -p "$XDG_CONFIG_HOME/glib-2.0/settings" "$out"
    rm -f "$out"/*.png

    gnome-extensions install --force "$zip"
    cat > "$XDG_CONFIG_HOME/glib-2.0/settings/keyfile" <<EOF
[org/gnome/shell]
enabled-extensions=['$uuid']
disable-user-extensions=false
welcome-dialog-last-shown-version='999'
EOF

    node "$repo/tools/fake-daemon.ts" "$root/daemon.sock" "$root/control.sock" \
        > "$root/fake-daemon.log" 2>&1 &

    SMOKE_INSIDE=1 dbus-run-session -- "$0" "$@" && status=0 || status=$?
    cp "$root/shell.log" "$out/shell.log" 2>/dev/null || true
    cp "$root/session.log" "$out/session.log" 2>/dev/null || true
    if [[ $status -ne 0 ]]; then
        tail -20 "$root/session.log" >&2 || true
    fi
    exit $status
fi

# Inside the private D-Bus session. The session bus and the services it
# starts are chatty; their output goes to a log beside the shell's.
root=$SMOKE_ROOT
exec 2>> "$root/session.log"
ext_schemas="$XDG_DATA_HOME/gnome-shell/extensions/$uuid/schemas"

control() { curl -sf --unix-socket "$root/control.sock" -X POST "http://x/$1" > /dev/null; }
status() { curl -sf --unix-socket "$root/control.sock" "http://x/status"; }
setting() { GSETTINGS_SCHEMA_DIR=$ext_schemas gsettings set "$schema" "$1" "$2"; }
shell_eval() {
    gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell \
        --method org.gnome.Shell.Eval "$1"
}

# The extension's buttons in the top bar: one in the status area, or the two
# halves around the clock, left first.
HALVES="Object.entries(Main.panel.statusArea).filter(([k]) => k.startsWith('$uuid')) \
    .map(([, v]) => v).sort((a, b) => a.get_transformed_position()[0] - b.get_transformed_position()[0])"

# Where the buttons are on screen, with whatever lies between them (the
# clock), padded, as "x y w h".
area() {
    shell_eval "const hs = $HALVES; let x1 = Infinity, x2 = -Infinity, h = 0; \
        for (const a of hs) { const [x] = a.get_transformed_position(); \
            const [w, ah] = a.get_transformed_size(); \
            x1 = Math.min(x1, x); x2 = Math.max(x2, x + w); h = Math.max(h, ah); } \
        const [sw, sh] = global.display.get_size(); \
        const left = Math.max(Math.round(x1) - ${1:-8}, 0); \
        const right = Math.min(Math.round(x2) + ${1:-8}, sw); \
        [left, 0, right - left, Math.min(Math.round(h) + ${2:-0}, sh)].join(' ')" \
        | sed -E "s/^\(true, '(.*)'\)$/\1/" | tr -d '"'
}

shot() {
    local name=$1 pad=${2:-8} below=${3:-0}
    read -r x y w h <<< "$(area "$pad" "$below")"
    gdbus call --session --dest org.gnome.Shell.Screenshot \
        --object-path /org/gnome/Shell/Screenshot \
        --method org.gnome.Shell.Screenshot.ScreenshotArea \
        "$x" "$y" "$w" "$h" false "$out/$name.png" > /dev/null
    echo "  $name.png"
}

wait_for() {
    local what=$1 test=$2
    for _ in $(seq 1 100); do
        if eval "$test"; then return 0; fi
        sleep 0.2
    done
    echo "Timed out waiting for $what" >&2
    return 1
}

SHELL_DEBUG=backtrace-warnings gnome-shell --headless --unsafe-mode \
    --virtual-monitor 1280x720 --wayland-display svx-smoke > "$root/shell.log" 2>&1 &
shell_pid=$!
trap 'kill $shell_pid 2>/dev/null || true' EXIT

gdbus wait --session --timeout 60 org.gnome.Shell
wait_for "the extension" "gnome-extensions info '$uuid' 2>/dev/null | grep -q 'State: ACTIVE'"
echo "Extension is ACTIVE"
wait_for "the event stream" "status | grep -q '\"streams\":1'"
echo "Connected to the fake daemon"
# The shell starts in the overview, where the top bar is transparent. Leave
# it, for the top bar as people see it all day.
shell_eval "Main.overview.hide(); 'ok'" > /dev/null
sleep 1.5

# Around the clock: the left half right before the clock, the right half
# right after, as wide as each other, and the clock in the middle of the
# screen while it's in the middle of the top bar. Prints "ok:<box>" or what's
# wrong.
CLOCK_CHECK="const clock = Main.panel.statusArea.dateMenu.container; \
    const box = clock.get_parent(); const hs = $HALVES; \
    const boxes = {center: Main.panel._centerBox, left: Main.panel._leftBox, right: Main.panel._rightBox}; \
    const where = Object.keys(boxes).find(k => boxes[k] === box) ?? 'elsewhere'; \
    const ext = a => { const [x] = a.get_transformed_position(); const [w] = a.get_transformed_size(); return [x, x + w]; }; \
    let verdict; \
    if (hs.length !== 2) { verdict = 'bad:' + hs.length + ' buttons'; } else { \
        const [l, r] = hs.map(h => h.container); const kids = box.get_children(); const at = kids.indexOf(clock); \
        const [lx1, lx2] = ext(l), [cx1, cx2] = ext(clock), [rx1, rx2] = ext(r); \
        const gaps = [cx1 - lx2, rx1 - cx2]; \
        if (kids[at - 1] !== l || kids[at + 1] !== r) verdict = 'bad:not beside the clock in the ' + where; \
        else if (gaps.some(g => g < -1 || g > 8)) verdict = 'bad:gaps of ' + gaps.join(' and '); \
        else if (Math.abs((lx2 - lx1) - (rx2 - rx1)) > 1) verdict = 'bad:halves of ' + (lx2 - lx1) + ' and ' + (rx2 - rx1); \
        else if (where === 'center' && Math.abs((cx1 + cx2) / 2 - global.stage.width / 2) > 2) verdict = 'bad:clock off center, at ' + (cx1 + cx2) / 2; \
        else verdict = 'ok:' + where; } \
    verdict"
around_clock() {
    local verdict
    verdict=$(shell_eval "$CLOCK_CHECK" | sed -E "s/^\(true, '(.*)'\)$/\1/" | tr -d '"')
    if [[ $verdict != "ok:$1" ]]; then
        echo "Not around the clock in the $1 of the top bar: ${verdict#bad:}"
        exit 1
    fi
    echo "  (around the clock, in the $1 of the top bar)"
}
CLOCK="Main.panel.statusArea.dateMenu.container"
echo "Around the clock:"
around_clock center
# Another extension moves the clock beside the system menu: the halves follow.
shell_eval "const c = $CLOCK; c.get_parent().remove_child(c); \
    Main.panel._rightBox.insert_child_at_index(c, 0); 'ok'" > /dev/null
sleep 1; around_clock right
control scenario/recording; sleep 0.8; shot clock-moved-right; control scenario/idle
# It puts something of its own right beside the clock: the halves stay beside
# the clock, and it goes beyond them.
shell_eval "const c = $CLOCK; c.get_parent().insert_child_above( \
    new imports.gi.St.Label({text: 'Other', name: 'svx-other', \
        y_align: imports.gi.Clutter.ActorAlign.CENTER}), c); 'ok'" > /dev/null
sleep 1; around_clock right
# It takes both back, and the clock goes home: the halves come back with it.
shell_eval "const c = $CLOCK; c.get_parent().get_children().find(a => a.name === 'svx-other')?.destroy(); \
    c.get_parent().remove_child(c); Main.panel._centerBox.insert_child_at_index(c, 0); 'ok'" > /dev/null
sleep 1; around_clock center

echo "Screenshots:"
# Around the clock, with no icon: nothing shows until Super Voice does
# something.
shot idle
setting show-icon true; sleep 0.5; shot idle-icon
setting show-icon false
control scenario/recording; sleep 0.8; shot recording-centered-bars

# Which half draws which bands: the left half the low ones (0 to 15, up to
# about 650 Hz, where a voice is loudest), the right half the next ones (16
# to 31). A sound loud only in one set lights only that half.
shot_half() {
    local name=$1 index=$2 x y w h
    read -r x y w h <<< "$(shell_eval "const a = ($HALVES)[$index]; \
        const [x] = a.get_transformed_position(); const [w, h] = a.get_transformed_size(); \
        [Math.round(x), 0, Math.round(w), Math.round(h)].join(' ')" |
        sed -E "s/^\(true, '(.*)'\)$/\1/" | tr -d '"')"
    gdbus call --session --dest org.gnome.Shell.Screenshot \
        --object-path /org/gnome/Shell/Screenshot \
        --method org.gnome.Shell.Screenshot.ScreenshotArea \
        "$x" "$y" "$w" "$h" false "$out/$name.png" > /dev/null
}
# How bright a screenshot is, 0 to 1. Its alpha is dropped first: otherwise
# the opaque alpha channel counts in the mean as if it were light.
brightness() {
    magick "$out/$1.png" -background black -alpha remove -colorspace Gray -format "%[fx:mean]" info:
}
for tone in low high; do
    control "scenario/$tone"; sleep 0.8
    shot "$tone-bands"; shot_half "$tone-left" 0; shot_half "$tone-right" 1
done
# Back to real speech, for the styles that follow.
control scenario/recording; sleep 0.8
if command -v magick > /dev/null; then
    read -r low_l low_r high_l high_r <<< "$(brightness low-left) $(brightness low-right) \
        $(brightness high-left) $(brightness high-right)"
    if ! awk -v a="$low_l" -v b="$low_r" -v c="$high_r" -v d="$high_l" \
        'BEGIN { exit !(a > 2 * b && c > 2 * d) }'; then
        echo "The halves draw the wrong bands: low sound lit $low_l left, $low_r right;" \
            "high sound $high_l left, $high_r right."
        exit 1
    fi
    echo "  (low bands on the left half, high bands on the right: $low_l against $low_r," \
        "then $high_r against $high_l)"
else
    echo "  (no ImageMagick to check which half lit up: look at low-bands.png and high-bands.png)"
fi
for style in bottom-equalizer pulse waveform; do
    setting visualization-style "'$style'"; sleep 0.6; shot "recording-$style"
done
setting visualization-style "'centered-equalizer'"

control scenario/speaking; sleep 0.8; shot speaking
control scenario/transcribing; sleep 0.5; shot transcribing-droplet
for animation in comet dots; do
    setting working-animation "'$animation'"; sleep 0.6; shot "transcribing-$animation"
done
setting working-animation "'droplet'"
control scenario/synthesizing; sleep 0.6; shot synthesizing

for palette in accent synthwave aurora graphite; do
    setting palette "'$palette'"; control scenario/recording; sleep 0.6; shot "palette-$palette"
done
setting palette "'sunset'"

control scenario/both; sleep 0.5; shot both-first
sleep 3.2; shot both-second

setting applet-width 200; sleep 0.6; shot width-200
setting applet-width 120
setting show-icon true
setting show-visualization false; control scenario/idle; sleep 0.6; shot no-visualization
setting show-visualization true
setting icon-alignment "'center'"; sleep 0.4; shot icon-center
setting icon-alignment "'end'"
setting show-icon false

# The whole picture in one place, beside the system icons. A setting written
# from outside the shell reaches it through a rate-limited file monitor, so
# wait for the switch rather than guess how long it takes.
buttons() { shell_eval "String(($HALVES).length)" | grep -q "'\"$1\"'"; }
setting position "'status-area'"
wait_for "one button in the status area" "buttons 1"; sleep 0.5
control scenario/recording; sleep 0.8; shot status-area-recording
control scenario/transcribing; sleep 0.6; shot status-area-transcribing
setting show-icon true; control scenario/idle; sleep 0.6; shot status-area-idle-icon
setting show-icon false
setting position "'clock'"
wait_for "the halves around the clock" "buttons 2"; sleep 0.5
around_clock center

# A light top bar: the palettes switch to their light-panel shades.
color_scheme() {
    shell_eval "new imports.gi.Gio.Settings({schema_id: 'org.gnome.desktop.interface'}) \
        .set_string('color-scheme', '$1'); 'ok'" > /dev/null
}
color_scheme prefer-light; sleep 1
control scenario/idle; sleep 0.5; shot light-idle
control scenario/recording; sleep 0.8; shot light-recording
control scenario/transcribing; sleep 0.6; shot light-transcribing
control scenario/idle; color_scheme default; sleep 1

# The left half's menu; the right half's has the same in it.
MENU="($HALVES)[0].menu"
open_menu() {
    shell_eval "$MENU.open(); 'ok'" > /dev/null
    sleep 0.8
}
close_menu() {
    shell_eval "$MENU.close(); 'ok'" > /dev/null
    sleep 0.3
}
# The menu item called `name`, by its label or its accessible name, wherever
# it is in the menu's pages.
FIND="const find = (actor, name) => { for (const c of actor.get_children()) { \
    const d = c._delegate; \
    if (d && d !== actor._delegate && (d.label?.text === name || c.accessible_name === name)) return d; \
    const r = find(c, name); if (r) return r; } return null; };"
item() { shell_eval "$FIND const i = find($MENU.box, '$1'); $2"; }

open_menu; shot menu-connected 260 560
# Colors is a page of its own: it slides in from the right, the menu growing
# to its height, and the palettes stay picked on it.
item Colors "i.activate(null); 'ok'" > /dev/null
sleep 0.08; shot menu-colors-sliding 260 700
sleep 0.6; shot menu-colors 260 700
item Back "i.activate(null); 'ok'" > /dev/null
sleep 0.6; shot menu-back 260 560
# Closed on the Colors page, the menu opens again on its main page.
item Colors "i.activate(null); 'ok'" > /dev/null; sleep 0.6
close_menu; open_menu; shot menu-reopened 260 560; close_menu
open_menu; item 'Visualization Style' "i.setSubmenuShown(true); 'ok'" > /dev/null
sleep 0.6; shot menu-style 260 600; close_menu

# The system accent, changed while the extension runs: the Accent palette
# follows it at once, in the top bar and in the menu, as the rest of the
# shell does.
accent() {
    shell_eval "new imports.gi.Gio.Settings({schema_id: 'org.gnome.desktop.interface'}) \
        .set_string('accent-color', '$1'); 'ok'" > /dev/null
}
# Which channel a screenshot leans to: the largest of its mean red, green and
# blue. The black top bar and the white clock add to all three alike.
leans() {
    magick "$out/$1.png" -format "%[fx:mean.r] %[fx:mean.g] %[fx:mean.b]" info: |
        awk '{ if ($1 >= $2 && $1 >= $3) print "red"; else if ($2 >= $3) print "green"; else print "blue" }'
}
setting palette "'accent'"; accent blue
control scenario/recording; sleep 1; shot accent-blue
accent green; sleep 1; shot accent-green
accent pink; sleep 1; shot accent-pink
open_menu; item Colors "i.activate(null); 'ok'" > /dev/null
sleep 0.6; shot menu-colors-accent-pink 260 700; close_menu
if command -v magick > /dev/null; then
    for pair in blue:blue green:green pink:red; do
        name=${pair%%:*} want=${pair##*:}
        got=$(leans "accent-$name")
        if [[ $got != "$want" ]]; then
            echo "With the $name accent, the Accent palette leans $got, not $want." >&2
            echo "The Accent palette didn't follow the accent: see accent-$name.png."
            exit 1
        fi
    done
    echo "  (the Accent palette followed the accent: blue, then green, then pink)"
else
    echo "  (no ImageMagick to check the colors: look at accent-*.png)"
fi
accent blue; setting palette "'sunset'"; control scenario/idle; sleep 0.5

start_daemon() {
    node "$repo/tools/fake-daemon.ts" "$root/daemon.sock" "$root/control.sock" \
        >> "$root/fake-daemon.log" 2>&1 &
    wait_for "the fake daemon" "[[ -S '$root/control.sock' ]]"
}

# A revoked token: the extension asks for a new one and reconnects.
control revoke; sleep 2.5; shot revoked-reconnected
# The daemon goes away, then comes back.
pkill -f "fake-daemon.ts $root/" || true; sleep 1.5; shot daemon-down
open_menu; shot menu-daemon-down 260 300; close_menu
rm -f "$root/control.sock"; start_daemon
wait_for "the extension to reconnect" "status | grep -q '\"streams\":1'"
sleep 0.5; shot daemon-back
# A denial: blocked, with the reason and a way to ask again.
control auth/deny; control revoke; sleep 2.5; shot blocked
open_menu; shot menu-blocked 260 420
# Retry authorization, once allowed: connected again.
control auth/grant
retry=$(item 'Retry authorization' "if (i) i.activate(null); i ? 'found' : 'missing'")
echo "  (retry item: $retry)"
close_menu
wait_for "the retry to reconnect" "status | grep -q '\"streams\":1'"
sleep 0.5; shot retried

# The preferences window, in the Extensions app's process, on this shell's
# display.
dbus-update-activation-environment WAYLAND_DISPLAY=svx-smoke
gnome-extensions prefs "$uuid"
sleep 4
gdbus call --session --dest org.gnome.Shell.Screenshot \
    --object-path /org/gnome/Shell/Screenshot \
    --method org.gnome.Shell.Screenshot.Screenshot false false "$out/prefs.png" > /dev/null
echo "  prefs.png"
pkill -f gnome-shell-extension-prefs || true
pkill -f org.gnome.Shell.Extensions || true

# Disable and enable again: nothing may be left behind or break.
gnome-extensions disable "$uuid"; sleep 0.5
if shell_eval "($HALVES).length === 0" | grep -q "'true'"; then
    echo "Disabled cleanly"
else
    echo "The indicator outlived disable()" >&2
    exit 1
fi
gnome-extensions enable "$uuid"; sleep 1
gnome-extensions info "$uuid" | grep -q 'State: ACTIVE' && echo "Enabled again"
around_clock center

kill $shell_pid 2>/dev/null || true
wait $shell_pid 2>/dev/null || true
# Any JS error or warning fails the run, wherever it came from: a stack trace
# names the extension's files on lines that don't say "error". The
# preferences window runs in the Extensions app, which logs to the session.
if grep -nE "JS ERROR|JS WARNING" "$root/shell.log" "$root/session.log" ||
    grep -nE "super-voice|SuperVoice" "$root/shell.log" | grep -iE "error|warning|exception|critical"; then
    echo "The shell logged problems (above)." >&2
    exit 1
fi
echo "No errors from the extension in the shell's log."
