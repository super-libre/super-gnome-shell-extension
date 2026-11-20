// SPDX-License-Identifier: GPL-3.0-only
//! What the extension and the Super Voice daemon agree on.
//!
//! These mirror Super Voice's `ProductSpec` (super-voice-registry-types) and
//! super-engine's client transport. The daemon is one process serving both
//! features, so the extension holds one session with it.

/// Super Voice's names, from its `ProductSpec`.
export const PRODUCT = {
    displayName: 'Super Voice',
    slug: 'super-voice',
    /// The directory under `$XDG_RUNTIME_DIR` that holds the socket.
    shortName: 'voice',
    envPrefix: 'SUPER_VOICE',
} as const;

/// The daemon's HTTP socket file, `<slug>-http.sock`.
export const SOCKET_FILE = `${PRODUCT.slug}-http.sock`;

/// The environment variable that overrides the socket path verbatim. The
/// daemon reads the same one, so tests point both ends at a socket of their
/// own with it.
export const SOCKET_ENV = `${PRODUCT.envPrefix}_HTTP_SOCKET`;

/// The daemon binary. The extension counts Super Voice as installed when it
/// finds this on `PATH` or in an install prefix.
export const DAEMON_BINARY = `${PRODUCT.slug}-daemon`;

/// Every request path starts with this.
export const API_PREFIX = '/v1';

/// The `Host` super-engine's client sends. The daemon only checks it on TCP.
export const HOST = 'localhost';

/// The extension's name in the daemon's client list, and the name of the file
/// its token is stored in.
export const CLIENT_NAME = 'super-gnome-shell-extension';

/// The extension's name in the daemon's consent dialog. Self-reported: the
/// daemon identifies the caller by its binary, which here is gnome-shell.
export const APP_NAME = 'Super Voice for GNOME';

/// Every scope the extension needs: `recording_events` for dictation,
/// `playback_events` for speech, `audio_visualization` for the levels.
export const SCOPES = ['recording_events', 'playback_events', 'audio_visualization'] as const;

/// Super Voice's two features.
export type Feature = 'stt' | 'tts';

export const FEATURES: readonly Feature[] = ['stt', 'tts'];

/// The names Super Voice's app gives the features.
export const FEATURE_NAMES: Record<Feature, string> = {
    stt: 'Speech to text',
    tts: 'Text to speech',
};

/// The `/events` topics each feature needs. The microphone's level is
/// `frequency_bands`, the speakers' `playback_frequency_bands`. Text to
/// speech's `speech_progress` marks the first audio playing: an utterance is
/// accepted before any audio exists for it.
export const TOPICS: Record<Feature, readonly string[]> = {
    stt: ['recording_state', 'frequency_bands', 'transcribing_started', 'transcribing_stopped'],
    tts: ['speaking_state', 'speech_progress', 'playback_frequency_bands'],
};

/// All topics, for the one subscription the extension holds.
export const ALL_TOPICS: readonly string[] = [...TOPICS.stt, ...TOPICS.tts];

/// Super Voice's settings app, which the menu's launch item opens.
export const SETTINGS_APP = {
    /// Its desktop entry, looked up first.
    desktopId: 'super-voice-app.desktop',
    /// The executable, for when there is no desktop entry.
    binary: 'super-voice-app',
    /// Its icon in the icon theme.
    icon: 'super-voice-app',
} as const;

/// Where Super Voice installs its binaries, searched beside `PATH`. The shell
/// may have been started with a `PATH` that leaves `/usr/local/bin` out.
export const INSTALL_DIRS = ['/usr/local/bin', '/usr/bin'] as const;

/// How the daemon is restarted, for the hint shown after a denial.
export const RESTART_COMMAND = `systemctl --user restart ${PRODUCT.slug}`;

export const REPOSITORY_URL = 'https://github.com/super-libre/super-gnome-shell-extension';
