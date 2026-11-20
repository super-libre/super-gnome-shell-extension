// SPDX-License-Identifier: GPL-3.0-only
//! The geometry each visualization and animation draws.
import { describe, expect, it } from 'vitest';
import {
    COMET_SPEED_PX_PER_MS,
    DROPLET_PERIOD_MS,
    drawAnimation,
    dropletOffset,
} from '../../src/core/draw/animations.js';
import { logicalSpan, type Op, type Side } from '../../src/core/draw/ops.js';
import {
    barLevel,
    drawVisualization,
    sampleCurve,
    visibleBandRange,
    waveformControlPoints,
} from '../../src/core/draw/visualizations.js';
import { VISUALIZATION_STYLES, WORKING_ANIMATIONS } from '../../src/core/settings.js';

const BOUNDS = { x: 0, y: 0, w: 120, h: 24 };
const SIDES: Side[] = ['full', 'left', 'right'];
const silent = new Float32Array(64);
const loud = new Float32Array(64).fill(3);

function rects(ops: Op[]) {
    return ops.filter((op) => op.kind === 'round-rect');
}

describe('bars', () => {
    it('draws one bar every 6.25 px, 80% bar and 20% gap', () => {
        // The centered bars use the full width: 160 / 6.25 = 25.6 → 26 bars.
        const ops = rects(
            drawVisualization('centered-equalizer', {
                bounds: { x: 0, y: 0, w: 160, h: 40 },
                bands: loud,
                totalEnergy: 0,
                side: 'full',
            }),
        );
        expect(ops).toHaveLength(26);
        expect(ops[0]?.w).toBeCloseTo((160 / 26) * 0.8);
        expect((ops[1]?.x ?? 0) - (ops[0]?.x ?? 0)).toBeCloseTo(160 / 26);
    });

    it('holds a minimum height when silent and fills the height when loud', () => {
        const quiet = rects(
            drawVisualization('bottom-equalizer', {
                bounds: BOUNDS,
                bands: silent,
                totalEnergy: 0,
                side: 'full',
            }),
        );
        // min(h/4, 4) of the 23 px inside the margins.
        for (const bar of quiet) {
            expect(bar.h).toBeCloseTo(4);
            expect(bar.y + bar.h).toBeCloseTo(24);
        }
        const full = rects(
            drawVisualization('bottom-equalizer', {
                bounds: BOUNDS,
                bands: loud,
                totalEnergy: 0,
                side: 'full',
            }),
        );
        for (const bar of full) {
            expect(bar.h).toBeCloseTo(23);
        }
    });

    it('centers the centered bars and rounds them into pills', () => {
        const ops = rects(
            drawVisualization('centered-equalizer', {
                bounds: BOUNDS,
                bands: silent,
                totalEnergy: 0,
                side: 'full',
            }),
        );
        for (const bar of ops) {
            expect(bar.y + bar.h / 2).toBeCloseTo(12);
            expect(bar.r).toBeCloseTo(Math.min(bar.w / 2, bar.h / 2));
        }
    });

    it('interpolates bands at each bar center', () => {
        const bands = [0, 1, 2, 3];
        expect(barLevel(bands, 4, 0, 4)).toBe(0);
        expect(barLevel(bands, 4, 3, 4)).toBe(3);
        expect(barLevel(bands, 4, 0, 2)).toBeCloseTo(0.5);
        expect(barLevel(bands, 4, 1, 2)).toBeCloseTo(2.5);
    });

    it('draws nothing without bands', () => {
        expect(
            drawVisualization('bottom-equalizer', {
                bounds: BOUNDS,
                bands: new Float32Array(0),
                totalEnergy: 0,
                side: 'full',
            }),
        ).toEqual([]);
    });
});

describe('pulse', () => {
    it('grows a pill with the voice band, falling back to the total energy', () => {
        const [quiet] = rects(
            drawVisualization('pulse', {
                bounds: BOUNDS,
                bands: silent,
                totalEnergy: 0,
                side: 'full',
            }),
        );
        expect(quiet?.h).toBe(2);
        const [full] = rects(
            drawVisualization('pulse', {
                bounds: BOUNDS,
                bands: loud,
                totalEnergy: 0,
                side: 'full',
            }),
        );
        expect(full?.h).toBeCloseTo(20 * 0.8);
        const [fallback] = rects(
            drawVisualization('pulse', {
                bounds: BOUNDS,
                bands: new Float32Array(4),
                totalEnergy: 3,
                side: 'full',
            }),
        );
        expect(fallback?.h).toBeCloseTo(20 * 0.8);
    });
});

describe('waveform', () => {
    it('pads the curve to zero past both edges and smooths it', () => {
        const points = waveformControlPoints([3, 3], 'full', 10);
        expect(points[0]).toEqual([-0.1, 0]);
        expect(points.at(-1)).toEqual([1.1, 0]);
        expect(points[1]?.[0]).toBe(0.25);
        expect(points[2]?.[0]).toBe(0.75);
        // Smoothing pulls the peak down toward the padded zeros.
        expect(points[1]?.[1]).toBeLessThan(10);
        expect(points[1]?.[1]).toBeGreaterThan(0);
    });

    it('samples one point per pixel across the full width, inside the height', () => {
        const eb = { x: 0, y: 1, w: 120, h: 22 };
        const curve = sampleCurve(waveformControlPoints(loud, 'full', 22), eb);
        expect(curve).toHaveLength(121);
        expect(curve[0]?.[0]).toBe(0);
        expect(curve.at(-1)?.[0]).toBe(120);
        for (const [, y] of curve) {
            expect(y).toBeGreaterThanOrEqual(1);
            expect(y).toBeLessThanOrEqual(23);
        }
    });

    it('fills faintly below the curve and strokes it on top', () => {
        const ops = drawVisualization('waveform', {
            bounds: BOUNDS,
            bands: loud,
            totalEnergy: 0,
            side: 'full',
        });
        expect(ops.map((op) => op.kind)).toEqual(['polygon', 'polyline']);
        expect(ops[0]?.paint.alpha).toBe(0.3);
    });
});

describe('animations', () => {
    it('draws every style at every moment without NaNs', () => {
        for (const { id } of WORKING_ANIMATIONS) {
            for (const t of [0, 16, 500, 1899, 1900, 12_345]) {
                const ops = drawAnimation(id, BOUNDS, t);
                expect(ops.length).toBeGreaterThan(0);
                expect(JSON.stringify(ops)).not.toContain('null');
            }
        }
        for (const { id } of VISUALIZATION_STYLES) {
            const ops = drawVisualization(id, {
                bounds: BOUNDS,
                bands: loud,
                totalEnergy: 1,
                side: 'full',
            });
            expect(JSON.stringify(ops)).not.toContain('null');
        }
    });

    it('drops a droplet once a period', () => {
        // The ripple of the drop before is still running out as the next lands.
        expect(dropletOffset(30, 60, 0, 24)).not.toBe(0);
        expect(dropletOffset(0, 60, 100, 24)).not.toBe(0);
        expect(dropletOffset(0, 60, 100, 24)).toBeCloseTo(
            dropletOffset(0, 60, 100 + DROPLET_PERIOD_MS, 24),
        );
    });

    it('splashes only just after the drop lands', () => {
        const circles = (t: number) =>
            drawAnimation('droplet', BOUNDS, t).filter((op) => op.kind === 'circle');
        expect(circles(0)).toHaveLength(1);
        expect(circles(400)).toHaveLength(0);
    });

    it('keeps the comet inside the canvas', () => {
        for (const t of [0, 300, 900, 1500]) {
            for (const op of drawAnimation('comet', BOUNDS, t)) {
                if (op.kind === 'circle') {
                    expect(op.cx).toBeGreaterThanOrEqual(0);
                    expect(op.cx).toBeLessThanOrEqual(120);
                }
            }
        }
    });

    it('draws three dots, each with a glow', () => {
        expect(drawAnimation('dots', BOUNDS, 0)).toHaveLength(6);
    });
});

// The halves around the clock: the applet's side tests, ported.

describe('halves', () => {
    it('lay the picture over twice their width, the right half starting at its middle', () => {
        expect(logicalSpan('full', 100)).toEqual({ width: 100, offset: 0 });
        expect(logicalSpan('left', 100)).toEqual({ width: 200, offset: 0 });
        expect(logicalSpan('right', 100)).toEqual({ width: 200, offset: 100 });
    });

    it('split the spectrum in half, the low bands left of the clock', () => {
        expect(visibleBandRange('full', 64)).toEqual({ count: 32, start: 0 });
        expect(visibleBandRange('left', 64)).toEqual({ count: 16, start: 0 });
        expect(visibleBandRange('right', 64)).toEqual({ count: 16, start: 16 });
        expect(visibleBandRange('left', 10)).toEqual({ count: 5, start: 0 });
        expect(visibleBandRange('right', 0)).toEqual({ count: 0, start: 0 });
    });

    it('draw each half of the bars from its own bands', () => {
        // Loud low bands, silent high ones: the left half is loud, the right
        // half silent.
        const bands = new Float32Array(64);
        bands.fill(3, 0, 16);
        const height = (side: Side) =>
            Math.max(
                ...rects(
                    drawVisualization('centered-equalizer', {
                        bounds: BOUNDS,
                        bands,
                        totalEnergy: 0,
                        side,
                    }),
                ).map((r) => r.h),
            );
        expect(height('left')).toBeCloseTo(22);
        expect(height('right')).toBeCloseTo(4);
    });

    it('pad only their outer edge of the waveform, so it meets itself at the clock', () => {
        const bands = new Float32Array(64).fill(3);
        const full = waveformControlPoints(bands, 'full', 40);
        expect(full[0]?.[0]).toBe(-0.1);
        expect(full.at(-1)?.[0]).toBe(1.1);

        const left = waveformControlPoints(bands, 'left', 40);
        expect(left[0]?.[0]).toBe(-0.1);
        expect(left.at(-1)?.[0]).toBe(1.0);
        expect(left.at(-1)?.[1]).toBeGreaterThan(0);

        const right = waveformControlPoints(bands, 'right', 40);
        expect(right[0]?.[0]).toBe(0.0);
        expect(right[0]?.[1]).toBeGreaterThan(0);
        expect(right.at(-1)?.[0]).toBe(1.1);
    });

    it('meet at the same height on either side of the clock', () => {
        const hump = new Float32Array(64);
        for (let i = 0; i < 32; i++) {
            hump[i] = 3 * Math.sin((Math.PI * i) / 31);
        }
        for (const bands of [new Float32Array(64).fill(1.5), hump]) {
            const edge = (side: Side) => {
                const [fill] = drawVisualization('waveform', {
                    bounds: { x: 0, y: 0, w: 160, h: 40 },
                    bands,
                    totalEnergy: 0,
                    side,
                });
                const points = fill?.kind === 'polygon' ? fill.points : [];
                // The curve, without the fill's two baseline corners.
                const curve = points.slice(2, -2);
                return side === 'left' ? (curve.at(-1) ?? 0) : (curve[1] ?? 0);
            };
            expect(Math.abs(edge('left') - edge('right'))).toBeLessThanOrEqual(2);
        }
    });

    it('mirror the droplet across the clock, which the drops land on', () => {
        for (const t of [20, 400, 1100]) {
            const [, leftLine] = drawAnimation('droplet', BOUNDS, t, 'left');
            const [, rightLine] = drawAnimation('droplet', BOUNDS, t, 'right');
            const ys = (op: Op | undefined) => (op?.kind === 'polygon' ? op.points : []);
            // Every point of the left half's ribbon has its mirror image in
            // the right half's.
            const left = ys(leftLine);
            const right = ys(rightLine);
            expect(left).toHaveLength(right.length);
            for (let i = 0; i < left.length; i += 2) {
                const mx = 120 - (left[i] ?? 0);
                const y = left[i + 1] ?? 0;
                let nearest = Number.POSITIVE_INFINITY;
                for (let j = 0; j < right.length; j += 2) {
                    nearest = Math.min(
                        nearest,
                        Math.hypot((right[j] ?? 0) - mx, (right[j + 1] ?? 0) - y),
                    );
                }
                expect(nearest).toBeLessThan(1e-6);
            }
        }
        // The splash is at the clock: the left half's right edge, the right
        // half's left edge.
        const splash = (side: Side) =>
            drawAnimation('droplet', BOUNDS, 20, side).find((op) => op.kind === 'circle');
        expect(splash('left')).toMatchObject({ cx: 120 });
        expect(splash('right')).toMatchObject({ cx: 0 });
    });

    it('carry the comet from the left half across the clock into the right', () => {
        const head = (side: Side, t: number) => {
            const circles = drawAnimation('comet', BOUNDS, t, side).filter(
                (op) => op.kind === 'circle',
            );
            // The head is the last circle painted, radius 4.
            const last = circles.at(-1);
            return last?.kind === 'circle' && last.r === 4 ? last.cx : null;
        };
        // When the head is 100 px into the 240 px picture, it is in the left
        // half; at 180 px, 60 px into the right one.
        const at = (x: number) => (x + 20) / COMET_SPEED_PX_PER_MS;
        expect(head('left', at(100))).toBeCloseTo(100);
        expect(head('right', at(100))).toBeNull();
        expect(head('right', at(180))).toBeCloseTo(60);
        expect(head('left', at(180))).toBeNull();
    });

    it('draw the dots whole on every side', () => {
        for (const t of [0, 700]) {
            const full = drawAnimation('dots', BOUNDS, t, 'full');
            for (const side of SIDES) {
                expect(drawAnimation('dots', BOUNDS, t, side)).toEqual(full);
            }
        }
    });

    it('draw the pulse whole on every side', () => {
        const frame = { bounds: BOUNDS, bands: new Float32Array(64).fill(2), totalEnergy: 0 };
        const full = drawVisualization('pulse', { ...frame, side: 'full' });
        expect(drawVisualization('pulse', { ...frame, side: 'left' })).toEqual(full);
        expect(drawVisualization('pulse', { ...frame, side: 'right' })).toEqual(full);
    });

    it('draw every style and animation without NaNs on every side', () => {
        for (const side of SIDES) {
            for (const { id } of WORKING_ANIMATIONS) {
                expect(JSON.stringify(drawAnimation(id, BOUNDS, 777, side))).not.toContain('null');
            }
            for (const { id } of VISUALIZATION_STYLES) {
                const ops = drawVisualization(id, {
                    bounds: BOUNDS,
                    bands: loud,
                    totalEnergy: 1,
                    side,
                });
                expect(ops.length).toBeGreaterThan(0);
                expect(JSON.stringify(ops)).not.toContain('null');
            }
        }
    });
});
