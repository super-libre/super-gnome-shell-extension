// SPDX-License-Identifier: GPL-3.0-only
//! The working animations, shown while the daemon transcribes or prepares the
//! first audio: the port of the applet's
//! `src/ui/components/working_animations/` (droplet, comet, dots). Time is the
//! wall clock since the working phase began, so the animation never depends
//! on how often it is drawn.

import type { WorkingAnimation } from '../settings.js';
import { type Bounds, centerOut, logicalSpan, type Op, type Side } from './ops.js';

/// One frame of `kind`. The halves around the clock draw one animation twice
/// their width between them, except the dots, which each half draws whole.
export function drawAnimation(
    kind: WorkingAnimation,
    bounds: Bounds,
    elapsedMs: number,
    side: Side = 'full',
): Op[] {
    switch (kind) {
        case 'droplet':
            return droplet(bounds, elapsedMs, side);
        case 'comet':
            return comet(bounds, elapsedMs, side);
        case 'dots':
            return dots(bounds, elapsedMs);
    }
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
    const u = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1);
    return u * u * (3 - 2 * u);
}

// Droplet: a drop falls on a still line every period, and ripples run out
// from where it lands, fading with distance and time.

export const DROPLET_PERIOD_MS = 1900;
/// How long a ripple takes to swell to full height.
const DROPLET_RAMP_MS = 260;
/// The line's width where the drop lands, and at the far ends.
const LINE_WIDTH = [2.6, 0.7] as const;
const GLOW_WIDTH = [5.0, 1.2] as const;

/// How far the line is displaced at distance `d` from where the drops land:
/// this drop's ripple plus the tail of the last one.
export function dropletOffset(d: number, halfWidth: number, elapsedMs: number, h: number): number {
    if (halfWidth <= 0) {
        return 0;
    }
    const wfull = 2 * halfWidth;
    const c = wfull / 1700;
    const k = (3 * 4 * Math.PI) / wfull;
    const omega = c * k;
    const a0 = h * 0.38;
    const spatial = 2.2 / wfull;
    const tdecay = 0.0026;
    const drop = (age: number) => {
        const la = age - d / c;
        if (la <= 0) {
            return 0;
        }
        return (
            a0 *
            Math.exp(-d * spatial) *
            Math.exp(-la * tdecay) *
            smoothstep(0, DROPLET_RAMP_MS, la) *
            Math.sin(omega * la)
        );
    };
    const ageNow = elapsedMs % DROPLET_PERIOD_MS;
    return drop(ageNow) + drop(ageNow + DROPLET_PERIOD_MS);
}

function taper(widths: readonly [number, number], d: number, halfWidth: number): number {
    const t = Math.min(Math.max(d / halfWidth, 0), 1);
    const [full, thin] = widths;
    return thin + (full - thin) * (1 - t * t);
}

/// The outline of a line of varying width through `samples`, as a polygon:
/// along one side, then back along the other.
function ribbon(
    samples: readonly { x: number; y: number; d: number }[],
    widths: readonly [number, number],
    halfWidth: number,
): number[] {
    const last = samples.length - 1;
    if (last < 0) {
        return [];
    }
    const edge = (i: number, side: number): [number, number] => {
        const p = samples[i];
        const before = samples[Math.max(i - 1, 0)];
        const after = samples[Math.min(i + 1, last)];
        if (!p || !before || !after) {
            return [0, 0];
        }
        const tx = after.x - before.x;
        const ty = after.y - before.y;
        const length = Math.max(Math.hypot(tx, ty), Number.EPSILON);
        const reach = (side * taper(widths, p.d, halfWidth)) / 2;
        return [p.x - (ty / length) * reach, p.y + (tx / length) * reach];
    };
    const points: number[] = [];
    for (let i = 0; i <= last; i++) {
        points.push(...edge(i, 1));
    }
    for (let i = last; i >= 0; i--) {
        points.push(...edge(i, -1));
    }
    return points;
}

/// The drops land at the middle of the picture: at the clock, around it.
function droplet(b: Bounds, elapsedMs: number, side: Side): Op[] {
    const midY = b.y + b.h / 2;
    const span = logicalSpan(side, b.w);
    const halfWidth = span.width / 2;
    const samples: { x: number; y: number; d: number }[] = [];
    let lx = 0;
    for (;;) {
        const d = Math.abs(span.offset + lx - halfWidth);
        samples.push({ x: b.x + lx, y: midY - dropletOffset(d, halfWidth, elapsedMs, b.h), d });
        if (lx >= b.w) {
            break;
        }
        lx = Math.min(lx + 2, b.w);
    }
    const ops: Op[] = [
        { kind: 'polygon', points: ribbon(samples, GLOW_WIDTH, halfWidth), paint: centerOut(0.25) },
        { kind: 'polygon', points: ribbon(samples, LINE_WIDTH, halfWidth), paint: centerOut(1) },
    ];
    // The splash where the drop lands, gone within 180 ms.
    const impact = Math.max(1 - (elapsedMs % DROPLET_PERIOD_MS) / 180, 0);
    if (impact > 0) {
        ops.push({
            kind: 'circle',
            cx: b.x + (halfWidth - span.offset),
            cy: midY,
            r: 2.4 + 3 * impact,
            paint: centerOut(0.8 * impact),
        });
    }
    return ops;
}

// Comet: a bright head with a fading tail runs along a faint sine guide.

/// How fast the head moves.
export const COMET_SPEED_PX_PER_MS = 0.11;
const COMET_TAIL = 44;

/// Around the clock, the head crosses the left half, then the right.
function comet(b: Bounds, elapsedMs: number, side: Side): Op[] {
    if (b.w <= 0) {
        return [];
    }
    const midY = b.y + b.h / 2;
    const amplitude = 0.3 * b.h;
    const span = logicalSpan(side, b.w);
    const k = (2 * Math.PI * 1.8) / span.width;
    // `lx` is along the whole picture, of which this canvas shows
    // [offset, offset + w].
    const pathY = (lx: number) => midY + amplitude * Math.sin(lx * k);

    const guide: number[] = [];
    for (let l = 0; l <= b.w; l += 3) {
        guide.push(b.x + l, pathY(span.offset + l));
    }
    const ops: Op[] = [
        {
            kind: 'polyline',
            points: guide,
            width: 1.4,
            cap: 'butt',
            join: 'miter',
            paint: centerOut(0.18),
        },
    ];

    // The head enters 20 px before the left edge and leaves 20 px past the
    // right one.
    const head = ((elapsedMs * COMET_SPEED_PX_PER_MS) % (span.width + 40)) - 20;
    // Tail first, so the head is painted last, on top.
    for (let i = COMET_TAIL; i >= 0; i--) {
        const lx = head - 3 * i;
        if (lx < span.offset || lx > span.offset + b.w) {
            continue;
        }
        const x = b.x + lx - span.offset;
        const y = pathY(lx);
        const a = 1 - i / COMET_TAIL;
        if (i === 0) {
            ops.push({ kind: 'circle', cx: x, cy: y, r: 7, paint: centerOut(0.3) });
        }
        ops.push({
            kind: 'circle',
            cx: x,
            cy: y,
            r: i === 0 ? 4 : 2 * a + 0.6,
            paint: centerOut(a * a * 0.9),
        });
    }
    return ops;
}

// Dots: three dots swell and fade in turn.

function dots(b: Bounds, elapsedMs: number): Op[] {
    if (b.w <= 0) {
        return [];
    }
    const cy = b.y + b.h / 2;
    const gap = Math.min(0.085 * b.w, 28);
    const r = Math.min(0.18 * b.h, 7);
    const cx = b.x + b.w / 2 - gap;
    const ops: Op[] = [];
    for (let i = 0; i < 3; i++) {
        const s = 0.45 * Math.sin(elapsedMs * 0.004 - 0.6 * i) + 0.55;
        const alpha = 0.7 * s + 0.3;
        const radius = r * (0.5 * s + 0.7);
        const x = cx + i * gap;
        ops.push({ kind: 'circle', cx: x, cy, r: radius + 2, paint: centerOut(alpha * 0.3) });
        ops.push({ kind: 'circle', cx: x, cy, r: radius, paint: centerOut(alpha) });
    }
    return ops;
}
