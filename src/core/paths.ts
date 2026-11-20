// SPDX-License-Identifier: GPL-3.0-only
//! Where the daemon's socket and the extension's token are, resolved the way
//! super-engine resolves them (`super-engine-protocol/src/runtime.rs` and
//! `paths.rs`), so the extension finds the socket the daemon bound.

import { CLIENT_NAME, PRODUCT, SOCKET_ENV, SOCKET_FILE } from './protocol.js';

/// What the resolvers read from the environment. The shell passes GLib's
/// values in; tests pass their own.
export interface Env {
    getenv(name: string): string | null;
    /// The user's id, for the runtime directory when `XDG_RUNTIME_DIR` is unset.
    uid: number;
    /// The user's home directory.
    home: string;
}

/// The runtime directories super-engine accepts a socket under.
const ALLOWED_PREFIXES = ['/run/user/', '/tmp/'];

/// The daemon's HTTP socket.
///
/// A non-empty `SUPER_VOICE_HTTP_SOCKET` wins verbatim. Otherwise the socket
/// is `<runtime dir>/voice/super-voice-http.sock`, where the runtime dir is
/// `$XDG_RUNTIME_DIR` (or `/run/user/<uid>`). A runtime dir that is empty,
/// too long, holds `..` or a NUL, or sits outside the allowed prefixes falls
/// back to `/tmp/voice/`, as the daemon does.
///
/// super-engine also canonicalizes the joined path when it exists and falls
/// back if that leaves the prefixes. A symlinked runtime dir is the only case
/// where that differs, and the daemon resolves its own path the same way, so
/// the extension skips it.
export function socketPath(env: Env): string {
    const override = env.getenv(SOCKET_ENV);
    if (override) {
        return override;
    }
    const fallback = `/tmp/${PRODUCT.shortName}/${SOCKET_FILE}`;
    const runtimeDir = env.getenv('XDG_RUNTIME_DIR') ?? `/run/user/${env.uid}`;
    if (runtimeDir.length === 0 || runtimeDir.length > 256) {
        return fallback;
    }
    if (runtimeDir.includes('..') || runtimeDir.includes('\0')) {
        return fallback;
    }
    if (!ALLOWED_PREFIXES.some((prefix) => runtimeDir.startsWith(prefix))) {
        return fallback;
    }
    return `${runtimeDir.replace(/\/+$/, '')}/${PRODUCT.shortName}/${SOCKET_FILE}`;
}

/// Super Voice's state directory, `$XDG_STATE_HOME/super-voice`, falling back
/// to `~/.local/state/super-voice`. super-engine keeps each client's session
/// token under it.
export function stateDir(env: Env): string {
    const xdg = env.getenv('XDG_STATE_HOME');
    const base = xdg?.startsWith('/') ? xdg : `${env.home}/.local/state`;
    return `${base.replace(/\/+$/, '')}/${PRODUCT.slug}`;
}

/// The file the extension's token is kept in: super-engine's
/// `<state>/<slug>/clients/<name>.json`.
export function tokenPath(env: Env): string {
    return `${stateDir(env)}/clients/${CLIENT_NAME}.json`;
}
