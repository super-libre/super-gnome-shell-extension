// SPDX-License-Identifier: GPL-3.0-only
//! What the panel looks like where the indicator sits: whether its
//! background is dark, its text color, and the system accent.

import type Cogl from 'gi://Cogl';
import St from 'gi://St';
import type { Rgba } from '../../core/palette.js';

export interface PanelLook {
    /// Whether the panel is dark, so the palette picks its dark-panel shades.
    isDark: boolean;
    /// The panel's text color, for the size preview.
    foreground: Rgba;
    /// The system accent, for the Accent palette.
    accent: Rgba;
}

/// GNOME's default accent, for when the theme names none.
const DEFAULT_ACCENT: Rgba = { r: 0x35 / 255, g: 0x84 / 255, b: 0xe4 / 255, a: 1 };

export function fromCogl(color: Cogl.Color | null): Rgba | null {
    if (color === null) {
        return null;
    }
    return { r: color.red / 255, g: color.green / 255, b: color.blue / 255, a: color.alpha / 255 };
}

/// The look of the panel `widget` is drawn on. The panel is read rather
/// than the color scheme, because GNOME draws its top bar dark in both
/// schemes unless the theme says otherwise: light text means a dark panel.
/// Call it only while `widget` is on stage.
export function panelLook(widget: St.Widget): PanelLook {
    const foreground = fromCogl(widget.get_theme_node().get_foreground_color()) ?? {
        r: 1,
        g: 1,
        b: 1,
        a: 1,
    };
    const luminance = 0.2126 * foreground.r + 0.7152 * foreground.g + 0.0722 * foreground.b;
    const [accent] = St.ThemeContext.get_for_stage(global.stage).get_accent_color();
    return {
        isDark: luminance > 0.5,
        foreground,
        accent: fromCogl(accent) ?? DEFAULT_ACCENT,
    };
}
