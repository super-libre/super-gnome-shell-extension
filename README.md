# Super Voice for GNOME

[![coverage](https://img.shields.io/endpoint?url=https://super-libre.github.io/super-gnome-shell-extension/coverage.json)](https://super-libre.github.io/super-gnome-shell-extension/)

<img src="icons/super-voice.svg" width="96" height="96" alt="Super Voice">

A GNOME Shell extension for [Super Voice](https://github.com/jorge-menjivar/super-voice),
for GNOME what [Super Applet](https://github.com/super-libre/super-cosmic-applet)
is for COSMIC. It shows in the top bar what each of Super Voice's two features is
doing:

1. While speech to text records, it draws your microphone. While it
   transcribes, it shows a working animation.
2. While text to speech speaks, it draws what is playing. While it prepares
   the first audio, it shows the same working animation.
3. When both are active at once, it switches between them every three
   seconds. Both draw in the style and animation set in the menu, each in its
   own gradient from the color pair picked there.
4. The rest of the time it shows nothing, or its icon if you turn that on.
   Click it for settings and the connection's status.

It sits around the clock: two halves, one each side of it, that read as one
picture with the clock in its middle, the low end of the spectrum on the left
and the high end on the right. If another extension moves the clock, or puts
something beside it, the halves follow and stay right beside it. The menu can move it to the status area
instead, beside the system icons, as one picture.

It runs on GNOME Shell 50 and 51, and needs nothing but the Super Voice daemon:
it talks to the daemon over its Unix socket itself, with one session for both
features.

## Install

Each [release](https://github.com/super-libre/super-gnome-shell-extension/releases)
carries the extension as `super-gnome-shell-extension-noarch.tar.gz`
(`-noarch-beta` for a prerelease), with a `SHA256SUMS`. The tarball holds the
extension's directory, its settings schema compiled, for an installer to place
in `/usr/local/share/gnome-shell/extensions/super-voice@super-libre.github.io`,
where GNOME Shell finds extensions for every user. Super Voice's installer
takes it from there.

From source, for this user:

```sh
just install     # build, pack and install for this user
```

Either way, log out and back in (Wayland can't restart GNOME Shell in place),
then enable it in the Extensions app or with
`gnome-extensions enable super-voice@super-libre.github.io`. Settings live in
the menu and in the Extensions app's preferences for it, which stay in step.

### Release

Bump `version-name` in `metadata.json` and `version` in `package.json`, then
push a tag that names it, like `v0.1.0`, or `v0.2.0-beta.1` for a prerelease.
The release workflow checks the tag against both, runs CI's checks, builds the
tarball with `just package`, and publishes it.

## Develop

The extension is TypeScript, compiled file by file with `tsc` (TypeScript 7)
into plain ES modules that GNOME Shell loads as they are. Biome lints and
formats; vitest tests. Run every check through `just`:

```sh
just deps        # install the pinned tools
just ci          # formatting, lints, types, tests, build and pack
just test
just coverage    # the tests' coverage of src/core, the HTML report in coverage/
just package     # the tarball a release publishes, in dist/
just smoke       # drive it in a headless GNOME Shell, screenshots in screenshots/
just run         # try it in a nested GNOME Shell window, against your daemon
```

`just smoke` needs GNOME Shell 50 or newer on the machine. It runs a scripted
daemon (`tools/fake-daemon.ts`) on a socket of its own, and takes the top bar
through every state. The levels it sends while someone talks are real speech:
the bands the engine's own analyzer makes of a recording, at a microphone's
level, which `just speech-fixture` regenerates. The run checks that the low
bands light the left half and the high ones the right, that the halves stay
around the clock, and that the Accent palette follows the system accent. It
covers each visualization, animation and palette, both features at once,
both positions, the light and dark top bars, the menu and its Colors page, a
revoked session, a denial and the daemon going away. Nothing it does touches
your session or your daemon.

### Layout

- `src/core/` is plain TypeScript, tested under Node: the protocol, the state
  of each feature, which one is in front, the palette, and every visualization
  and animation as a list of shapes to draw. Biome refuses a GNOME import here.
- `src/shell/` runs in GNOME Shell: the daemon client (libsoup over the Unix
  socket), the top-bar button, the menu, and the Cairo code that draws the
  shapes.
- `src/prefs.ts` is the preferences window, in libadwaita.

### From the applet

Behavior, formulas and colors are ported from the COSMIC applet, and the tests
port its tests. The palette is checked stop by stop against values the
applet's own `palette.rs` computes: after a change there, regenerate them with
`just palette-fixture ../super-cosmic-applet`.

The extension differs from the applet where GNOME or one daemon calls for it:

- it sits around the clock, as the applet's left and right halves, by
  default, and hides its icon by default;
- the two halves live in one process, so they need nothing to keep them in
  step;
- one event stream and one connection status for the daemon, which serves
  both features with one session;
- losing the daemon resets what each feature was doing, so a stale
  "recording" can't come back on reconnect;
- settings in GSettings, shared by the menu and the preferences window.

## License

GPL-3.0-only. See [LICENSE](LICENSE).
