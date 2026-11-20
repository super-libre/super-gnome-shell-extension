// SPDX-License-Identifier: GPL-3.0-only
//! The schema and src/core/settings.ts must name the same keys, choices and
//! defaults: the menu and preferences read them from one, GSettings enforces
//! the other.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PALETTES } from '../../src/core/palette.js';
import {
    clampWidth,
    DEFAULTS,
    ICON_ALIGNMENTS,
    KEYS,
    MAX_WIDTH,
    MIN_WIDTH,
    POSITIONS,
    VISUALIZATION_STYLES,
    WORKING_ANIMATIONS,
} from '../../src/core/settings.js';

const schema = readFileSync(
    new URL('../../schemas/org.gnome.shell.extensions.super-voice.gschema.xml', import.meta.url),
    'utf8',
);
const metadata = JSON.parse(
    readFileSync(new URL('../../metadata.json', import.meta.url), 'utf8'),
) as Record<string, unknown>;

function key(name: string): string {
    const match = schema.match(new RegExp(`<key name="${name}"[^>]*>([\\s\\S]*?)</key>`));
    if (!match?.[1]) {
        throw new Error(`no key ${name} in the schema`);
    }
    return match[1];
}

function choices(name: string): string[] {
    return [...key(name).matchAll(/<choice value="([^"]+)"\/>/g)].map((m) => m[1] ?? '');
}

function defaultOf(name: string): string {
    return key(name).match(/<default>([^<]*)<\/default>/)?.[1] ?? '';
}

describe('settings', () => {
    it('offers the same choices as the schema', () => {
        expect(choices(KEYS.position)).toEqual(POSITIONS.map((c) => c.id));
        expect(choices(KEYS.visualizationStyle)).toEqual(VISUALIZATION_STYLES.map((c) => c.id));
        expect(choices(KEYS.workingAnimation)).toEqual(WORKING_ANIMATIONS.map((c) => c.id));
        expect(choices(KEYS.iconAlignment)).toEqual(ICON_ALIGNMENTS.map((c) => c.id));
        expect(choices(KEYS.palette)).toEqual(PALETTES.map((p) => p.id));
    });

    it('defaults as the schema does', () => {
        expect(defaultOf(KEYS.position)).toBe(`'${DEFAULTS.position}'`);
        expect(defaultOf(KEYS.visualizationStyle)).toBe(`'${DEFAULTS.visualizationStyle}'`);
        expect(defaultOf(KEYS.workingAnimation)).toBe(`'${DEFAULTS.workingAnimation}'`);
        expect(defaultOf(KEYS.palette)).toBe(`'${DEFAULTS.palette}'`);
        expect(defaultOf(KEYS.iconAlignment)).toBe(`'${DEFAULTS.iconAlignment}'`);
        expect(defaultOf(KEYS.showIcon)).toBe(String(DEFAULTS.showIcon));
        expect(defaultOf(KEYS.showVisualization)).toBe(String(DEFAULTS.showVisualization));
        expect(defaultOf(KEYS.appletWidth)).toBe(String(DEFAULTS.appletWidth));
        expect(key(KEYS.appletWidth)).toContain(`<range min="${MIN_WIDTH}" max="${MAX_WIDTH}"/>`);
    });

    it('sits around the clock with no icon, unlike the applet', () => {
        expect(DEFAULTS.position).toBe('clock');
        expect(DEFAULTS.showIcon).toBe(false);
    });

    it('clamps the width to the range the slider offers', () => {
        expect(clampWidth(10)).toBe(60);
        expect(clampWidth(120.4)).toBe(120);
        expect(clampWidth(999)).toBe(300);
    });

    it('declares the schema the extension reads', () => {
        expect(metadata['settings-schema']).toBe('org.gnome.shell.extensions.super-voice');
        expect(schema).toContain('id="org.gnome.shell.extensions.super-voice"');
        expect(schema).toContain('path="/org/gnome/shell/extensions/super-voice/"');
        // extensions.gnome.org refuses a `version` key, which it assigns.
        expect(metadata).not.toHaveProperty('version');
    });
});
