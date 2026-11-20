// SPDX-License-Identifier: GPL-3.0-only
//! Reconnect delays: super-engine's `RetryStrategy` with the subscription's
//! bounds (`widget_subscription`): exponential from 1 s, capped at 30 s, with
//! ±10% jitter so clients reconnecting after the same daemon restart don't
//! arrive in lockstep.

export const INITIAL_DELAY_MS = 1_000;
export const MAX_DELAY_MS = 30_000;

export class Backoff {
    #attempt = 0;
    readonly #random: () => number;

    /// `random` returns a number in [0, 1); tests pass a fixed one.
    constructor(random: () => number = Math.random) {
        this.#random = random;
    }

    /// The delay before the next attempt, which this call counts.
    next(): number {
        const exponential = INITIAL_DELAY_MS * 2 ** Math.min(this.#attempt, 30);
        const capped = Math.min(exponential, MAX_DELAY_MS);
        this.#attempt += 1;
        const jitter = capped / 10;
        return Math.round(capped + (this.#random() * 2 - 1) * jitter);
    }

    /// A connection succeeded: start again from the shortest delay.
    reset(): void {
        this.#attempt = 0;
    }
}

/// How long the stream may stay silent before it counts as wedged. The daemon
/// sends a keepalive every 30 s.
export const IDLE_TIMEOUT_MS = 60_000;
