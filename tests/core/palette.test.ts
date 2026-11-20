// SPDX-License-Identifier: GPL-3.0-only
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
    colorToLinear,
    contrast,
    gradient,
    isPaletteId,
    MIN_CONTRAST,
    offset,
    PALETTES,
    type PaletteId,
    paletteLabel,
    type Rgba,
    STOPS,
    srgbToLinear,
    swatchColors,
} from '../../src/core/palette.js';
import type { Feature } from '../../src/core/protocol.js';

/// Every stop the COSMIC applet computes, dumped by its own palette.rs (see
/// tools/palette-golden).
type Stops = [number, number, number][];
type Fixture = Record<
    string,
    { label: string } & Record<string, Stops | Record<string, { accent: number[]; stops: Stops }>>
>;
const fixture = JSON.parse(
    readFileSync(new URL('../fixtures/palette.json', import.meta.url), 'utf8'),
) as Fixture;

/// The applet's serde names, by the extension's ids.
const RUST_NAME: Record<PaletteId, string> = {
    accent: 'Accent',
    sunset: 'Sunset',
    synthwave: 'Synthwave',
    nebula: 'Nebula',
    aurora: 'Aurora',
    candy: 'Candy',
    glacier: 'Glacier',
    rose: 'Rose',
    'ember-and-ash': 'EmberAndAsh',
    'citrus-and-sea': 'CitrusAndSea',
    harbor: 'Harbor',
    'fern-and-plum': 'FernAndPlum',
    graphite: 'Graphite',
};

const BLACK: Rgba = { r: 0, g: 0, b: 0, a: 1 };
const FEATURES: Feature[] = ['stt', 'tts'];
const PANELS = [
    { name: 'dark', isDark: true },
    { name: 'light', isDark: false },
];

/// The two compute in f32 in the applet and f64 here before rounding to f32,
/// so a stop may differ in its last bits, never visibly.
function expectStops(actual: readonly Rgba[], expected: Stops) {
    expect(actual).toHaveLength(STOPS);
    actual.forEach((c, i) => {
        const [r, g, b] = expected[i] ?? [Number.NaN, Number.NaN, Number.NaN];
        expect(c.r).toBeCloseTo(r, 5);
        expect(c.g).toBeCloseTo(g, 5);
        expect(c.b).toBeCloseTo(b, 5);
        expect(c.a).toBe(1);
    });
}

describe('palette', () => {
    it('lists every palette the applet has, in its order, with its names', () => {
        expect(PALETTES.map((p) => RUST_NAME[p.id])).toEqual(Object.keys(fixture));
        for (const p of PALETTES) {
            expect(paletteLabel(p.id)).toBe(fixture[RUST_NAME[p.id]]?.label);
        }
    });

    for (const { id } of PALETTES.filter((p) => p.id !== 'accent')) {
        it(`draws ${id} as the applet does, on both panels`, () => {
            for (const feature of FEATURES) {
                for (const panel of PANELS) {
                    const expected = fixture[RUST_NAME[id]]?.[`${feature}.${panel.name}`] as Stops;
                    expectStops(gradient(id, feature, panel.isDark, BLACK), expected);
                }
            }
        });
    }

    it('builds the accent palette as the applet does, for every GNOME accent', () => {
        for (const feature of FEATURES) {
            for (const panel of PANELS) {
                const byAccent = fixture.Accent?.[`${feature}.${panel.name}`] as Record<
                    string,
                    { accent: number[]; stops: Stops }
                >;
                for (const { accent, stops } of Object.values(byAccent)) {
                    const [r = 0, g = 0, b = 0] = accent;
                    expectStops(
                        gradient('accent', feature, panel.isDark, { r, g, b, a: 1 }),
                        stops,
                    );
                }
            }
        }
    });

    it('keeps every designed color clear of its panel', () => {
        for (const { id } of PALETTES.filter((p) => p.id !== 'accent')) {
            for (const feature of FEATURES) {
                for (const { isDark } of PANELS) {
                    const level = srgbToLinear((isDark ? 0x1b : 0xd7) / 255);
                    for (const stop of gradient(id, feature, isDark, BLACK)) {
                        // Rounding to f32 may cost a hair of the margin.
                        expect(
                            contrast(colorToLinear(stop), [level, level, level]),
                        ).toBeGreaterThanOrEqual(MIN_CONTRAST - 0.01);
                    }
                }
            }
        }
    });

    it('spaces the stops evenly, at the offsets the applet rounds to f32', () => {
        expect(offset(0)).toBe(0);
        expect(offset(6)).toBe(1);
        expect(offset(1)).toBe(Math.fround(1 / 6));
    });

    it('lays a swatch out from speech to text light end to text to speech light end', () => {
        const stt = gradient('sunset', 'stt', true, BLACK);
        const tts = gradient('sunset', 'tts', true, BLACK);
        expect(swatchColors(stt, tts)).toEqual([
            stt[6],
            stt[4],
            stt[2],
            stt[0],
            tts[0],
            tts[2],
            tts[4],
            tts[6],
        ]);
    });

    it('knows its ids', () => {
        expect(isPaletteId('sunset')).toBe(true);
        expect(isPaletteId('Sunset')).toBe(false);
    });
});
