// SPDX-License-Identifier: GPL-3.0-only
//! HTTP/1.1 to the daemon over its Unix socket, through libsoup: libsoup
//! connects to a `GUnixSocketAddress` when it is the session's
//! `remote-connectable`, and streams a response body as it arrives, which
//! the `/events` stream needs.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';
import { classify, DaemonRequestError, unreachable } from '../../core/errors.js';
import { API_PREFIX, HOST } from '../../core/protocol.js';
import { childCancellable, errorMessage, isCancelled } from '../async.js';

/// How long a request that isn't waiting on a person may wait for the
/// response headers, as in super-engine's client. A daemon that accepts the
/// connection and never answers would otherwise hang the extension.
const REQUEST_TIMEOUT_MS = 90_000;

export interface RequestOptions {
    token?: string;
    body?: unknown;
    /// `/auth/request`: every refusal is the user's, and there is no
    /// timeout, because the daemon holds the request open while its consent
    /// prompt waits for an answer.
    auth?: boolean;
}

export class DaemonHttp {
    readonly #session: Soup.Session;
    readonly #encoder = new TextEncoder();
    readonly #decoder = new TextDecoder();

    constructor(socketPath: string) {
        this.#session = new Soup.Session({
            remote_connectable: Gio.UnixSocketAddress.new(socketPath),
            // The event stream holds one connection for as long as it runs.
            max_conns_per_host: 4,
            // No I/O timeout: the event stream is quiet between keepalives.
            timeout: 0,
        });
        // The daemon doesn't compress, and asking would only add a header.
        this.#session.remove_feature_by_type(Soup.ContentDecoder.$gtype);
    }

    /// Send a JSON request and parse the JSON answer. Throws
    /// `DaemonRequestError` for every failure but cancellation.
    async request(
        method: 'GET' | 'POST',
        path: string,
        cancellable: Gio.Cancellable,
        options: RequestOptions = {},
    ): Promise<unknown> {
        const message = this.#message(method, path, options.token);
        if (options.body !== undefined) {
            message.set_request_body_from_bytes(
                'application/json',
                new GLib.Bytes(this.#encoder.encode(JSON.stringify(options.body))),
            );
        }
        const bytes = await this.#withTimeout(
            options.auth ? null : REQUEST_TIMEOUT_MS,
            cancellable,
            (c) => this.#session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, c),
        );
        const text = this.#decoder.decode(bytes.get_data() ?? new Uint8Array());
        const status = message.get_status();
        if (status < 200 || status >= 300) {
            throw new DaemonRequestError(classify(status, text, options.auth ?? false));
        }
        try {
            return JSON.parse(text) as unknown;
        } catch {
            throw new DaemonRequestError(
                unreachable(`unreadable answer from the daemon (HTTP ${status})`),
            );
        }
    }

    /// Open `GET /events` for `topics` and return its body, a line at a time.
    /// Throws `DaemonRequestError` when the daemon refuses the stream.
    async openEvents(
        token: string,
        topics: readonly string[],
        cancellable: Gio.Cancellable,
    ): Promise<Gio.DataInputStream> {
        const message = this.#message('GET', `/events?topics=${topics.join(',')}`, token);
        message.get_request_headers().append('Accept', 'text/event-stream');
        const body = await this.#withTimeout(REQUEST_TIMEOUT_MS, cancellable, (c) =>
            this.#session.send_async(message, GLib.PRIORITY_DEFAULT, c),
        );
        const status = message.get_status();
        if (status < 200 || status >= 300) {
            const text = await readAll(body, cancellable);
            throw new DaemonRequestError(classify(status, text));
        }
        return new Gio.DataInputStream({
            base_stream: body,
            close_base_stream: true,
            newline_type: Gio.DataStreamNewlineType.ANY,
        });
    }

    /// Drop every connection. The session is unusable afterwards.
    close(): void {
        this.#session.abort();
    }

    #message(method: string, path: string, token: string | undefined): Soup.Message {
        const message = Soup.Message.new(method, `http://${HOST}${API_PREFIX}${path}`);
        if (message === null) {
            throw new DaemonRequestError(unreachable(`bad request path ${path}`));
        }
        if (token !== undefined) {
            message.get_request_headers().append('Authorization', `Bearer ${token}`);
        }
        return message;
    }

    /// Run `send` with its own cancellable, cancelled by `parent` and, when
    /// `timeoutMs` is set, by the timer. A transport failure becomes an
    /// `other` error; cancellation by `parent` is passed on as it is.
    async #withTimeout<T>(
        timeoutMs: number | null,
        parent: Gio.Cancellable,
        send: (cancellable: Gio.Cancellable) => Promise<T>,
    ): Promise<T> {
        const { cancellable, release } = childCancellable(parent);
        let timedOut = false;
        const timer =
            timeoutMs === null
                ? 0
                : GLib.timeout_add(GLib.PRIORITY_DEFAULT, timeoutMs, () => {
                      timedOut = true;
                      cancellable.cancel();
                      return GLib.SOURCE_REMOVE;
                  });
        try {
            return await send(cancellable);
        } catch (error) {
            if (isCancelled(error) && !timedOut) {
                throw error;
            }
            if (error instanceof DaemonRequestError) {
                throw error;
            }
            throw new DaemonRequestError(
                unreachable(
                    timedOut
                        ? `the daemon didn't answer within ${(timeoutMs ?? 0) / 1000} s`
                        : errorMessage(error),
                ),
            );
        } finally {
            if (timer !== 0 && !timedOut) {
                GLib.source_remove(timer);
            }
            release();
        }
    }
}

async function readAll(stream: Gio.InputStream, cancellable: Gio.Cancellable): Promise<string> {
    const lines = new Gio.DataInputStream({ base_stream: stream, close_base_stream: true });
    const decoder = new TextDecoder();
    const out: string[] = [];
    try {
        for (;;) {
            const [line] = await lines.read_line_async(GLib.PRIORITY_DEFAULT, cancellable);
            if (line === null) {
                break;
            }
            out.push(decoder.decode(line));
        }
    } catch {
        // Whatever arrived is the body.
    }
    return out.join('\n');
}
