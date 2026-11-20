// SPDX-License-Identifier: GPL-3.0-only
//! What a failed request means, classified the way super-engine's client does
//! (`http_client/internal/error.rs` and `transport.rs`), because the response
//! to each differs:
//!
//! - `invalid_session` (401) and `scope_denied` (403): forget the token and
//!   ask for a new one;
//! - `auth_denied`: the user declined, or the daemon wouldn't ask. A
//!   `user_denied` is final until the daemon restarts;
//! - anything else: the daemon is unreachable or unwell; retry later.

export type DaemonError =
    | { kind: 'invalid-session'; reason: string }
    | { kind: 'auth-denied'; reason: string }
    | { kind: 'scope-denied' }
    | { kind: 'other'; message: string };

/// Thrown by the transport. Carries the classified error.
export class DaemonRequestError extends Error {
    readonly error: DaemonError;

    constructor(error: DaemonError) {
        super(describe(error));
        this.name = 'DaemonRequestError';
        this.error = error;
    }
}

/// The error a non-success response stands for. `auth` is true for
/// `/auth/request`, whose refusals are all the user's (or the daemon's
/// refusal to ask), never an operational failure.
export function classify(status: number, body: string, auth = false): DaemonError {
    const json = parseObject(body);
    if (auth) {
        return { kind: 'auth-denied', reason: reasonOf(json, 'auth_denied') };
    }
    if (status === 401) {
        return { kind: 'invalid-session', reason: reasonOf(json, 'unknown') };
    }
    // A 403 is a scope refusal only when the daemon says so. Any other 403
    // stays an operational failure: a new token wouldn't fix it, and the
    // consent popup asking for one is worse than the error.
    if (status === 403 && namesScopeDenied(json)) {
        return { kind: 'scope-denied' };
    }
    return { kind: 'other', message: daemonMessage(status, json) };
}

/// A transport failure: the socket is missing, the connection dropped.
export function unreachable(message: string): DaemonError {
    return { kind: 'other', message };
}

/// Whether a new token would fix this.
export function needsNewToken(error: DaemonError): boolean {
    return error.kind === 'invalid-session' || error.kind === 'scope-denied';
}

/// Whether the user said no: the only refusals that stop the extension from
/// asking again. Any other `auth_denied` reason (the popup failed, or timed
/// out) is worth another try.
export function isUserDenied(error: DaemonError): boolean {
    return (
        error.kind === 'auth-denied' &&
        (error.reason === 'user_denied' || error.reason === 'user_denied_cached')
    );
}

/// The error as super-engine's `Display` writes it, for logs and status lines.
export function describe(error: DaemonError): string {
    switch (error.kind) {
        case 'invalid-session':
            return `invalid_session (${error.reason})`;
        case 'auth-denied':
            return `auth_denied (${error.reason})`;
        case 'scope-denied':
            return 'scope_denied (HTTP 403)';
        case 'other':
            return error.message;
    }
}

function reasonOf(json: Record<string, unknown> | null, fallback: string): string {
    const data = json?.data;
    if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
        const reason = (data as Record<string, unknown>).reason;
        if (typeof reason === 'string') {
            return reason;
        }
    }
    return fallback;
}

function namesScopeDenied(json: Record<string, unknown> | null): boolean {
    return ['error_code', 'error', 'message'].some((key) => json?.[key] === 'scope_denied');
}

/// super-engine's `daemon_error`: the envelope's code and message, and the
/// status.
function daemonMessage(status: number, json: Record<string, unknown> | null): string {
    const field = (key: string) => {
        const value = json?.[key];
        return typeof value === 'string' && value !== '' ? value : null;
    };
    const code = field('error_code') ?? field('error');
    const message = field('message');
    let detail: string | null;
    if (code !== null && message !== null) {
        detail = code === message ? code : `${code}: ${message}`;
    } else {
        detail = code ?? message;
    }
    return detail === null ? `daemon returned HTTP ${status}` : `${detail} (HTTP ${status})`;
}

function parseObject(body: string): Record<string, unknown> | null {
    try {
        const value: unknown = JSON.parse(body);
        return typeof value === 'object' && value !== null && !Array.isArray(value)
            ? (value as Record<string, unknown>)
            : null;
    } catch {
        return null;
    }
}
