// SPDX-License-Identifier: GPL-3.0-only
//! The four visualizations of live audio: the port of the applet's
//! `src/ui/components/visualizations/` (pulse, equalizer, centered bars and
//! waveform). Each draws the latest bands as they are, with no smoothing or
//! decay of its own: a frame comes with each `frequency_bands` event.

import type { VisualizationStyle } from '../settings.js';
import { type Bounds, bottomToTop, centerOut, cornerRadius, type Op, type Side } from './ops.js';

/// The daemon's band energies are divided by this to fill a bar.
export const FREQUENCY_NORMALIZATION_MAX = 3.0;

/// The most bands a visualization reads: the low half of the daemon's 64,
/// where speech is.
export const MAX_VISUALIZATION_BANDS = 32;

/// One bar and its gap every this many pixels.
export const BAR_PITCH = 300 / 48;

interface Margins {
    top: number;
    right: number;
    bottom: number;
    left: number;
}

interface Config {
    margins: Margins;
    cornerRadius: number;
    minElementHeight: number;
    heightSafetyMargin: number;
}

const EQUALIZER: Config = {
    margins: { top: 1, right: 2, bottom: 0, left: 2 },
    cornerRadius: 1,
    minElementHeight: 4,
    heightSafetyMargin: 0,
};

const CENTERED_BARS: Config = {
    margins: { top: 1, right: 0, bottom: 1, left: 0 },
    // A pill: the radius is clamped to half the bar's width.
    cornerRadius: 24,
    minElementHeight: 4,
    heightSafetyMargin: 0,
};

const PULSE_MARGINS: Margins = { top: 2, right: 2, bottom: 2, left: 2 };

const WAVEFORM_MARGINS: Margins = { top: 1, right: 0, bottom: 1, left: 0 };

/// Neighbor-averaging passes over the waveform's control points.
export const WAVEFORM_SMOOTHING_PASSES = 4;
export const WAVEFORM_STROKE_WIDTH = 1.5;
export const WAVEFORM_FILL_OPACITY = 0.3;

/// What a visualization draws from.
export interface Frame {
    bounds: Bounds;
    bands: ArrayLike<number>;
    totalEnergy: number;
    /// Which half of the spectrum this canvas draws: see [`visibleBandRange`].
    side: Side;
}

export function drawVisualization(style: VisualizationStyle, frame: Frame): Op[] {
    switch (style) {
        case 'pulse':
            return pulse(frame);
        case 'bottom-equalizer':
            return bars(frame, EQUALIZER, 'bottom');
        case 'centered-equalizer':
            return bars(frame, CENTERED_BARS, 'center');
        case 'waveform':
            return waveform(frame);
    }
}

function inset(b: Bounds, m: Margins): Bounds {
    return {
        x: b.x + m.left,
        y: b.y + m.top,
        w: b.w - (m.left + m.right),
        h: b.h - (m.top + m.bottom),
    };
}

function maxHeight(config: Config, h: number): number {
    return Math.max(h - config.heightSafetyMargin, 1);
}

function minHeight(config: Config, h: number): number {
    return Math.max(Math.min(h / 4, config.minElementHeight), 1);
}

/// Between the minimum and maximum height; the maximum wins.
function clampHeight(config: Config, desired: number, h: number): number {
    return Math.min(Math.max(desired, minHeight(config, h)), maxHeight(config, h));
}

/// The bands a side reads, of `length`: all of them (up to
/// [`MAX_VISUALIZATION_BANDS`]) for a full picture, the low half for the left
/// half, the high half for the right, so the two halves join into one
/// spectrum at the clock.
export function visibleBandRange(side: Side, length: number): { count: number; start: number } {
    const total = Math.min(length, MAX_VISUALIZATION_BANDS);
    const half = Math.floor(total / 2);
    switch (side) {
        case 'full':
            return { count: total, start: 0 };
        case 'left':
            return { count: half, start: 0 };
        case 'right':
            return { count: half, start: half };
    }
}

/// The level bar `i` of `n` shows: the bands linearly interpolated at its
/// center, so any bar count samples the same spectrum.
export function barLevel(bands: ArrayLike<number>, count: number, i: number, n: number): number {
    const at = Math.min(Math.max(((i + 0.5) * count) / n - 0.5, 0), count - 1);
    const lo = Math.floor(at);
    const hi = Math.min(lo + 1, count - 1);
    const t = at - lo;
    return (bands[lo] ?? 0) * (1 - t) + (bands[hi] ?? 0) * t;
}

/// The equalizer (bars from the bottom) and centered bars (pills about the
/// middle): one bar every [`BAR_PITCH`] pixels, 80% bar and 20% gap.
function bars(frame: Frame, config: Config, anchor: 'bottom' | 'center'): Op[] {
    const { count, start } = visibleBandRange(frame.side, frame.bands.length);
    if (count === 0) {
        return [];
    }
    const bands = Array.from(frame.bands).slice(start, start + count);
    const eb = inset(frame.bounds, config.margins);
    const n = Math.max(1, Math.trunc(Math.round(eb.w / BAR_PITCH)));
    const barWidth = (eb.w / n) * 0.8;
    const spacing = (eb.w / n) * 0.2;
    const x0 = eb.x + (eb.w - (barWidth * n + spacing * (n - 1))) / 2;
    const paint = anchor === 'bottom' ? bottomToTop() : centerOut();
    const ops: Op[] = [];
    for (let i = 0; i < n; i++) {
        const amp = barLevel(bands, count, i, n);
        const level = Math.min(amp / FREQUENCY_NORMALIZATION_MAX, 1);
        const h = clampHeight(config, maxHeight(config, eb.h) * level, eb.h);
        const y = anchor === 'bottom' ? eb.y + eb.h - h : eb.y + (eb.h - h) / 2;
        const x = x0 + i * (barWidth + spacing);
        ops.push({
            kind: 'round-rect',
            x,
            y,
            w: barWidth,
            h,
            r: cornerRadius(config.cornerRadius, barWidth, h),
            paint,
        });
    }
    return ops;
}

/// One pill across the whole width, as tall as the voice band (bands 8 to
/// 23) is loud. Both halves draw the same pill.
function pulse(frame: Frame): Op[] {
    const eb = inset(frame.bounds, PULSE_MARGINS);
    const voice = Array.from(frame.bands).slice(8, Math.min(24, frame.bands.length));
    const average =
        voice.length > 0 ? voice.reduce((a, b) => a + b, 0) / voice.length : frame.totalEnergy;
    const intensity = Math.min(average / FREQUENCY_NORMALIZATION_MAX, 1);
    const h = 2 + (eb.h * 0.8 - 2) * intensity;
    return [
        {
            kind: 'round-rect',
            x: eb.x,
            y: eb.y + (eb.h - h) / 2,
            w: eb.w,
            h,
            r: cornerRadius(h / 2, eb.w, h),
            paint: centerOut(),
        },
    ];
}

/// A smooth curve through the bands, filled faintly below and stroked.
function waveform(frame: Frame): Op[] {
    const eb = inset(frame.bounds, WAVEFORM_MARGINS);
    const control = waveformControlPoints(frame.bands, frame.side, eb.h);
    const points = sampleCurve(control, eb);
    if (points.length === 0) {
        return [];
    }
    const bottomY = eb.y + eb.h;
    const first = points[0] ?? [eb.x, bottomY];
    const last = points[points.length - 1] ?? [eb.x + eb.w, bottomY];
    const fill: number[] = [first[0], bottomY];
    const stroke: number[] = [];
    for (const [x, y] of points) {
        fill.push(x, y);
        stroke.push(x, y);
    }
    fill.push(last[0], bottomY);
    return [
        { kind: 'polygon', points: fill, paint: bottomToTop(WAVEFORM_FILL_OPACITY) },
        {
            kind: 'polyline',
            points: stroke,
            width: WAVEFORM_STROKE_WIDTH,
            cap: 'round',
            join: 'round',
            paint: bottomToTop(),
        },
    ];
}

/// The curve's control points, as (x in 0..1, height in pixels), then
/// smoothed. They are padded with a zero past each outer edge, so the curve
/// rises from and falls to the baseline there. A half pads only its outer
/// edge and runs its bands to its inner one, so the two halves meet at the
/// clock instead of each diving to the baseline beside it.
export function waveformControlPoints(
    bands: ArrayLike<number>,
    side: Side,
    height: number,
): [number, number][] {
    const { count, start } = visibleBandRange(side, bands.length);
    const maxH = Math.max(height, 1);
    const points: [number, number][] = [];
    if (side !== 'right') {
        points.push([-0.1, 0]);
    }
    for (let i = 0; i < count; i++) {
        const x = side === 'full' ? (i + 0.5) / count : i / Math.max(count - 1, 1);
        const level = ((bands[start + i] ?? 0) / FREQUENCY_NORMALIZATION_MAX) * maxH;
        points.push([x, Math.min(level, maxH)]);
    }
    if (side !== 'left') {
        points.push([1.1, 0]);
    }

    // Each pass reads the previous pass's heights; the ends stay put.
    for (let pass = 0; pass < WAVEFORM_SMOOTHING_PASSES; pass++) {
        const before = points.map(([, h]) => h);
        for (let i = 1; i < points.length - 1; i++) {
            const point = points[i];
            if (point) {
                point[1] =
                    0.25 * (before[i - 1] ?? 0) +
                    0.5 * (before[i] ?? 0) +
                    0.25 * (before[i + 1] ?? 0);
            }
        }
    }
    return points;
}

/// A Catmull-Rom curve through `control`, sampled once per horizontal pixel,
/// in canvas coordinates. The padded x range is stretched over the full
/// width.
export function sampleCurve(control: readonly [number, number][], eb: Bounds): [number, number][] {
    if (control.length === 0) {
        return [];
    }
    const renderPoints = Math.max(Math.trunc(eb.w), 0);
    const bottomY = eb.y + eb.h;
    const xs = control.map(([x]) => x);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const span = maxX - minX;
    const last = control.length - 1;
    const x = (i: number) => control[i]?.[0] ?? 0;
    const h = (i: number) => control[i]?.[1] ?? 0;
    const out: [number, number][] = [];
    for (let s = 0; s <= renderPoints; s++) {
        const t = minX + (renderPoints === 0 ? 0 : s / renderPoints) * span;
        let prev = 0;
        for (let j = 0; j < last; j++) {
            if (t >= x(j) && t <= x(j + 1)) {
                prev = j;
                break;
            }
        }
        const next = Math.min(prev + 1, last);
        const p0 = h(Math.max(prev - 1, 0));
        const p1 = h(prev);
        const p2 = h(next);
        const p3 = h(Math.min(next + 1, last));
        const segment = x(next) - x(prev);
        const u = Math.abs(segment) < Number.EPSILON ? 0 : (t - x(prev)) / segment;
        const u2 = u * u;
        const u3 = u2 * u;
        const height =
            0.5 *
            (2 * p1 +
                (-p0 + p2) * u +
                (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2 +
                (-p0 + 3 * p1 - 3 * p2 + p3) * u3);
        const clamped = Math.min(Math.max(height, 0), eb.h);
        const drawable =
            Math.abs(span) < Number.EPSILON ? 0 : Math.min(Math.max((t - minX) / span, 0), 1);
        out.push([eb.x + drawable * eb.w, bottomY - clamped]);
    }
    return out;
}
