// SPDX-License-Identifier: GPL-3.0-only
//! The color pairs the panel draws the two features in: the port of the
//! applet's `src/models/palette.rs`, where the design and its reasoning live.
//!
//! In short: each palette gives each feature a gradient, and a palette's two
//! gradients are a family, related in hue while each keeps a hue family of its
//! own. Each runs from a deeper, cooler end to a lighter, warmer one, avoids
//! browns and olives, and clears WCAG's 3:1 non-text contrast against its
//! panel. The pairs are designed in OKLCH for a dark panel; the light panel's
//! shades are derived from them, and each gradient is spread over [`STOPS`]
//! colors in OKLCH so its middle stays as vivid as its ends.
//!
//! The arithmetic follows the Rust exactly, down to the `f32` rounding of the
//! stop offsets and the final colors, so both draw the same pixels.
//! `tests/core/palette.test.ts` checks every stop against values the applet
//! itself computed.

import type { Feature } from './protocol.js';

/// A color in sRGB, each channel in [0, 1].
export interface Rgba {
    r: number;
    g: number;
    b: number;
    a: number;
}

/// How many colors a gradient holds.
export const STOPS = 7;

/// One feature's gradient, from its deep, cool end to its light, warm one.
export type Gradient = readonly Rgba[];

/// Where stop `i` of a gradient sits, from 0 to 1.
export function offset(i: number): number {
    return Math.fround(i / (STOPS - 1));
}

/// `gradient`, `alpha` times as opaque.
export function withAlpha(gradient: Gradient, alpha: number): Gradient {
    return gradient.map((c) => ({ ...c, a: Math.fround(c.a * alpha) }));
}

export const PALETTES = [
    { id: 'accent', label: 'Accent' },
    { id: 'sunset', label: 'Sunset' },
    { id: 'synthwave', label: 'Synthwave' },
    { id: 'nebula', label: 'Nebula' },
    { id: 'aurora', label: 'Aurora' },
    { id: 'candy', label: 'Candy' },
    { id: 'glacier', label: 'Glacier' },
    { id: 'rose', label: 'Rosé' },
    { id: 'ember-and-ash', label: 'Ember & Ash' },
    { id: 'citrus-and-sea', label: 'Citrus & Sea' },
    { id: 'harbor', label: 'Harbor' },
    { id: 'fern-and-plum', label: 'Fern & Plum' },
    { id: 'graphite', label: 'Graphite' },
] as const;

export type PaletteId = (typeof PALETTES)[number]['id'];

export const DEFAULT_PALETTE: PaletteId = 'sunset';

export function isPaletteId(id: string): id is PaletteId {
    return PALETTES.some((p) => p.id === id);
}

export function paletteLabel(id: PaletteId): string {
    return PALETTES.find((p) => p.id === id)?.label ?? id;
}

interface Lch {
    l: number;
    c: number;
    h: number;
}

type Ends = readonly [Lch, Lch];

function lch(l: number, c: number, h: number): Lch {
    return { l, c, h };
}

interface Design {
    stt: Ends;
    tts: Ends;
    /// Shades for a light panel, where the derived ones don't do.
    light?: { stt?: Ends; tts?: Ends };
}

/// The designed pairs, for a dark panel. Accent has none: it is built from
/// the system accent when drawn.
const DESIGNS: Record<Exclude<PaletteId, 'accent'>, Design> = {
    // Coral into amber, against violet into pink.
    sunset: {
        stt: [lch(0.7, 0.19, 28.0), lch(0.86, 0.15, 72.0)],
        tts: [lch(0.6, 0.21, 303.0), lch(0.74, 0.19, 352.0)],
    },
    // Hot pink into orange, against purple into cyan.
    synthwave: {
        stt: [lch(0.66, 0.24, 355.0), lch(0.82, 0.16, 58.0)],
        tts: [lch(0.56, 0.23, 296.0), lch(0.84, 0.13, 205.0)],
    },
    // Magenta into rose, against indigo into cyan.
    nebula: {
        stt: [lch(0.62, 0.25, 330.0), lch(0.82, 0.12, 12.0)],
        tts: [lch(0.52, 0.21, 280.0), lch(0.82, 0.12, 212.0)],
    },
    // Teal into mint, against violet into sky.
    aurora: {
        stt: [lch(0.74, 0.14, 192.0), lch(0.89, 0.16, 152.0)],
        tts: [lch(0.6, 0.19, 292.0), lch(0.78, 0.13, 236.0)],
    },
    // Bubblegum into peach, against lilac into baby blue.
    candy: {
        stt: [lch(0.8, 0.13, 358.0), lch(0.9, 0.08, 60.0)],
        tts: [lch(0.75, 0.12, 296.0), lch(0.86, 0.08, 232.0)],
    },
    // Cyan into ice, against indigo into periwinkle.
    glacier: {
        stt: [lch(0.8, 0.12, 214.0), lch(0.95, 0.045, 198.0)],
        tts: [lch(0.56, 0.18, 280.0), lch(0.8, 0.09, 266.0)],
    },
    // Rose into champagne, against mauve into silver lilac.
    rose: {
        stt: [lch(0.74, 0.12, 14.0), lch(0.9, 0.06, 72.0)],
        tts: [lch(0.62, 0.1, 322.0), lch(0.84, 0.045, 300.0)],
    },
    // Glowing red into gold, against slate into ash.
    'ember-and-ash': {
        stt: [lch(0.64, 0.21, 30.0), lch(0.88, 0.16, 82.0)],
        tts: [lch(0.58, 0.05, 258.0), lch(0.8, 0.025, 240.0)],
    },
    // Tangerine into lemon, against deep teal into aqua.
    'citrus-and-sea': {
        stt: [lch(0.78, 0.17, 58.0), lch(0.93, 0.16, 104.0)],
        tts: [lch(0.6, 0.11, 205.0), lch(0.82, 0.13, 178.0)],
    },
    // Orange into amber, against blue into sky: the clearest pair for
    // color-blind viewers.
    harbor: {
        stt: [lch(0.76, 0.17, 52.0), lch(0.88, 0.15, 80.0)],
        tts: [lch(0.58, 0.17, 262.0), lch(0.77, 0.13, 238.0)],
    },
    // Emerald into lime, against plum into orchid. On a light panel the lime
    // would darken into olive, so speech to text runs deep emerald into a
    // clean green there.
    'fern-and-plum': {
        stt: [lch(0.68, 0.17, 150.0), lch(0.9, 0.17, 132.0)],
        tts: [lch(0.52, 0.18, 315.0), lch(0.74, 0.15, 330.0)],
        light: { stt: [lch(0.4, 0.13, 158.0), lch(0.56, 0.16, 146.0)] },
    },
    // Silver into white, against graphite into steel; on a light panel,
    // black into charcoal against slate.
    graphite: {
        stt: [lch(0.86, 0.0, 0.0), lch(0.99, 0.0, 0.0)],
        tts: [lch(0.56, 0.02, 262.0), lch(0.72, 0.015, 255.0)],
        light: {
            stt: [lch(0.2, 0.0, 0.0), lch(0.34, 0.0, 0.0)],
            tts: [lch(0.46, 0.025, 262.0), lch(0.56, 0.02, 255.0)],
        },
    },
};

/// The contrast every designed color clears against its panel.
export const MIN_CONTRAST = 3.0;

/// The panels the designed colors are fitted against, as linear sRGB.
function panelBackground(isDark: boolean): [number, number, number] {
    const level = srgbToLinear((isDark ? 0x1b : 0xd7) / 255);
    return [level, level, level];
}

const cache = new Map<string, Gradient>();

/// `feature`'s gradient in `palette`, for a dark or light panel. `accent` is
/// the system accent color, read only by the Accent palette.
export function gradient(
    palette: PaletteId,
    feature: Feature,
    isDark: boolean,
    accent: Rgba,
): Gradient {
    if (palette === 'accent') {
        return spread(accentEnds(accent, feature)).map((p) => linearToColor(inGamut(p)));
    }
    const key = `${palette}/${feature}/${isDark}`;
    let built = cache.get(key);
    if (built === undefined) {
        const design = DESIGNS[palette];
        const ends = isDark
            ? design[feature]
            : (design.light?.[feature] ?? forLightPanel(design[feature]));
        built = spread(ends).map((p) => linearToColor(fitContrast(p, isDark)));
        cache.set(key, built);
    }
    return built;
}

// The accent palette: the accent itself is speech to text's light end, and
// the rest is built around it.

/// The chroma the other colors keep however pale the accent.
const ACCENT_CHROMA = 0.1;
/// Below this an accent is a gray, with no hue to lend.
const GRAY_CHROMA = 0.02;
/// How far text to speech turns from the accent's hue: its light end, then
/// its deep end.
const COMPANION_TURN = [60.0, 95.0] as const;
/// Where a turn would land in olive and murky green; it turns the other way.
const MURKY_HUES = [95.0, 150.0] as const;

function companionTurns(h: number): [number, number] {
    const [near, far] = COMPANION_TURN;
    const landing = remEuclid(h + near, 360);
    return landing >= MURKY_HUES[0] && landing < MURKY_HUES[1] ? [-near, -far] : [near, far];
}

function accentEnds(accent: Rgba, feature: Feature): Ends {
    const { l, c, h } = linearToLch(colorToLinear(accent));
    const other = c < GRAY_CHROMA ? c : Math.max(c, ACCENT_CHROMA);
    const [near, far] = companionTurns(h);
    if (feature === 'stt') {
        return [lch(l - 0.1, other * 1.1, h - 15.0), lch(l, c, h)];
    }
    return [lch(l - 0.12, other * 1.3, h + far), lch(l, other * 1.05, h + near)];
}

/// A dark-panel pair, shaded for a light panel: as much darker as needed to
/// stand out there, a little more chroma, and yellows turned toward amber so
/// they don't darken into olive.
function forLightPanel(ends: Ends): Ends {
    const top = Math.max(ends[0].l, ends[1].l);
    const shade = ({ l, c, h }: Lch): Lch => {
        const hue = h >= 40.0 && h < 125.0 && c > 0.03 ? 35.0 + (h - 40.0) * (35.0 / 85.0) : h;
        return lch(0.56 - (top - l) * 0.8, c * 1.05, hue);
    };
    return [shade(ends[0]), shade(ends[1])];
}

/// Spread two ends over the stops in OKLCH, the short way round the hue
/// circle.
function spread(ends: Ends): Lch[] {
    const [from, to] = ends;
    const turn = remEuclid(to.h - from.h + 180.0, 360.0) - 180.0;
    return Array.from({ length: STOPS }, (_, i) => {
        const t = offset(i);
        return lch(from.l + (to.l - from.l) * t, from.c + (to.c - from.c) * t, from.h + turn * t);
    });
}

/// The color, as linear sRGB, with its lightness moved until it clears
/// [`MIN_CONTRAST`] against the panel: lighter on a dark one, darker on a
/// light one.
function fitContrast(color: Lch, isDark: boolean): [number, number, number] {
    const background = panelBackground(isDark);
    const step = isDark ? 0.005 : -0.005;
    let l = color.l;
    let rgb = inGamut(lch(l, color.c, color.h));
    while (contrast(rgb, background) < MIN_CONTRAST && l > 0.05 && l < 0.98) {
        l += step;
        rgb = inGamut(lch(l, color.c, color.h));
    }
    return rgb;
}

/// The color with as much of its chroma as sRGB can show, as linear sRGB.
function inGamut(color: Lch): [number, number, number] {
    const rad = (color.h * Math.PI) / 180;
    const sin = Math.sin(rad);
    const cos = Math.cos(rad);
    const at = (c: number) => oklabToLinear([color.l, c * cos, c * sin]);
    const fits = (rgb: readonly number[]) => rgb.every((v) => v >= -1e-6 && v <= 1.0 + 1e-6);
    let low = 0.0;
    let high = color.c;
    let rgb = at(0.0);
    for (let i = 0; i < 24; i++) {
        const mid = (low + high) / 2;
        const candidate = at(mid);
        if (fits(candidate)) {
            low = mid;
            rgb = candidate;
        } else {
            high = mid;
        }
    }
    const full = at(color.c);
    if (fits(full)) {
        rgb = full;
    }
    return [clamp01(rgb[0]), clamp01(rgb[1]), clamp01(rgb[2])];
}

/// WCAG's contrast ratio between two linear sRGB colors.
export function contrast(a: readonly number[], b: readonly number[]): number {
    const luminance = (c: readonly number[]) =>
        0.2126 * (c[0] ?? 0) + 0.7152 * (c[1] ?? 0) + 0.0722 * (c[2] ?? 0);
    const la = luminance(a);
    const lb = luminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export function srgbToLinear(v: number): number {
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(value: number): number {
    const v = clamp01(value);
    return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1.0 / 2.4) - 0.055;
}

export function colorToLinear(color: Rgba): [number, number, number] {
    return [srgbToLinear(color.r), srgbToLinear(color.g), srgbToLinear(color.b)];
}

function linearToColor(rgb: readonly [number, number, number]): Rgba {
    return {
        r: Math.fround(linearToSrgb(rgb[0])),
        g: Math.fround(linearToSrgb(rgb[1])),
        b: Math.fround(linearToSrgb(rgb[2])),
        a: 1,
    };
}

export function linearToOklab([r, g, b]: readonly [number, number, number]): [
    number,
    number,
    number,
] {
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [
        0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
        1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
        0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
    ];
}

function oklabToLinear([l, a, b]: readonly [number, number, number]): [number, number, number] {
    const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
    return [
        4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
        -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
        -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
    ];
}

function linearToLch(rgb: readonly [number, number, number]): Lch {
    const [l, a, b] = linearToOklab(rgb);
    return lch(l, Math.hypot(a, b), remEuclid((Math.atan2(b, a) * 180) / Math.PI, 360));
}

function remEuclid(value: number, modulus: number): number {
    const r = value % modulus;
    return r < 0 ? r + modulus : r;
}

function clamp01(v: number): number {
    return Math.min(Math.max(v, 0), 1);
}

/// The swatch's gradient direction, 135°, as the applet draws it.
export const SWATCH_ANGLE = (3 * Math.PI) / 4;

/// The eight colors a swatch shows: speech to text's light end to its deep
/// one, then text to speech's deep end to its light one.
export function swatchColors(stt: Gradient, tts: Gradient): Rgba[] {
    const pick = (g: Gradient, i: number) => g[i] ?? { r: 0, g: 0, b: 0, a: 1 };
    return [
        pick(stt, 6),
        pick(stt, 4),
        pick(stt, 2),
        pick(stt, 0),
        pick(tts, 0),
        pick(tts, 2),
        pick(tts, 4),
        pick(tts, 6),
    ];
}

/// `#rrggbb`, for tests and logs.
export function toHex(c: Rgba): string {
    const byte = (v: number) =>
        Math.round(clamp01(v) * 255)
            .toString(16)
            .padStart(2, '0');
    return `#${byte(c.r)}${byte(c.g)}${byte(c.b)}`;
}
