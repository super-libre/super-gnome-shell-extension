uuid := 'super-voice@super-libre.github.io'
schema := 'org.gnome.shell.extensions.super-voice'
zip := 'dist/' + uuid + '.shell-extension.zip'

# List the recipes
default:
    @just --list

# Install the pinned tools
deps:
    npm ci

# Lint and type-check, with the same gate as CI
check:
    npx biome check .
    npx tsc --noEmit -p tsconfig.json
    npx tsc --noEmit -p tsconfig.tests.json

# Check formatting without modifying files
fmt-check:
    npx biome format .

# Format the code, and apply Biome's safe fixes
fmt:
    npx biome check --write .

test *args:
    npx vitest run {{ args }}

# Compile to build/, laid out as the extension's directory
build:
    rm -rf build
    npx tsc -p tsconfig.json
    cp metadata.json stylesheet.css build/
    cp -r schemas icons build/

# Build, then pack the zip extensions.gnome.org and `gnome-extensions install` take
pack: build
    mkdir -p dist
    gnome-extensions pack build --force --out-dir=dist \
        --extra-source=core --extra-source=shell --extra-source=icons
    @echo "{{ zip }}"

# Everything CI runs
ci: fmt-check check test pack

# Install for this user. GNOME Shell loads it at the next login (Wayland
# can't restart the shell in place), or try it now with `just run`.
install: pack
    gnome-extensions install --force {{ zip }}
    @echo "Installed {{ uuid }}. Log out and back in, then: gnome-extensions enable {{ uuid }}"

uninstall:
    gnome-extensions uninstall {{ uuid }}

# A nested GNOME Shell with the extension enabled, in a window, against the
# running Super Voice daemon. Its settings and extensions are its own; the
# daemon still asks you to allow it once.
run: pack
    tools/nested-shell.sh {{ zip }} {{ uuid }}

# Drive the extension in a headless GNOME Shell against a scripted daemon,
# and screenshot the top bar in each state, into screenshots/.
smoke: pack
    tools/smoke.sh {{ zip }} {{ uuid }} {{ schema }}

# Dump the COSMIC applet's palette, as computed by its own palette.rs, into
# tests/fixtures/palette.json. Usage: just palette-fixture ../super-cosmic-applet
palette-fixture applet:
    cp {{ applet }}/src/models/palette.rs tools/palette-golden/src/palette.rs
    cp {{ applet }}/Cargo.lock tools/palette-golden/Cargo.lock
    cd tools/palette-golden && cargo run --release --quiet > ../../tests/fixtures/palette.json

# Turn a recording of speech into the bands the daemon would send for it, with
# the engine's own analyzer, into tests/fixtures/speech-bands.json, which the
# tests and the fake daemon replay. The speech is brought to a microphone's
# level first. The fixture there comes from Super Voice's audio.mp3.
# Usage: just speech-fixture ../super-stt/audio.mp3
speech-fixture recording:
    mkdir -p build
    ffmpeg -v error -y -i {{ recording }} -ac 1 -ar 48000 -f f32le build/speech.f32
    cd tools/speech-bands && CARGO_NET_GIT_FETCH_WITH_CLI=true cargo run --release --quiet -- \
        ../../build/speech.f32 48000 > ../../tests/fixtures/speech-bands.json

# Remove build output
clean:
    rm -rf build dist screenshots
