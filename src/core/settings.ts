// SPDX-License-Identifier: GPL-3.0-only
//! The extension's settings: their GSettings keys, choices, labels and
//! defaults, shared by the panel menu and the preferences window. The
//! defaults are the applet's (`src/config/settings.rs`), but for the two
//! [`DEFAULTS`] explains; the schema in `schemas/` must agree, which
//! `tests/core/settings.test.ts` checks.

export interface Choice<Id extends string> {
    id: Id;
    label: string;
}

/// Where in the top bar Super Voice is. Around the clock it draws two halves,
/// one each side of the clock, which read as one picture with the clock in
/// its middle: the COSMIC applet's left and right halves. In the status
/// area it draws the whole picture in one place, beside the system icons.
export const POSITIONS = [
    { id: 'clock', label: 'Around the Clock' },
    { id: 'status-area', label: 'Status Area' },
] as const satisfies readonly Choice<string>[];

export type Position = (typeof POSITIONS)[number]['id'];

export const VISUALIZATION_STYLES = [
    { id: 'pulse', label: 'Pulse' },
    { id: 'bottom-equalizer', label: 'Equalizer' },
    { id: 'centered-equalizer', label: 'Centered Bars' },
    { id: 'waveform', label: 'Waveform' },
] as const satisfies readonly Choice<string>[];

export type VisualizationStyle = (typeof VISUALIZATION_STYLES)[number]['id'];

export const WORKING_ANIMATIONS = [
    { id: 'droplet', label: 'Droplet' },
    { id: 'comet', label: 'Comet' },
    { id: 'dots', label: 'Dots' },
] as const satisfies readonly Choice<string>[];

export type WorkingAnimation = (typeof WORKING_ANIMATIONS)[number]['id'];

export const ICON_ALIGNMENTS = [
    { id: 'start', label: 'Start' },
    { id: 'center', label: 'Center' },
    { id: 'end', label: 'End' },
] as const satisfies readonly Choice<string>[];

export type IconAlignment = (typeof ICON_ALIGNMENTS)[number]['id'];

/// The visualization's length along the panel, in pixels.
export const MIN_WIDTH = 60;
export const MAX_WIDTH = 300;

/// The GSettings keys.
export const KEYS = {
    position: 'position',
    visualizationStyle: 'visualization-style',
    workingAnimation: 'working-animation',
    palette: 'palette',
    showIcon: 'show-icon',
    iconAlignment: 'icon-alignment',
    appletWidth: 'applet-width',
    showVisualization: 'show-visualization',
} as const;

export interface Settings {
    position: Position;
    visualizationStyle: VisualizationStyle;
    workingAnimation: WorkingAnimation;
    palette: string;
    showIcon: boolean;
    iconAlignment: IconAlignment;
    appletWidth: number;
    showVisualization: boolean;
}

/// The applet's defaults, but for two: the extension sits around the clock,
/// and shows no icon while nothing is happening, so the top bar looks as it
/// would without it until Super Voice does something.
export const DEFAULTS: Settings = {
    position: 'clock',
    visualizationStyle: 'centered-equalizer',
    workingAnimation: 'droplet',
    palette: 'sunset',
    showIcon: false,
    iconAlignment: 'end',
    appletWidth: 120,
    showVisualization: true,
};

/// `value` if it names one of `choices`, else `fallback`. GSettings enforces
/// the choices, but a hand-edited dconf value can still slip past it.
export function choiceOr<Id extends string>(
    choices: readonly Choice<Id>[],
    value: string,
    fallback: Id,
): Id {
    return choices.find((c) => c.id === value)?.id ?? fallback;
}

export function clampWidth(width: number): number {
    return Math.min(Math.max(Math.round(width), MIN_WIDTH), MAX_WIDTH);
}
