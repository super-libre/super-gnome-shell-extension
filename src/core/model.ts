// SPDX-License-Identifier: GPL-3.0-only
//! Everything the panel shows, folded from the daemon's events: the port of
//! the applet's `SuperApplet` state (`src/app/mod.rs`) and its event handling
//! (`src/app/update.rs`).
//!
//! The applet held one subscription and one connection state per feature,
//! from when the features were separate daemons. Super Voice is one daemon
//! with one token, so the extension holds one of each.

import type { DaemonEvent } from './events.js';
import { type Clock, type Phase, RecordingPhase, SpeechPhase } from './phase.js';
import type { Feature } from './protocol.js';

/// How long each feature stays in front while both are active.
export const ALTERNATE_MS = 3_000;

/// Above this total energy, someone is speaking.
export const SPEECH_DETECTED_ENERGY = 0.02;

/// The bands a cleared visualization holds: the engine's band count, all zero.
export const NUM_FREQUENCY_BANDS = 64;

export type Connection =
    /// Reaching the daemon, which may still be starting.
    | { kind: 'connecting' }
    | { kind: 'connected' }
    /// Asking the daemon for a session. Its consent prompt may be on screen.
    | { kind: 'asking' }
    /// The last ask got no answer (`user_dismissed`), or the daemon couldn't
    /// put its prompt up (`popup_failed`). The extension asks again.
    | { kind: 'needs-permission'; reason: string }
    /// The daemon withdrew the session, and a new one is on its way.
    | { kind: 'error'; message: string }
    /// The user declined the consent prompt. Nothing is retried until they
    /// ask, after restarting the daemon.
    | { kind: 'blocked'; reason: string };

/// What a change left for the panel to do.
export interface Effects {
    /// The bars on screen no longer hold: draw zeros until the next frame.
    clearBars: boolean;
    /// The working animation starts over.
    resetAnimation: boolean;
    /// A different feature is in front, or none: its colors, its bars.
    frontChanged: boolean;
    /// Anything the panel shows changed.
    redraw: boolean;
}

export function noEffects(): Effects {
    return { clearBars: false, resetAnimation: false, frontChanged: false, redraw: false };
}

function merge(a: Effects, b: Effects): Effects {
    return {
        clearBars: a.clearBars || b.clearBars,
        resetAnimation: a.resetAnimation || b.resetAnimation,
        frontChanged: a.frontChanged || b.frontChanged,
        redraw: a.redraw || b.redraw,
    };
}

/// The feature in front among the active ones: the only one, or with two,
/// whichever the alternation points at.
export function pickFront(active: readonly Feature[], alternate: boolean): Feature | null {
    if (active.length === 0) {
        return null;
    }
    if (active.length === 1) {
        return active[0] ?? null;
    }
    return alternate ? 'tts' : 'stt';
}

export class Model {
    installed = false;
    connection: Connection = { kind: 'connecting' };
    readonly stt: RecordingPhase;
    readonly tts: SpeechPhase;
    /// Which feature the alternation points at while both are active. It
    /// isn't reset, as in the applet: the next time both are active, the one
    /// it points at goes first.
    alternate = false;
    /// The feature whose bars and colors the panel draws. It keeps the last
    /// front feature when none is active, so the colors don't flicker.
    shown: Feature = 'stt';
    /// The front feature's latest level meter.
    bands: Float32Array = new Float32Array(NUM_FREQUENCY_BANDS);
    totalEnergy = 0;
    #front: Feature | null = null;

    constructor(now: Clock) {
        this.stt = new RecordingPhase(now);
        this.tts = new SpeechPhase(now);
    }

    phase(feature: Feature): Phase {
        return feature === 'stt' ? this.stt : this.tts;
    }

    /// A feature counts only while the daemon is installed, connected, and
    /// doing something for it.
    isActive(feature: Feature): boolean {
        return (
            this.installed && this.connection.kind === 'connected' && this.phase(feature).isActive
        );
    }

    activeFeatures(): Feature[] {
        return (['stt', 'tts'] as const).filter((f) => this.isActive(f));
    }

    /// Whether both features are active, so the alternation timer runs.
    get bothActive(): boolean {
        return this.activeFeatures().length > 1;
    }

    /// The feature in front, or `null` when none is active.
    get front(): Feature | null {
        return this.#front;
    }

    /// The error icon shows on a revoked session, a denial, or a permission
    /// request that went unanswered.
    get needsAttention(): boolean {
        const kind = this.connection.kind;
        return (
            this.installed &&
            (kind === 'error' || kind === 'blocked' || kind === 'needs-permission')
        );
    }

    get isSpeechDetected(): boolean {
        return this.totalEnergy > SPEECH_DETECTED_ENERGY;
    }

    /// Fold one daemon event in.
    apply(event: DaemonEvent): Effects {
        switch (event.kind) {
            case 'recording-state':
                return this.#phaseChanged(
                    'stt',
                    this.stt.apply({ kind: 'recording-flag', isRecording: event.isRecording }),
                );
            case 'transcribing-started':
                return this.#phaseChanged('stt', this.stt.apply({ kind: 'transcribing-started' }));
            case 'transcribing-stopped':
                return this.#phaseChanged('stt', this.stt.apply({ kind: 'transcribing-stopped' }));
            case 'speaking-state':
                return this.#phaseChanged(
                    'tts',
                    this.tts.apply({ kind: 'speaking-flag', isSpeaking: event.isSpeaking }),
                );
            case 'speech-progress':
                return this.#phaseChanged(
                    'tts',
                    this.tts.apply({ kind: 'progress', spokenMs: event.spokenMs }),
                );
            case 'bands':
                // Only the feature in front is drawn; the other's frames are
                // dropped.
                if (event.feature !== this.#front) {
                    return noEffects();
                }
                this.bands = event.bands;
                this.totalEnergy = event.totalEnergy;
                return { ...noEffects(), redraw: true };
            case 'revoked':
                return this.setConnection({ kind: 'error', message: `revoked: ${event.reason}` });
            case 'heartbeat':
            case 'other':
                return noEffects();
        }
    }

    /// The connection changed. Losing it resets both phases: nothing the
    /// daemon said before still holds, and a stale "recording" must not come
    /// back on reconnect.
    setConnection(connection: Connection): Effects {
        const was = this.connection;
        this.connection = connection;
        let effects = noEffects();
        if (connection.kind !== 'connected') {
            this.stt.reset();
            this.tts.reset();
        }
        if (was.kind !== connection.kind || JSON.stringify(was) !== JSON.stringify(connection)) {
            effects.redraw = true;
        }
        effects = merge(effects, this.#syncFront());
        return effects;
    }

    setInstalled(installed: boolean): Effects {
        if (this.installed === installed) {
            return noEffects();
        }
        this.installed = installed;
        return merge({ ...noEffects(), redraw: true }, this.#syncFront());
    }

    /// The alternation timer fired.
    alternateFront(): Effects {
        this.alternate = !this.alternate;
        return this.#syncFront();
    }

    #phaseChanged(
        feature: Feature,
        change: { animationRestarted: boolean; visualizationStale: boolean },
    ): Effects {
        const effects = noEffects();
        effects.redraw = true;
        if (change.animationRestarted && this.#front === feature) {
            effects.resetAnimation = true;
        }
        if (change.visualizationStale && this.shown === feature) {
            this.#clearBars();
            effects.clearBars = true;
        }
        return merge(effects, this.#syncFront());
    }

    /// Put the right feature in front. A change starts the new one clean: no
    /// bars from the other, the animation from its start.
    #syncFront(): Effects {
        const front = pickFront(this.activeFeatures(), this.alternate);
        if (front === this.#front) {
            return noEffects();
        }
        this.#front = front;
        if (front !== null) {
            this.shown = front;
        }
        this.#clearBars();
        return { clearBars: true, resetAnimation: true, frontChanged: true, redraw: true };
    }

    #clearBars(): void {
        this.bands = new Float32Array(NUM_FREQUENCY_BANDS);
        this.totalEnergy = 0;
    }
}
