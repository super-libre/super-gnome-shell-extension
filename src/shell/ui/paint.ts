// SPDX-License-Identifier: GPL-3.0-only
//! Plays the core's draw ops on a Cairo context, in a feature's gradient.

import Cairo from 'cairo';
import type { Bounds, Op, Paint } from '../../core/draw/ops.js';
import { type Gradient, offset, type Rgba, STOPS, SWATCH_ANGLE } from '../../core/palette.js';

/// The stop order of a center-out gradient: the deep end on the midline, the
/// light end at both edges.
const CENTER_OUT = [6, 4, 2, 0, 2, 4, 6];

export function play(
    cr: Cairo.Context,
    ops: readonly Op[],
    bounds: Bounds,
    gradient: Gradient,
): void {
    const patterns = new Map<string, Cairo.Pattern>();
    const patternFor = (paint: Paint): Cairo.Pattern => {
        const key = `${paint.gradient}/${paint.alpha}`;
        let pattern = patterns.get(key);
        if (pattern === undefined) {
            pattern = linearPattern(paint, bounds, gradient);
            patterns.set(key, pattern);
        }
        return pattern;
    };

    for (const op of ops) {
        cr.newPath();
        switch (op.kind) {
            case 'round-rect':
                roundRect(cr, op.x, op.y, op.w, op.h, op.r);
                cr.setSource(patternFor(op.paint));
                cr.fill();
                break;
            case 'polygon':
                if (!polyline(cr, op.points)) {
                    continue;
                }
                cr.closePath();
                cr.setSource(patternFor(op.paint));
                cr.fill();
                break;
            case 'polyline':
                if (!polyline(cr, op.points)) {
                    continue;
                }
                cr.setLineWidth(op.width);
                cr.setLineCap(op.cap === 'round' ? Cairo.LineCap.ROUND : Cairo.LineCap.BUTT);
                cr.setLineJoin(op.join === 'round' ? Cairo.LineJoin.ROUND : Cairo.LineJoin.MITER);
                cr.setSource(patternFor(op.paint));
                cr.stroke();
                break;
            case 'circle':
                if (op.r <= 0) {
                    continue;
                }
                cr.arc(op.cx, op.cy, op.r, 0, 2 * Math.PI);
                cr.setSource(patternFor(op.paint));
                cr.fill();
                break;
        }
    }
}

/// A gradient over the whole canvas, as the applet lays it: bottom to top,
/// or from the midline out to both edges.
function linearPattern(paint: Paint, b: Bounds, gradient: Gradient): Cairo.Pattern {
    if (paint.gradient === 'bottom-to-top') {
        const pattern = new Cairo.LinearGradient(b.x, b.y + b.h, b.x, b.y);
        for (let i = 0; i < STOPS; i++) {
            addStop(pattern, offset(i), gradient[i], paint.alpha);
        }
        return pattern;
    }
    const pattern = new Cairo.LinearGradient(b.x, b.y, b.x, b.y + b.h);
    CENTER_OUT.forEach((stop, i) => {
        addStop(pattern, offset(i), gradient[stop], paint.alpha);
    });
    return pattern;
}

function addStop(
    pattern: Cairo.LinearGradient,
    at: number,
    color: Rgba | undefined,
    alpha: number,
) {
    const c = color ?? { r: 0, g: 0, b: 0, a: 1 };
    pattern.addColorStopRGBA(at, c.r, c.g, c.b, c.a * alpha);
}

function polyline(cr: Cairo.Context, points: readonly number[]): boolean {
    if (points.length < 4) {
        return false;
    }
    cr.moveTo(points[0] ?? 0, points[1] ?? 0);
    for (let i = 2; i + 1 < points.length; i += 2) {
        cr.lineTo(points[i] ?? 0, points[i + 1] ?? 0);
    }
    return true;
}

export function roundRect(
    cr: Cairo.Context,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
) {
    if (w <= 0 || h <= 0) {
        return;
    }
    const radius = Math.max(Math.min(r, w / 2, h / 2), 0);
    if (radius === 0) {
        cr.rectangle(x, y, w, h);
        return;
    }
    cr.newSubPath();
    cr.arc(x + w - radius, y + radius, radius, -Math.PI / 2, 0);
    cr.arc(x + w - radius, y + h - radius, radius, 0, Math.PI / 2);
    cr.arc(x + radius, y + h - radius, radius, Math.PI / 2, Math.PI);
    cr.arc(x + radius, y + radius, radius, Math.PI, (3 * Math.PI) / 2);
    cr.closePath();
}

/// A palette swatch: a disc of `size` at (x, y), its colors running at 135°,
/// as the applet draws it.
export function swatch(
    cr: Cairo.Context,
    x: number,
    y: number,
    size: number,
    colors: readonly Rgba[],
) {
    // iced lays an angled gradient across the box's center at the length
    // that reaches its corners; for a square at 135° that runs from a
    // quarter of the way in at the top left to three quarters.
    const theta = SWATCH_ANGLE - Math.PI / 2;
    const rx = Math.cos(theta);
    const ry = Math.sin(theta);
    const half = size / 2;
    const d = Math.max(Math.abs(rx * half), Math.abs(ry * half));
    const cx = x + half;
    const cy = y + half;
    const pattern = new Cairo.LinearGradient(cx - rx * d, cy - ry * d, cx + rx * d, cy + ry * d);
    const last = Math.max(colors.length - 1, 1);
    colors.forEach((c, i) => {
        pattern.addColorStopRGBA(Math.fround(i / last), c.r, c.g, c.b, c.a);
    });
    cr.newPath();
    cr.arc(cx, cy, half, 0, 2 * Math.PI);
    cr.setSource(pattern);
    cr.fill();
}
