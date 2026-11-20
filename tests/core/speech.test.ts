// SPDX-License-Identifier: GPL-3.0-only
//! The visualization, drawn from real speech: the frames the engine's
//! analyzer makes of a recording (tools/speech-bands), the bands the daemon
//! sends while someone talks.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Op, Side } from '../../src/core/draw/ops.js';
import { drawVisualization } from '../../src/core/draw/visualizations.js';
import { decodeBands } from '../../src/core/events.js';
import { SPEECH_DETECTED_ENERGY } from '../../src/core/model.js';

const speech = JSON.parse(
    readFileSync(new URL('../fixtures/speech-bands.json', import.meta.url), 'utf8'),
) as { frames: { bands_b64: string; total_energy: number }[] };

/// The frames with someone speaking in them.
const voiced = speech.frames
    .filter((f) => f.total_energy > SPEECH_DETECTED_ENERGY)
    .map((f) => ({ bands: decodeBands(f.bands_b64), totalEnergy: f.total_energy }));

const BOUNDS = { x: 0, y: 0, w: 120, h: 24 };

/// How much bar a half draws: the sum of its bars' heights.
function ink(frame: (typeof voiced)[number], side: Side): number {
    return drawVisualization('centered-equalizer', { bounds: BOUNDS, ...frame, side })
        .filter((op): op is Extract<Op, { kind: 'round-rect' }> => op.kind === 'round-rect')
        .reduce((sum, bar) => sum + bar.h, 0);
}

describe('real speech', () => {
    it('has the daemon’s 64 bands in every frame', () => {
        expect(voiced.length).toBeGreaterThan(100);
        for (const frame of voiced) {
            expect(frame.bands).toHaveLength(64);
        }
    });

    // A voice's energy is mostly below 650 Hz, in bands 0 to 15, which the
    // left half draws; the right half draws 650 Hz to 1.8 kHz.
    it('draws taller on the left half than on the right, most of the time', () => {
        const leftTaller = voiced.filter((frame) => ink(frame, 'left') > ink(frame, 'right'));
        expect(leftTaller.length / voiced.length).toBeGreaterThan(0.6);
    });

    it('fills each half with more than its quietest bars while someone speaks', () => {
        // 19 pills of the 4 px minimum is 76; speech draws well above that.
        const left = voiced.map((frame) => ink(frame, 'left'));
        const mean = left.reduce((a, b) => a + b, 0) / left.length;
        expect(mean).toBeGreaterThan(19 * 4 * 2);
    });
});
