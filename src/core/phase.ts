// SPDX-License-Identifier: GPL-3.0-only
//! What each feature is doing, as the extension tracks it: the port of the
//! applet's `src/models/state.rs`.
//!
//! Each event of a cycle is a separate `/events` topic, and the daemon
//! forwards every topic on its own task, so they arrive in any order. The
//! machines are written to be order-insensitive; the tests drive every
//! interleaving through them.

/// What a transition leaves for the caller to do to the drawing.
export interface PhaseChange {
    /// The animation clock just started: the working animation starts over.
    animationRestarted: boolean;
    /// Live audio stopped, so the bars on screen are stale.
    visualizationStale: boolean;
}

const NO_CHANGE: PhaseChange = Object.freeze({
    animationRestarted: false,
    visualizationStale: false,
});

/// A clock in milliseconds. The shell passes `GLib.get_monotonic_time() / 1000`.
export type Clock = () => number;

export type RecordingState = 'idle' | 'recording' | 'processing';

export type RecordingEvent =
    | { kind: 'recording-flag'; isRecording: boolean }
    | { kind: 'transcribing-started' }
    | { kind: 'transcribing-stopped' };

export type SpeechState = 'idle' | 'synthesizing' | 'speaking';

export type SpeechEvent =
    | { kind: 'speaking-flag'; isSpeaking: boolean }
    | { kind: 'progress'; spokenMs: number };

/// A feature's activity: a phase with live audio, drawn as bars, and a phase
/// of waiting, drawn as the working animation.
export interface Phase {
    readonly hasLiveAudio: boolean;
    readonly isWorking: boolean;
    readonly isActive: boolean;
    /// How long the working animation has run, or `null` when it isn't.
    animationElapsedMs(): number | null;
    /// Back to idle, as after a disconnect: nothing the daemon said before
    /// still holds.
    reset(): void;
}

/// Fold a `recording_state` flag into the state.
///
/// The mic stop and `transcribing_started` race on different topics. When
/// transcribing wins, the extension is already `processing`, and reading the
/// stop as "idle" would cancel the animation for the rest of the cycle. So
/// `processing` stays put, and `transcribing_stopped` is the only way back
/// to idle.
export function withRecordingFlag(state: RecordingState, isRecording: boolean): RecordingState {
    if (isRecording) {
        return 'recording';
    }
    return state === 'idle' ? 'idle' : 'processing';
}

/// Speech to text's cycle: recording, then transcribing.
export class RecordingPhase implements Phase {
    #state: RecordingState = 'idle';
    #animationStart: number | null = null;
    readonly #now: Clock;

    constructor(now: Clock) {
        this.#now = now;
    }

    get state(): RecordingState {
        return this.#state;
    }

    get hasLiveAudio(): boolean {
        return this.#state === 'recording';
    }

    get isWorking(): boolean {
        return this.#state === 'processing';
    }

    get isActive(): boolean {
        return this.hasLiveAudio || this.isWorking;
    }

    animationElapsedMs(): number | null {
        return this.#animationStart === null ? null : this.#now() - this.#animationStart;
    }

    apply(event: RecordingEvent): PhaseChange {
        switch (event.kind) {
            case 'recording-flag': {
                // The mic stopped, so the bars are stale whether or not
                // `transcribing_started` already moved us on.
                const visualizationStale = !event.isRecording && this.#state !== 'idle';
                const change = this.#enter(withRecordingFlag(this.#state, event.isRecording));
                return { ...change, visualizationStale };
            }
            case 'transcribing-started':
                // The mirror of the race above: enter processing mid-cycle,
                // but never bring a finished cycle back.
                if (this.#state === 'idle') {
                    return NO_CHANGE;
                }
                return this.#enter('processing');
            case 'transcribing-stopped':
                return { ...this.#enter('idle'), visualizationStale: true };
        }
    }

    reset(): void {
        this.#enter('idle');
    }

    /// Move to `next`, starting or stopping the clock with it. The clock
    /// survives processing → processing, so a second event landing in the
    /// same phase doesn't restart the animation.
    #enter(next: RecordingState): PhaseChange {
        let animationRestarted = false;
        if (next === 'processing') {
            if (this.#animationStart === null) {
                this.#animationStart = this.#now();
                animationRestarted = true;
            }
        } else {
            this.#animationStart = null;
        }
        this.#state = next;
        return { animationRestarted, visualizationStale: false };
    }
}

/// Text to speech's utterance: synthesizing the first audio, then speaking.
///
/// Three states, not two: an utterance is accepted before any audio exists
/// for it, and a remote backend can leave that gap seconds wide.
/// `synthesizing` is the gap, and `speech_progress` with `spoken_ms > 0` ends
/// it.
export class SpeechPhase implements Phase {
    #state: SpeechState = 'idle';
    #animationStart: number | null = null;
    readonly #now: Clock;

    constructor(now: Clock) {
        this.#now = now;
    }

    get state(): SpeechState {
        return this.#state;
    }

    get hasLiveAudio(): boolean {
        return this.#state === 'speaking';
    }

    get isWorking(): boolean {
        return this.#state === 'synthesizing';
    }

    get isActive(): boolean {
        return this.hasLiveAudio || this.isWorking;
    }

    animationElapsedMs(): number | null {
        return this.#animationStart === null ? null : this.#now() - this.#animationStart;
    }

    /// Progress while idle is ignored: it is a straggler from an utterance
    /// that ended, which must not bring the bars back with nothing to end
    /// them, or the first frame of one whose `speaking_state` is still on its
    /// way, which the next frame repeats.
    apply(event: SpeechEvent): PhaseChange {
        switch (event.kind) {
            case 'speaking-flag':
                if (event.isSpeaking) {
                    return this.#state === 'idle' ? this.#enter('synthesizing') : NO_CHANGE;
                } else {
                    const visualizationStale = this.#state === 'speaking';
                    return { ...this.#enter('idle'), visualizationStale };
                }
            case 'progress':
                if (event.spokenMs > 0 && this.#state === 'synthesizing') {
                    return this.#enter('speaking');
                }
                return NO_CHANGE;
        }
    }

    reset(): void {
        this.#enter('idle');
    }

    #enter(next: SpeechState): PhaseChange {
        let animationRestarted = false;
        if (next === 'synthesizing') {
            if (this.#animationStart === null) {
                this.#animationStart = this.#now();
                animationRestarted = true;
            }
        } else {
            this.#animationStart = null;
        }
        this.#state = next;
        return { animationRestarted, visualizationStale: false };
    }
}
