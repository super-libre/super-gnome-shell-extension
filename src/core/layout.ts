// SPDX-License-Identifier: GPL-3.0-only
//! The indicator's size: the port of the applet's `src/app/layout.rs` and the
//! icon placement in `src/app/view.rs`.
//!
//! The box depends only on the settings, never on what is showing, so the top
//! bar doesn't shift when dictation starts.

import { clampWidth, type IconAlignment } from './settings.js';

/// The tallest the content gets, however tall the panel.
export const MAX_CONTENT_CROSS = 108;

export interface Size {
    width: number;
    height: number;
}

/// The content box for a panel whose buttons have `cross` pixels of height
/// to draw in: as long as the visualization setting while visualizations are
/// on, else a square.
export function contentSize(cross: number, showVisualization: boolean, width: number): Size {
    const height = Math.min(Math.max(cross, 1), MAX_CONTENT_CROSS);
    return { width: showVisualization ? clampWidth(width) : height, height };
}

/// The icon's size in a content box: 60% of its short side, between 16 and 32.
export function iconSize(content: Size): number {
    return Math.min(Math.max(Math.min(content.width, content.height) * 0.6, 16), 32);
}

/// Where the icon starts along the box's length.
export function iconOffset(alignment: IconAlignment, boxLength: number, icon: number): number {
    const room = Math.max(boxLength - icon, 0);
    switch (alignment) {
        case 'start':
            return 0;
        case 'center':
            return room / 2;
        case 'end':
            return room;
    }
}
