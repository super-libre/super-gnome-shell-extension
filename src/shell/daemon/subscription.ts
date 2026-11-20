// SPDX-License-Identifier: GPL-3.0-only
//! The self-healing `/events` subscription: the port of the applet's
//! `src/daemon/events.rs`, itself super-engine's `widget_subscription`.
//!
//! It reconnects with backoff, gets a new token when the daemon refuses the
//! one it has, treats 60 s of silence as a wedged connection (the daemon
//! sends a keepalive every 30 s), and stops only when the user denies the
//! extension a token, or when the extension is disabled.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import { Backoff, IDLE_TIMEOUT_MS } from '../../core/backoff.js';
import { DaemonRequestError, describe, isUserDenied, needsNewToken } from '../../core/errors.js';
import { ALL_TOPICS } from '../../core/protocol.js';
import { SseParser, type StreamEvent } from '../../core/sse.js';
import { childCancellable, errorMessage, isCancelled, nowMs, sleep } from '../async.js';
import type { DaemonHttp } from './http.js';
import type { Logger, Session } from './session.js';

export type Update =
    | { kind: 'connected' }
    /// Asking for a token; the consent prompt may be up.
    | { kind: 'asking' }
    /// The daemon is unreachable or the stream broke. Retrying.
    | { kind: 'disconnected'; reason: string }
    /// The consent prompt went unanswered or couldn't be shown. Retrying.
    | { kind: 'needs-permission'; reason: string }
    /// The daemon withdrew the token. Asking for another.
    | { kind: 'revoked'; reason: string }
    /// The user said no. Nothing more until `retry()`.
    | { kind: 'blocked'; reason: string }
    | { kind: 'event'; event: StreamEvent };

/// How often the idle deadline is checked.
const IDLE_CHECK_MS = 5_000;

export class Subscription {
    readonly #http: DaemonHttp;
    readonly #session: Session;
    readonly #onUpdate: (update: Update) => void;
    readonly #logger: Logger;
    readonly #cancellable = new Gio.Cancellable();
    readonly #backoff = new Backoff();
    #running = false;

    constructor(
        http: DaemonHttp,
        session: Session,
        onUpdate: (update: Update) => void,
        logger: Logger,
    ) {
        this.#http = http;
        this.#session = session;
        this.#onUpdate = onUpdate;
        this.#logger = logger;
    }

    start(): void {
        if (this.#running || this.#cancellable.is_cancelled()) {
            return;
        }
        this.#running = true;
        this.#run()
            .catch((error: unknown) => {
                if (!isCancelled(error)) {
                    this.#logger.warn(`The event subscription stopped: ${errorMessage(error)}`);
                }
            })
            .finally(() => {
                this.#running = false;
            });
    }

    /// Ask again after a denial, once the user has restarted the daemon.
    retry(): void {
        this.#backoff.reset();
        this.start();
    }

    /// Stop for good, from disable(): every wait and read is cancelled.
    stop(): void {
        this.#cancellable.cancel();
    }

    async #run(): Promise<void> {
        const cancellable = this.#cancellable;
        for (;;) {
            let token: string;
            try {
                token = await this.#session.token(cancellable, () =>
                    this.#onUpdate({ kind: 'asking' }),
                );
            } catch (error) {
                if (isCancelled(error)) {
                    throw error;
                }
                const e = error instanceof DaemonRequestError ? error.error : null;
                if (e !== null && isUserDenied(e)) {
                    // Asking again would only meet the daemon's cached denial.
                    this.#onUpdate({
                        kind: 'blocked',
                        reason: e.kind === 'auth-denied' ? e.reason : describe(e),
                    });
                    return;
                }
                if (e?.kind === 'auth-denied') {
                    this.#onUpdate({ kind: 'needs-permission', reason: e.reason });
                } else {
                    this.#onUpdate({ kind: 'disconnected', reason: errorMessage(error) });
                }
                await sleep(this.#backoff.next(), cancellable);
                continue;
            }

            let stream: Gio.DataInputStream;
            try {
                stream = await this.#http.openEvents(token, ALL_TOPICS, cancellable);
            } catch (error) {
                if (isCancelled(error)) {
                    throw error;
                }
                const e = error instanceof DaemonRequestError ? error.error : null;
                // A token from before the extension subscribed to a topic
                // lacks its scope, and the daemon refuses the whole stream.
                if (e !== null && needsNewToken(e)) {
                    this.#session.refused(token);
                    this.#onUpdate({ kind: 'revoked', reason: describe(e) });
                    continue;
                }
                this.#onUpdate({ kind: 'disconnected', reason: errorMessage(error) });
                await sleep(this.#backoff.next(), cancellable);
                continue;
            }

            this.#onUpdate({ kind: 'connected' });
            this.#backoff.reset();
            const ended = await this.#read(stream, cancellable);
            if (ended.kind === 'revoked') {
                this.#session.refused(token);
                this.#onUpdate({ kind: 'revoked', reason: ended.reason });
                continue;
            }
            this.#onUpdate({ kind: 'disconnected', reason: ended.reason });
            await sleep(this.#backoff.next(), cancellable);
        }
    }

    /// Read events until the stream ends, goes quiet, or is revoked.
    async #read(
        stream: Gio.DataInputStream,
        parent: Gio.Cancellable,
    ): Promise<{ kind: 'revoked' | 'ended'; reason: string }> {
        const { cancellable, release } = childCancellable(parent);
        const parser = new SseParser();
        const decoder = new TextDecoder();
        let lastActivity = nowMs();
        let idle = false;
        const watchdog = GLib.timeout_add(GLib.PRIORITY_DEFAULT, IDLE_CHECK_MS, () => {
            if (nowMs() - lastActivity >= IDLE_TIMEOUT_MS) {
                idle = true;
                cancellable.cancel();
                return GLib.SOURCE_REMOVE;
            }
            return GLib.SOURCE_CONTINUE;
        });
        try {
            for (;;) {
                const [bytes] = await stream.read_line_async(GLib.PRIORITY_DEFAULT, cancellable);
                if (bytes === null) {
                    return { kind: 'ended', reason: 'stream ended' };
                }
                lastActivity = nowMs();
                const event = parser.push(decoder.decode(bytes));
                if (event === null) {
                    continue;
                }
                if (event.name === 'revoked') {
                    const reason = (event.payload as { reason?: unknown } | null)?.reason;
                    return {
                        kind: 'revoked',
                        reason: `revoked: ${typeof reason === 'string' ? reason : 'unknown'}`,
                    };
                }
                if (event.name === 'subscribed' || event.name === 'keepalive') {
                    continue;
                }
                this.#onUpdate({ kind: 'event', event });
            }
        } catch (error) {
            if (idle) {
                return { kind: 'ended', reason: `idle_timeout (${IDLE_TIMEOUT_MS / 1000}s)` };
            }
            if (isCancelled(error)) {
                throw error;
            }
            return { kind: 'ended', reason: errorMessage(error) };
        } finally {
            if (!idle) {
                GLib.source_remove(watchdog);
            }
            release();
            stream.close_async(GLib.PRIORITY_DEFAULT, null).catch(() => {});
        }
    }
}
