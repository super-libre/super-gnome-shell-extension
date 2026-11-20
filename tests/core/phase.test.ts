// SPDX-License-Identifier: GPL-3.0-only
//! The applet's state-machine tests (`src/models/state.rs`), ported.
import { describe, expect, it } from 'vitest';
import {
    type RecordingEvent,
    RecordingPhase,
    type RecordingState,
    SpeechPhase,
    withRecordingFlag,
} from '../../src/core/phase.js';

/// A clock the test moves by hand.
function clock() {
    let now = 1_000;
    const fn = () => now;
    fn.advance = (ms: number) => {
        now += ms;
    };
    return fn;
}

const MIC_START: RecordingEvent = { kind: 'recording-flag', isRecording: true };
const MIC_STOP: RecordingEvent = { kind: 'recording-flag', isRecording: false };
const STARTED: RecordingEvent = { kind: 'transcribing-started' };
const STOPPED: RecordingEvent = { kind: 'transcribing-stopped' };

function permutations<T>(items: T[]): T[][] {
    if (items.length <= 1) {
        return [items];
    }
    return items.flatMap((item, i) =>
        permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest]),
    );
}

describe('the recording flag', () => {
    it('always enters recording when the mic starts', () => {
        for (const state of ['idle', 'recording', 'processing'] as RecordingState[]) {
            expect(withRecordingFlag(state, true)).toBe('recording');
        }
    });

    it('moves from recording to processing when the mic stops', () => {
        expect(withRecordingFlag('recording', false)).toBe('processing');
    });

    it('stays in processing when the mic stop loses the race to transcribing', () => {
        expect(withRecordingFlag('processing', false)).toBe('processing');
    });

    it('stays idle on a stray mic stop', () => {
        expect(withRecordingFlag('idle', false)).toBe('idle');
    });
});

describe('the recording phase', () => {
    function recording(now = clock()) {
        const phase = new RecordingPhase(now);
        const change = phase.apply(MIC_START);
        expect(phase.hasLiveAudio).toBe(true);
        expect(change.animationRestarted).toBe(false);
        return phase;
    }

    it('animates transcribing whichever way the mic-stop race falls', () => {
        for (const order of permutations([MIC_STOP, STARTED])) {
            const phase = recording();
            let restarts = 0;
            for (const event of order) {
                restarts += phase.apply(event).animationRestarted ? 1 : 0;
            }
            expect(phase.isWorking).toBe(true);
            expect(phase.hasLiveAudio).toBe(false);
            expect(phase.animationElapsedMs()).not.toBeNull();
            expect(restarts).toBe(1);
        }
    });

    it('ends every interleaving of a cycle idle', () => {
        for (const order of permutations([MIC_STOP, STARTED, STOPPED])) {
            const phase = recording();
            for (const event of order) {
                phase.apply(event);
            }
            expect(phase.isWorking, JSON.stringify(order)).toBe(false);
            expect(phase.hasLiveAudio, JSON.stringify(order)).toBe(false);
            expect(phase.animationElapsedMs()).toBeNull();
        }
    });

    it('clears the bars in every interleaving', () => {
        for (const order of permutations([MIC_STOP, STARTED, STOPPED])) {
            const phase = recording();
            const cleared = order.some((event) => phase.apply(event).visualizationStale);
            expect(cleared, JSON.stringify(order)).toBe(true);
        }
    });

    it('ignores a late transcribing_started', () => {
        const phase = recording();
        phase.apply(MIC_STOP);
        phase.apply(STOPPED);
        const change = phase.apply(STARTED);
        expect(phase.isWorking).toBe(false);
        expect(change.animationRestarted).toBe(false);
        expect(phase.animationElapsedMs()).toBeNull();
    });

    it('closes a silent take, which the daemon never transcribes', () => {
        const phase = recording();
        expect(phase.apply(MIC_STOP).visualizationStale).toBe(true);
        expect(phase.isWorking).toBe(true);
        phase.apply(STOPPED);
        expect(phase.isWorking).toBe(false);
        expect(phase.animationElapsedMs()).toBeNull();
    });

    it('restarts the animation each cycle', () => {
        const now = clock();
        const phase = recording(now);
        phase.apply(MIC_STOP);
        now.advance(500);
        expect(phase.animationElapsedMs()).toBe(500);
        phase.apply(STOPPED);
        phase.apply(MIC_START);
        expect(phase.apply(MIC_STOP).animationRestarted).toBe(true);
        expect(phase.animationElapsedMs()).toBe(0);
    });

    it('changes nothing on a stray mic stop while idle', () => {
        const phase = new RecordingPhase(clock());
        const change = phase.apply(MIC_STOP);
        expect(phase.isActive).toBe(false);
        expect(change).toEqual({ animationRestarted: false, visualizationStale: false });
    });

    it('goes idle on reset, with no clock running', () => {
        const phase = recording();
        phase.apply(MIC_STOP);
        phase.reset();
        expect(phase.state).toBe('idle');
        expect(phase.animationElapsedMs()).toBeNull();
    });
});

describe('the speech phase', () => {
    const START = { kind: 'speaking-flag', isSpeaking: true } as const;
    const END = { kind: 'speaking-flag', isSpeaking: false } as const;
    const progress = (spokenMs: number) => ({ kind: 'progress', spokenMs }) as const;

    it('waits for audio before the bars', () => {
        const phase = new SpeechPhase(clock());
        const change = phase.apply(START);
        expect(phase.isWorking).toBe(true);
        expect(change.animationRestarted).toBe(true);
        expect(phase.animationElapsedMs()).not.toBeNull();

        phase.apply(progress(0));
        expect(phase.isWorking).toBe(true);

        phase.apply(progress(120));
        expect(phase.hasLiveAudio).toBe(true);
        expect(phase.animationElapsedMs()).toBeNull();
    });

    it('returns to idle from either phase, clearing the bars only after speech', () => {
        for (const wasSpeaking of [false, true]) {
            const phase = new SpeechPhase(clock());
            phase.apply(START);
            if (wasSpeaking) {
                phase.apply(progress(50));
            }
            const change = phase.apply(END);
            expect(phase.isActive).toBe(false);
            expect(phase.animationElapsedMs()).toBeNull();
            expect(change.visualizationStale).toBe(wasSpeaking);
        }
    });

    it("doesn't bring an utterance back on a straggling progress frame", () => {
        const phase = new SpeechPhase(clock());
        phase.apply(START);
        phase.apply(progress(10));
        phase.apply(END);
        phase.apply(progress(20));
        expect(phase.isActive).toBe(false);
    });

    it("doesn't restart the animation on a repeated start", () => {
        const phase = new SpeechPhase(clock());
        phase.apply(START);
        const change = phase.apply(START);
        expect(change.animationRestarted).toBe(false);
        expect(phase.isWorking).toBe(true);
    });

    it('ignores progress while idle', () => {
        const phase = new SpeechPhase(clock());
        const change = phase.apply(progress(100));
        expect(phase.isActive).toBe(false);
        expect(change).toEqual({ animationRestarted: false, visualizationStale: false });
    });
});
