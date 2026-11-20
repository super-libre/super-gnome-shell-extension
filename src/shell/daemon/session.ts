// SPDX-License-Identifier: GPL-3.0-only
//! The extension's session token.
//!
//! The daemon mints a token once the user allows the extension, and binds it
//! to the binary that asked, which for an extension is gnome-shell. The token
//! is kept where super-engine's client keeps every client's, in a 0600 file,
//! so the next login starts from it instead of asking again. The applet
//! needed a lock shared between its processes to ask only once; the extension
//! is one process, so one ask in flight at a time is enough.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import { DaemonRequestError } from '../../core/errors.js';
import { APP_NAME, SCOPES } from '../../core/protocol.js';
import { isCancelled, isIoError } from '../async.js';
import type { DaemonHttp } from './http.js';

/// What super-engine's client stores: the token and the scopes it was
/// requested with and granted.
interface Stored {
    token: string;
    requested: string[];
    granted: string[];
}

export interface Logger {
    log(...args: unknown[]): void;
    warn(...args: unknown[]): void;
}

export class Session {
    readonly #http: DaemonHttp;
    readonly #path: string;
    readonly #version: string;
    readonly #logger: Logger;
    #current: string | null = null;
    /// Every token the daemon refused. Tokens are never reused, so one
    /// refused is never worth presenting again.
    readonly #refused = new Set<string>();
    #asking: Promise<string> | null = null;

    constructor(http: DaemonHttp, tokenPath: string, version: string, logger: Logger) {
        this.#http = http;
        this.#path = tokenPath;
        this.#version = version;
        this.#logger = logger;
    }

    /// A token to present: the one held, the one stored, or a new one, which
    /// may put the daemon's consent prompt on screen. `onAsk` runs just
    /// before asking.
    async token(cancellable: Gio.Cancellable, onAsk: () => void): Promise<string> {
        if (this.#current !== null) {
            return this.#current;
        }
        if (this.#asking !== null) {
            return this.#asking;
        }
        const stored = await this.#load(cancellable);
        if (stored !== null && !this.#refused.has(stored.token)) {
            this.#current = stored.token;
            return stored.token;
        }
        onAsk();
        this.#asking = this.#ask(cancellable).finally(() => {
            this.#asking = null;
        });
        return this.#asking;
    }

    /// The daemon refused `token`: don't present it again.
    refused(token: string): void {
        if (this.#current === token) {
            this.#current = null;
        }
        this.#refused.add(token);
    }

    async #ask(cancellable: Gio.Cancellable): Promise<string> {
        this.#logger.log('Asking Super Voice for a session token');
        const answer = await this.#http.request('POST', '/auth/request', cancellable, {
            auth: true,
            body: { app_name: APP_NAME, scopes: SCOPES, version: this.#version },
        });
        const token = (answer as { session_token?: unknown })?.session_token;
        const granted = (answer as { scopes?: unknown })?.scopes;
        if (typeof token !== 'string' || token === '') {
            throw new DaemonRequestError({
                kind: 'other',
                message: 'the daemon granted no token',
            });
        }
        this.#current = token;
        this.#save({
            token,
            requested: [...SCOPES],
            granted: Array.isArray(granted) ? granted.filter((s) => typeof s === 'string') : [],
        });
        return token;
    }

    /// The stored token, if it was requested with every scope the extension
    /// needs now. A token from a version that asked for less would be refused
    /// on the first event of a newer topic.
    async #load(cancellable: Gio.Cancellable): Promise<Stored | null> {
        try {
            const [contents] = await Gio.File.new_for_path(this.#path).load_contents_async(
                cancellable,
            );
            const stored = JSON.parse(new TextDecoder().decode(contents)) as Partial<Stored>;
            if (
                typeof stored.token !== 'string' ||
                !Array.isArray(stored.requested) ||
                !SCOPES.every((s) => stored.requested?.includes(s))
            ) {
                return null;
            }
            return {
                token: stored.token,
                requested: stored.requested,
                granted: stored.granted ?? [],
            };
        } catch (error) {
            if (isCancelled(error)) {
                throw error;
            }
            if (!isIoError(error, Gio.IOErrorEnum.NOT_FOUND)) {
                this.#logger.warn(`Can't read the stored session token: ${String(error)}`);
            }
            return null;
        }
    }

    /// Store the token for the next login, readable only by this user, in one
    /// step so a reader never sees half of it.
    #save(stored: Stored): void {
        try {
            GLib.mkdir_with_parents(GLib.path_get_dirname(this.#path), 0o700);
            GLib.file_set_contents_full(
                this.#path,
                new TextEncoder().encode(JSON.stringify(stored)),
                GLib.FileSetContentsFlags.CONSISTENT,
                0o600,
            );
        } catch (error) {
            // This login still has it. The next one starts by asking again.
            this.#logger.warn(`Can't store the session token: ${String(error)}`);
        }
    }
}
