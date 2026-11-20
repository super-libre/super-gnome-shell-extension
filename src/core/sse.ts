// SPDX-License-Identifier: GPL-3.0-only
//! The daemon's `/events` stream, a line at a time.
//!
//! Server-sent events arrive as blocks of `field: value` lines ended by a
//! blank line. The parsing follows super-engine's client
//! (`http_client/internal/sse.rs` and `v1/events.rs`), so the extension reads
//! every block the way the applet does:
//!
//! - `event:` names the block, and `data:` lines (joined with `\n`) carry its
//!   JSON payload, which is `null` when it doesn't parse;
//! - a block of comments alone (`: keepalive`) is a keepalive, so the idle
//!   deadline resets on the daemon's heartbeat;
//! - a block with neither is dropped, and so is one with data but no name.

/// One event from the stream.
export interface StreamEvent {
    name: string;
    payload: unknown;
}

/// The name a comment-only block is reported under.
export const KEEPALIVE = 'keepalive';

/// Folds lines into events. Feed it each line without its line ending; a
/// trailing `\r` is tolerated.
export class SseParser {
    #event: string | null = null;
    #data: string[] = [];
    #sawComment = false;
    #sawAnything = false;

    /// The event a blank line completes, or `null`.
    push(rawLine: string): StreamEvent | null {
        const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
        if (line === '') {
            return this.#dispatch();
        }
        this.#sawAnything = true;
        if (line.startsWith(':')) {
            this.#sawComment = true;
        } else if (line.startsWith('event:')) {
            this.#event = line.slice('event:'.length).trimStart();
        } else if (line.startsWith('data:')) {
            this.#data.push(line.slice('data:'.length).trimStart());
        }
        // `id:`, `retry:` and unknown fields carry nothing the extension uses.
        return null;
    }

    #dispatch(): StreamEvent | null {
        if (!this.#sawAnything) {
            return null;
        }
        const event = this.#event;
        const data = this.#data.join('\n');
        const sawComment = this.#sawComment;
        this.#event = null;
        this.#data = [];
        this.#sawComment = false;
        this.#sawAnything = false;

        if (event !== null) {
            return { name: event, payload: parseJson(data) };
        }
        if (sawComment) {
            return { name: KEEPALIVE, payload: null };
        }
        return null;
    }
}

function parseJson(text: string): unknown {
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}
