// SPDX-License-Identifier: GPL-3.0-only
//! Which feature is in front, and what the panel owes each change.
import { describe, expect, it } from 'vitest';
import type { DaemonEvent } from '../../src/core/events.js';
import { contentSize, iconOffset, iconSize } from '../../src/core/layout.js';
import { Model, NUM_FREQUENCY_BANDS, pickFront } from '../../src/core/model.js';
import { statusText } from '../../src/core/status.js';

function connected(): Model {
    const model = new Model(() => 0);
    model.setInstalled(true);
    model.setConnection({ kind: 'connected' });
    return model;
}

const RECORD: DaemonEvent = { kind: 'recording-state', isRecording: true };
const SPEAK: DaemonEvent = { kind: 'speaking-state', isSpeaking: true };
const PROGRESS: DaemonEvent = { kind: 'speech-progress', spokenMs: 10 };
const bands = (feature: 'stt' | 'tts', level = 1): DaemonEvent => ({
    kind: 'bands',
    feature,
    bands: new Float32Array([level, level]),
    totalEnergy: level,
});

describe('front selection', () => {
    it('picks the only active feature, or the one the alternation points at', () => {
        expect(pickFront([], false)).toBeNull();
        expect(pickFront(['tts'], false)).toBe('tts');
        expect(pickFront(['stt', 'tts'], false)).toBe('stt');
        expect(pickFront(['stt', 'tts'], true)).toBe('tts');
    });
});

describe('the model', () => {
    it('puts a feature in front when it becomes active, and starts it clean', () => {
        const model = connected();
        const effects = model.apply(RECORD);
        expect(model.front).toBe('stt');
        expect(effects).toMatchObject({ frontChanged: true, clearBars: true, redraw: true });
    });

    it("draws only the front feature's bands", () => {
        const model = connected();
        model.apply(RECORD);
        expect(model.apply(bands('tts')).redraw).toBe(false);
        expect(model.apply(bands('stt', 2)).redraw).toBe(true);
        expect(Array.from(model.bands)).toEqual([2, 2]);
        expect(model.isSpeechDetected).toBe(true);
    });

    it('alternates while both are active, switching colors and clearing bars', () => {
        const model = connected();
        model.apply(RECORD);
        model.apply(SPEAK);
        model.apply(PROGRESS);
        expect(model.bothActive).toBe(true);
        expect(model.front).toBe('stt');
        model.apply(bands('stt'));

        const effects = model.alternateFront();
        expect(model.front).toBe('tts');
        expect(model.shown).toBe('tts');
        expect(effects).toMatchObject({
            frontChanged: true,
            clearBars: true,
            resetAnimation: true,
        });
        expect(model.bands).toHaveLength(NUM_FREQUENCY_BANDS);
        expect(Array.from(model.bands).every((b) => b === 0)).toBe(true);
    });

    it('keeps the last colors when nothing is active', () => {
        const model = connected();
        model.apply(SPEAK);
        model.apply({ kind: 'speaking-state', isSpeaking: false });
        expect(model.front).toBeNull();
        expect(model.shown).toBe('tts');
    });

    it('counts nothing as active until connected, and resets on a lost connection', () => {
        const model = new Model(() => 0);
        model.setInstalled(true);
        model.apply(RECORD);
        expect(model.front).toBeNull();

        model.setConnection({ kind: 'connected' });
        model.apply(RECORD);
        expect(model.front).toBe('stt');

        model.setConnection({ kind: 'connecting' });
        expect(model.front).toBeNull();
        model.setConnection({ kind: 'connected' });
        expect(model.front).toBeNull();
        expect(model.stt.state).toBe('idle');
    });

    it('turns a revocation into an error the panel flags', () => {
        const model = connected();
        model.apply({ kind: 'revoked', reason: 'exe_changed' });
        expect(model.connection).toEqual({ kind: 'error', message: 'revoked: exe_changed' });
        expect(model.needsAttention).toBe(true);
    });

    it('resets the animation only for the feature in front', () => {
        const model = connected();
        model.apply(RECORD);
        model.apply(SPEAK); // synthesizing: tts is active, stt stays in front
        const effects = model.apply({ kind: 'transcribing-started' });
        expect(model.front).toBe('stt');
        expect(effects.resetAnimation).toBe(true);
    });
});

describe('status', () => {
    it('says nothing while connected', () => {
        expect(statusText(true, { kind: 'connected' })).toBeNull();
    });

    it("tells the user the daemon isn't installed", () => {
        expect(statusText(false, { kind: 'connecting' })?.title).toBe(
            'Super Voice is not installed.',
        );
    });

    it('explains a denial and offers to ask again', () => {
        const status = statusText(true, { kind: 'blocked', reason: 'user_denied' });
        expect(status).toEqual({
            title: 'Super Voice: authorization denied',
            details: [
                'Reason: user_denied',
                'Restart the daemon to clear the denial:',
                '  systemctl --user restart super-voice',
                'Then ask for authorization again.',
            ],
            canRetryAuthorization: true,
        });
    });

    it('explains a permission prompt that could not be shown', () => {
        expect(
            statusText(true, { kind: 'needs-permission', reason: 'popup_failed' })?.details[0],
        ).toBe("Super Voice couldn't show its permission request.");
    });
});

describe('layout', () => {
    it('is as long as the setting while visualizations show, else square', () => {
        expect(contentSize(24, true, 120)).toEqual({ width: 120, height: 24 });
        expect(contentSize(24, false, 120)).toEqual({ width: 24, height: 24 });
        expect(contentSize(24, true, 10)).toEqual({ width: 60, height: 24 });
        expect(contentSize(500, true, 999)).toEqual({ width: 300, height: 108 });
    });

    it('sizes the icon at 60% of the short side, between 16 and 32', () => {
        expect(iconSize({ width: 120, height: 24 })).toBe(16);
        expect(iconSize({ width: 120, height: 40 })).toBe(24);
        expect(iconSize({ width: 120, height: 100 })).toBe(32);
    });

    it('aligns the icon along the box', () => {
        expect(iconOffset('start', 120, 16)).toBe(0);
        expect(iconOffset('center', 120, 16)).toBe(52);
        expect(iconOffset('end', 120, 16)).toBe(104);
        expect(iconOffset('end', 10, 16)).toBe(0);
    });
});
