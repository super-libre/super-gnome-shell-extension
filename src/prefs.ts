// SPDX-License-Identifier: GPL-3.0-only
//! The preferences window, which the Extensions app opens: the same settings
//! as the menu, in libadwaita's widgets.

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import type GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';
import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import type Cairo from 'cairo';
import {
    gradient,
    isPaletteId,
    PALETTES,
    type PaletteId,
    type Rgba,
    swatchColors,
} from './core/palette.js';
import { FEATURE_NAMES, type Feature } from './core/protocol.js';
import {
    type Choice,
    choiceOr,
    DEFAULTS,
    ICON_ALIGNMENTS,
    KEYS,
    MAX_WIDTH,
    MIN_WIDTH,
    POSITIONS,
    VISUALIZATION_STYLES,
    WORKING_ANIMATIONS,
} from './core/settings.js';
import { swatch } from './shell/ui/paint.js';

const SWATCH_SIZE = 28;
/// The picked pair's circle on the Colors row.
const ROW_CIRCLE = 24;
const DOT_SIZE = 10;

export default class SuperVoicePreferences extends ExtensionPreferences {
    override async fillPreferencesWindow(window: Adw.PreferencesWindow): Promise<void> {
        const settings = this.getSettings();
        const handlers: { object: GObject.Object; id: number }[] = [];
        const track = (object: GObject.Object, id: number) => handlers.push({ object, id });

        const page = new Adw.PreferencesPage({
            title: 'Super Voice',
            icon_name: 'audio-input-microphone-symbolic',
        });

        const bar = new Adw.PreferencesGroup({
            title: 'Top Bar',
            description:
                'Where Super Voice sits in the top bar: around the clock, as two halves of one picture, or beside the system icons.',
        });
        bar.add(
            this.#choiceRow(
                'Position',
                POSITIONS,
                KEYS.position,
                DEFAULTS.position,
                settings,
                track,
            ),
        );
        const showIcon = new Adw.SwitchRow({ title: 'Show Icon' });
        settings.bind(KEYS.showIcon, showIcon, 'active', Gio.SettingsBindFlags.DEFAULT);
        bar.add(showIcon);
        const position = this.#choiceRow(
            'Icon Position',
            ICON_ALIGNMENTS,
            KEYS.iconAlignment,
            DEFAULTS.iconAlignment,
            settings,
            track,
        );
        settings.bind(KEYS.showIcon, position, 'sensitive', Gio.SettingsBindFlags.GET);
        bar.add(position);
        page.add(bar);

        const visualization = new Adw.PreferencesGroup({
            title: 'Visualization',
            description:
                'Your microphone while you dictate, the speech while it plays, and an animation while Super Voice transcribes or prepares the first audio.',
        });
        const showVisualization = new Adw.SwitchRow({ title: 'Show Visualization' });
        settings.bind(
            KEYS.showVisualization,
            showVisualization,
            'active',
            Gio.SettingsBindFlags.DEFAULT,
        );
        visualization.add(showVisualization);
        const size = Adw.SpinRow.new_with_range(MIN_WIDTH, MAX_WIDTH, 1);
        size.title = 'Visualization Size';
        size.subtitle = 'Width in pixels';
        settings.bind(KEYS.appletWidth, size, 'value', Gio.SettingsBindFlags.DEFAULT);
        const style = this.#choiceRow(
            'Visualization Style',
            VISUALIZATION_STYLES,
            KEYS.visualizationStyle,
            DEFAULTS.visualizationStyle,
            settings,
            track,
        );
        const animation = this.#choiceRow(
            'Loading Animation',
            WORKING_ANIMATIONS,
            KEYS.workingAnimation,
            DEFAULTS.workingAnimation,
            settings,
            track,
        );
        // The colors are a page of their own, as in the applet's popup.
        const colors = this.#colors(settings, track);
        track(
            colors.row,
            colors.row.connect('activated', () => window.push_subpage(colors.page)),
        );
        for (const row of [size, style, animation, colors.row]) {
            settings.bind(KEYS.showVisualization, row, 'sensitive', Gio.SettingsBindFlags.GET);
            visualization.add(row);
        }
        page.add(visualization);
        window.add(page);

        window.connect('close-request', () => {
            for (const { object, id } of handlers) {
                object.disconnect(id);
            }
            handlers.length = 0;
            return false;
        });
    }

    /// A drop-down of `choices`, kept in step with the setting `key`.
    #choiceRow<Id extends string>(
        title: string,
        choices: readonly Choice<Id>[],
        key: string,
        fallback: Id,
        settings: Gio.Settings,
        track: (object: GObject.Object, id: number) => void,
    ): Adw.ComboRow {
        const row = new Adw.ComboRow({
            title,
            model: Gtk.StringList.new(choices.map((c) => c.label)),
        });
        const sync = () => {
            const value = choiceOr(choices, settings.get_string(key), fallback);
            const index = choices.findIndex((c) => c.id === value);
            if (row.selected !== index) {
                row.selected = index;
            }
        };
        sync();
        track(
            row,
            row.connect('notify::selected', () => {
                const choice = choices[row.selected];
                if (choice && settings.get_string(key) !== choice.id) {
                    settings.set_string(key, choice.id);
                }
            }),
        );
        track(settings, settings.connect(`changed::${key}`, sync));
        return row;
    }

    /// The Colors row, showing the picked pair's circle and leading on, and
    /// the page it leads to: a legend of the two features, Accent on its own
    /// row, then a swatch for each designed palette, in the shades of the
    /// current style.
    #colors(
        settings: Gio.Settings,
        track: (object: GObject.Object, id: number) => void,
    ): { row: Adw.ActionRow; page: Adw.NavigationPage } {
        const style = Adw.StyleManager.get_default();
        const look = () => ({ isDark: style.dark, accent: rgba(style.get_accent_color_rgba()) });
        const selected = (): PaletteId => {
            const value = settings.get_string(KEYS.palette);
            return isPaletteId(value) ? value : 'sunset';
        };

        const areas: Gtk.DrawingArea[] = [];
        const drawing = (
            size: number,
            draw: (cr: Cairo.Context, s: number, x: number, y: number) => void,
        ) => {
            const area = new Gtk.DrawingArea({
                content_width: size,
                content_height: size,
                halign: Gtk.Align.CENTER,
                valign: Gtk.Align.CENTER,
            });
            area.set_draw_func((_area, cr, width, height) => {
                const s = Math.min(width, height);
                draw(cr, s, (width - s) / 2, (height - s) / 2);
                cr.$dispose();
            });
            areas.push(area);
            return area;
        };
        const swatchArea = (palette: () => PaletteId, size = SWATCH_SIZE) =>
            drawing(size, (cr, s, x, y) => {
                const { isDark, accent } = look();
                const stt = gradient(palette(), 'stt', isDark, accent);
                const tts = gradient(palette(), 'tts', isDark, accent);
                swatch(cr, x, y, s, swatchColors(stt, tts));
            });
        const dot = (feature: Feature) =>
            drawing(DOT_SIZE, (cr, s, x, y) => {
                const { isDark, accent } = look();
                swatch(cr, x, y, s, gradient(selected(), feature, isDark, accent));
            });

        const row = new Adw.ActionRow({ title: 'Colors', activatable: true });
        row.add_suffix(swatchArea(selected, ROW_CIRCLE));
        row.add_suffix(new Gtk.Image({ icon_name: 'go-next-symbolic' }));

        const group = new Adw.PreferencesGroup({
            description: `Each pair gives ${FEATURE_NAMES.stt.toLowerCase()} one gradient and ${FEATURE_NAMES.tts.toLowerCase()} the other.`,
        });
        const legend = new Gtk.Box({ margin_bottom: 12 });
        for (const feature of ['stt', 'tts'] as const) {
            const entry = new Gtk.Box({ spacing: 6, hexpand: true });
            if (feature === 'tts') {
                entry.halign = Gtk.Align.END;
            }
            entry.append(dot(feature));
            entry.append(new Gtk.Label({ label: FEATURE_NAMES[feature] }));
            legend.append(entry);
        }
        group.add(legend);

        const accentCheck = new Gtk.Image({ icon_name: 'object-select-symbolic' });
        const accent = new Adw.ActionRow({
            title: 'Accent',
            subtitle: 'Follows your system color',
            activatable: true,
        });
        accent.add_prefix(swatchArea(() => 'accent'));
        accent.add_suffix(accentCheck);
        track(
            accent,
            accent.connect('activated', () => settings.set_string(KEYS.palette, 'accent')),
        );
        group.add(accent);

        const flow = new Gtk.FlowBox({
            selection_mode: Gtk.SelectionMode.NONE,
            max_children_per_line: 6,
            min_children_per_line: 6,
            homogeneous: true,
            column_spacing: 6,
            row_spacing: 6,
            margin_top: 12,
            margin_bottom: 6,
        });
        const buttons = PALETTES.filter((p) => p.id !== 'accent').map((palette) => {
            const button = new Gtk.ToggleButton({
                child: swatchArea(() => palette.id),
                tooltip_text: palette.label,
                halign: Gtk.Align.CENTER,
                css_classes: ['circular', 'flat'],
            });
            button.update_property([Gtk.AccessibleProperty.LABEL], [palette.label]);
            track(
                button,
                button.connect('clicked', () => {
                    settings.set_string(KEYS.palette, palette.id);
                    sync();
                }),
            );
            flow.append(button);
            return { id: palette.id, button };
        });
        group.add(flow);

        const redraw = () => {
            for (const area of areas) {
                area.queue_draw();
            }
        };
        const sync = () => {
            const picked = selected();
            accentCheck.visible = picked === 'accent';
            for (const { id, button } of buttons) {
                button.active = id === picked;
            }
            // The row's circle and the legend's dots show the picked pair.
            redraw();
        };
        sync();
        track(settings, settings.connect(`changed::${KEYS.palette}`, sync));
        track(style, style.connect('notify::dark', redraw));
        track(style, style.connect('notify::accent-color-rgba', redraw));

        const content = new Adw.PreferencesPage();
        content.add(group);
        const toolbar = new Adw.ToolbarView({ content });
        toolbar.add_top_bar(new Adw.HeaderBar());
        const page = new Adw.NavigationPage({ title: 'Colors', child: toolbar });
        return { row, page };
    }
}

function rgba(color: { red: number; green: number; blue: number; alpha: number }): Rgba {
    return { r: color.red, g: color.green, b: color.blue, a: color.alpha };
}
