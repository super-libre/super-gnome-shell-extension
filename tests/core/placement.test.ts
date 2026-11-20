// SPDX-License-Identifier: GPL-3.0-only
import { describe, expect, it } from 'vitest';
import { flankClock, flanksClock } from '../../src/core/placement.js';

describe('around the clock', () => {
    it('puts the left half just before the clock and the right half just after', () => {
        expect(flankClock(['clock'], 'clock', 'L', 'R')).toEqual(['L', 'clock', 'R']);
        expect(flankClock(['a', 'clock', 'b'], 'clock', 'L', 'R')).toEqual([
            'a',
            'L',
            'clock',
            'R',
            'b',
        ]);
    });

    it('brings the halves back beside the clock when something comes between', () => {
        // Another extension slipped an item in on either side of the clock.
        expect(flankClock(['L', 'x', 'clock', 'y', 'R'], 'clock', 'L', 'R')).toEqual([
            'x',
            'L',
            'clock',
            'R',
            'y',
        ]);
    });

    it('follows the clock into a box the halves are not in yet', () => {
        // The clock was moved to the right of the top bar, beside the system
        // menu: the halves join it there.
        expect(flankClock(['clock', 'system'], 'clock', 'L', 'R')).toEqual([
            'L',
            'clock',
            'R',
            'system',
        ]);
    });

    it('keeps the halves together at the end when the box has no clock', () => {
        expect(flankClock(['a', 'L', 'b', 'R'], 'clock', 'L', 'R')).toEqual(['a', 'b', 'L', 'R']);
    });

    it('knows when the halves already flank the clock', () => {
        expect(flanksClock(['a', 'L', 'clock', 'R'], 'clock', 'L', 'R')).toBe(true);
        expect(flanksClock(['L', 'x', 'clock', 'R'], 'clock', 'L', 'R')).toBe(false);
        expect(flanksClock(['R', 'clock', 'L'], 'clock', 'L', 'R')).toBe(false);
        expect(flanksClock(['clock'], 'clock', 'L', 'R')).toBe(false);
    });
});
