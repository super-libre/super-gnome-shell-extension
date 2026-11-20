// SPDX-License-Identifier: GPL-3.0-only
//! What the panel draws, as data: each visualization and animation is a pure
//! function from its inputs to a list of these, and the shell plays the list
//! on a Cairo context. That keeps the geometry testable without GNOME.

/// Which part of the picture a canvas draws. Around the clock the extension
/// draws two halves, one each side of it, that read as one picture: `left`
/// draws its first half and `right` its second. `full` draws all of it.
export type Side = 'full' | 'left' | 'right';

/// The width a side's picture is laid out over, and where this canvas starts
/// in it: a half is half of a picture twice its width.
export function logicalSpan(side: Side, width: number): { width: number; offset: number } {
    switch (side) {
        case 'full':
            return { width, offset: 0 };
        case 'left':
            return { width: 2 * width, offset: 0 };
        case 'right':
            return { width: 2 * width, offset: width };
    }
}

/// The canvas, in its own coordinates: `x` and `y` are always 0.
export interface Bounds {
    x: number;
    y: number;
    w: number;
    h: number;
}

/// How a shape is filled or stroked: one of the feature's two gradients over
/// the whole canvas, at an opacity.
///
/// - `bottom-to-top` runs the gradient's deep end at the bottom edge to its
///   light end at the top.
/// - `center-out` puts the deep end on the horizontal midline and the light
///   end at both the top and bottom edges.
export interface Paint {
    gradient: 'bottom-to-top' | 'center-out';
    alpha: number;
}

export type Op =
    /// A filled rectangle with every corner rounded by `r`.
    | { kind: 'round-rect'; x: number; y: number; w: number; h: number; r: number; paint: Paint }
    /// A filled closed polygon, `points` as x0, y0, x1, y1, ….
    | { kind: 'polygon'; points: number[]; paint: Paint }
    /// A stroked open polyline.
    | {
          kind: 'polyline';
          points: number[];
          width: number;
          cap: 'round' | 'butt';
          join: 'round' | 'miter';
          paint: Paint;
      }
    /// A filled circle.
    | { kind: 'circle'; cx: number; cy: number; r: number; paint: Paint };

export function bottomToTop(alpha = 1): Paint {
    return { gradient: 'bottom-to-top', alpha };
}

export function centerOut(alpha = 1): Paint {
    return { gradient: 'center-out', alpha };
}

/// The rounded-rectangle radius iced draws: never more than half a side.
export function cornerRadius(r: number, w: number, h: number): number {
    return Math.max(Math.min(r, w / 2, h / 2), 0);
}
