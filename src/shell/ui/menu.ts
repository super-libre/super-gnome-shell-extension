// SPDX-License-Identifier: GPL-3.0-only
//! The indicator's menu: the port of the applet's popup (`src/ui/views.rs`
//! and `src/ui/sections/`). Its main page has, from the top: the extension's
//! name and version beside the buttons that open Super Voice and the
//! repository, the status while not connected, then the settings. The colors
//! are a page of their own, which slides in from the right.

import Clutter from 'gi://Clutter';
import type Gio from 'gi://Gio';
import St from 'gi://St';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import { Slider } from 'resource:///org/gnome/shell/ui/slider.js';
import {
    type Gradient,
    isPaletteId,
    PALETTES,
    type PaletteId,
    paletteLabel,
    swatchColors,
} from '../../core/palette.js';
import { FEATURE_NAMES, type Feature } from '../../core/protocol.js';
import {
    choiceOr,
    clampWidth,
    DEFAULTS,
    ICON_ALIGNMENTS,
    KEYS,
    MAX_WIDTH,
    MIN_WIDTH,
    POSITIONS,
    VISUALIZATION_STYLES,
    WORKING_ANIMATIONS,
} from '../../core/settings.js';
import { RETRY_AUTHORIZATION, type StatusText } from '../../core/status.js';
import { PageLink, PageStack } from './pages.js';
import { swatch } from './paint.js';

export interface MenuHost {
    settings: Gio.Settings;
    version: string;
    githubIcon: Gio.Icon;
    /// The gradients a palette draws the two features in, on this panel.
    gradients(palette: PaletteId): Record<Feature, Gradient>;
    retryAuthorization(): void;
    launchApp(): void;
    openRepository(): void;
    /// The size slider is being dragged, or was just let go.
    previewSize(dragging: boolean): void;
}

/// Put `caption` beside a submenu's title, before its arrow, the way the
/// shell's own submenus show their current value.
function insertCaption(submenu: PopupMenu.PopupSubMenuMenuItem, caption: St.Label): void {
    submenu.insert_child_at_index(caption, Math.max(submenu.get_n_children() - 1, 0));
}

/// How many swatches a row of the color picker holds.
const SWATCHES_PER_ROW = 6;
const SWATCH_SIZE = 28;
/// The picked palette's circle in the main page's Colors row: as tall as a
/// switch, so the row is as tall as the ones above it.
const ROW_CIRCLE = 24;

/// The menu's pages, in order.
const MAIN_PAGE = 0;
const COLORS_PAGE = 1;

export class IndicatorMenu {
    readonly #menu: PopupMenu.PopupMenu;
    readonly #host: MenuHost;
    readonly #pages = new PageStack();
    readonly #mainPage = new PopupMenu.PopupMenuSection();
    readonly #colorsPage = new PopupMenu.PopupMenuSection();
    readonly #status = new PopupMenu.PopupMenuSection();
    readonly #settingsSection = new PopupMenu.PopupMenuSection();
    readonly #settingsSeparator = new PopupMenu.PopupSeparatorMenuItem();
    readonly #statusSeparator = new PopupMenu.PopupSeparatorMenuItem();
    /// The header's button that opens Super Voice, there while it's installed.
    #launch: St.Button | null = null;
    #settingsHandler = 0;
    #openStateHandler = 0;
    /// Redraws everything that shows a setting's value.
    readonly #refreshers: (() => void)[] = [];
    readonly #swatches: St.DrawingArea[] = [];

    constructor(menu: PopupMenu.PopupMenu, host: MenuHost) {
        this.#menu = menu;
        this.#host = host;
        menu.box.add_style_class_name('super-voice-menu');

        const main = this.#mainPage;
        main.addMenuItem(this.#header());
        main.addMenuItem(this.#statusSeparator);
        main.addMenuItem(this.#status);
        main.addMenuItem(this.#settingsSeparator);
        main.addMenuItem(this.#settingsSection);
        this.#buildSettings();
        this.#buildColorsPage();

        // Both pages are sections of the menu, so their items activate and
        // close it as any item does; their actors move into the stack that
        // slides one over the other.
        menu.addMenuItem(main);
        menu.addMenuItem(this.#colorsPage);
        for (const page of [main, this.#colorsPage]) {
            menu.box.remove_child(page.actor);
            this.#pages.add_child(page.actor);
        }
        this.#colorsPage.actor.visible = false;
        menu.box.add_child(this.#pages);

        // The menu opens again on its main page.
        this.#openStateHandler = menu.connect('open-state-changed', (_menu, open: boolean) => {
            if (!open) {
                this.#pages.turnTo(MAIN_PAGE, false);
            }
        });

        this.#settingsHandler = host.settings.connect('changed', () => this.refresh());
        this.refresh();
    }

    /// Show `status`, or none; the settings while connected, and the button
    /// that opens Super Voice while it's installed, as the applet does.
    update(status: StatusText | null, installed: boolean, connected: boolean): void {
        this.#status.removeAll();
        if (status !== null) {
            const box = new St.BoxLayout({
                orientation: Clutter.Orientation.VERTICAL,
                style_class: 'super-voice-status',
                x_expand: true,
            });
            box.add_child(
                new St.Label({ text: status.title, style_class: 'super-voice-status-title' }),
            );
            for (const line of status.details) {
                box.add_child(
                    new St.Label({ text: line, style_class: 'super-voice-status-detail' }),
                );
            }
            const item = new PopupMenu.PopupBaseMenuItem({
                activate: false,
                hover: false,
                can_focus: false,
            });
            item.add_child(box);
            this.#status.addMenuItem(item);
            if (status.canRetryAuthorization) {
                const retry = new PopupMenu.PopupMenuItem(RETRY_AUTHORIZATION);
                retry.connect('activate', () => this.#host.retryAuthorization());
                this.#status.addMenuItem(retry);
            }
        }
        this.#statusSeparator.visible = status !== null;
        this.#status.actor.visible = status !== null;
        this.#settingsSection.actor.visible = connected;
        this.#settingsSeparator.visible = connected;
        if (this.#launch) {
            this.#launch.visible = installed;
        }
    }

    /// The panel's look changed: redraw the swatches in its shades.
    redrawSwatches(): void {
        for (const area of this.#swatches) {
            area.queue_repaint();
        }
    }

    /// Bring every control in line with the settings.
    refresh(): void {
        for (const refresh of this.#refreshers) {
            refresh();
        }
    }

    destroy(): void {
        if (this.#settingsHandler !== 0) {
            this.#host.settings.disconnect(this.#settingsHandler);
            this.#settingsHandler = 0;
        }
        if (this.#openStateHandler !== 0) {
            this.#menu.disconnect(this.#openStateHandler);
            this.#openStateHandler = 0;
        }
        this.#swatches.length = 0;
        this.#refreshers.length = 0;
    }

    #header(): PopupMenu.PopupBaseMenuItem {
        const item = new PopupMenu.PopupBaseMenuItem({
            activate: false,
            hover: false,
            can_focus: false,
            style_class: 'super-voice-header',
        });
        const titles = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        titles.add_child(new St.Label({ text: 'Super Voice', style_class: 'super-voice-title' }));
        titles.add_child(
            new St.Label({ text: `v${this.#host.version}`, style_class: 'super-voice-version' }),
        );
        // Super Voice's app, by the icon its desktop entry gives it, beside
        // the repository's: the applet's header, which has no row of its own
        // for the app below the settings.
        const launch = new St.Button({
            style_class: 'super-voice-icon-button',
            accessible_name: 'Open Super Voice',
            can_focus: true,
            child: new St.Icon({
                icon_name: 'super-voice-app',
                fallback_icon_name: 'application-x-executable',
                icon_size: 20,
            }),
            y_align: Clutter.ActorAlign.CENTER,
        });
        launch.connect('clicked', () => {
            this.#menu.close();
            this.#host.launchApp();
        });
        this.#launch = launch;
        const github = new St.Button({
            style_class: 'super-voice-icon-button',
            accessible_name: 'View on GitHub',
            can_focus: true,
            child: new St.Icon({ gicon: this.#host.githubIcon, icon_size: 20 }),
            y_align: Clutter.ActorAlign.CENTER,
        });
        github.connect('clicked', () => {
            this.#menu.close();
            this.#host.openRepository();
        });
        item.add_child(titles);
        item.add_child(launch);
        item.add_child(github);
        return item;
    }

    #buildSettings(): void {
        const settings = this.#host.settings;
        const section = this.#settingsSection;

        section.addMenuItem(
            this.#choiceSubmenu('Position', POSITIONS, KEYS.position, DEFAULTS.position),
        );

        const showIcon = new PopupMenu.PopupSwitchMenuItem('Show Icon', true);
        showIcon.connect('toggled', (_item, state: boolean) => {
            settings.set_boolean(KEYS.showIcon, state);
        });
        section.addMenuItem(showIcon);

        const position = this.#segmentedRow('Icon Position', ICON_ALIGNMENTS, KEYS.iconAlignment);
        section.addMenuItem(position);

        section.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const showVisualization = new PopupMenu.PopupSwitchMenuItem('Show Visualization', true);
        showVisualization.connect('toggled', (_item, state: boolean) => {
            settings.set_boolean(KEYS.showVisualization, state);
        });
        section.addMenuItem(showVisualization);

        const size = this.#sizeRow();
        section.addMenuItem(size);

        const style = this.#choiceSubmenu(
            'Visualization Style',
            VISUALIZATION_STYLES,
            KEYS.visualizationStyle,
            DEFAULTS.visualizationStyle,
        );
        section.addMenuItem(style);

        const animation = this.#choiceSubmenu(
            'Loading Animation',
            WORKING_ANIMATIONS,
            KEYS.workingAnimation,
            DEFAULTS.workingAnimation,
        );
        section.addMenuItem(animation);

        const colors = this.#colorsRow();
        section.addMenuItem(colors);

        this.#refreshers.push(() => {
            const iconOn = settings.get_boolean(KEYS.showIcon);
            const visualizationOn = settings.get_boolean(KEYS.showVisualization);
            showIcon.setToggleState(iconOn);
            position.visible = iconOn;
            showVisualization.setToggleState(visualizationOn);
            size.visible = visualizationOn;
            style.visible = visualizationOn;
            animation.visible = visualizationOn;
            colors.visible = visualizationOn;
        });
    }

    /// A row of buttons, one per choice, the chosen one checked.
    #segmentedRow(
        title: string,
        choices: readonly { id: string; label: string }[],
        key: string,
    ): PopupMenu.PopupBaseMenuItem {
        const settings = this.#host.settings;
        const item = new PopupMenu.PopupBaseMenuItem({
            activate: false,
            hover: false,
            can_focus: false,
        });
        item.add_child(
            new St.Label({ text: title, x_expand: true, y_align: Clutter.ActorAlign.CENTER }),
        );
        const group = new St.BoxLayout({ style_class: 'super-voice-segmented' });
        const buttons = choices.map((choice) => {
            const button = new St.Button({
                label: choice.label,
                style_class: 'super-voice-segment',
                can_focus: true,
                toggle_mode: false,
            });
            button.connect('clicked', () => settings.set_string(key, choice.id));
            group.add_child(button);
            return { id: choice.id, button };
        });
        item.add_child(group);
        this.#refreshers.push(() => {
            const value = settings.get_string(key);
            for (const { id, button } of buttons) {
                button.checked = id === value;
            }
        });
        return item;
    }

    /// The visualization's length: a slider from 60 to 300 px, with a live
    /// preview of the box on the panel while it moves.
    #sizeRow(): PopupMenu.PopupBaseMenuItem {
        const settings = this.#host.settings;
        const item = new PopupMenu.PopupBaseMenuItem({
            activate: false,
            style_class: 'super-voice-size',
        });
        const column = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
        });
        const header = new St.BoxLayout({ x_expand: true });
        header.add_child(new St.Label({ text: 'Visualization Size', x_expand: true }));
        const value = new St.Label({ style_class: 'super-voice-caption' });
        header.add_child(value);
        const slider = new Slider(0);
        slider.x_expand = true;
        slider.accessible_name = 'Visualization Size';
        column.add_child(header);
        column.add_child(slider);
        item.add_child(column);

        const toValue = (width: number) => (width - MIN_WIDTH) / (MAX_WIDTH - MIN_WIDTH);
        const toWidth = (v: number) => clampWidth(MIN_WIDTH + v * (MAX_WIDTH - MIN_WIDTH));
        let updating = false;
        slider.connect('notify::value', () => {
            if (updating) {
                return;
            }
            const width = toWidth(slider.value);
            value.text = `${width}px`;
            if (settings.get_int(KEYS.appletWidth) !== width) {
                settings.set_int(KEYS.appletWidth, width);
            }
            this.#host.previewSize(true);
        });
        // The shell's slider emits these, though its types don't say so.
        const draggable = slider as unknown as { connect(signal: string, cb: () => void): number };
        draggable.connect('drag-begin', () => this.#host.previewSize(true));
        draggable.connect('drag-end', () => this.#host.previewSize(false));
        // Keyboard and scroll changes have no drag to end.
        slider.connect('scroll-event', () => {
            this.#host.previewSize(false);
            return Clutter.EVENT_PROPAGATE;
        });
        item.connect('key-press-event', (_actor, event: Clutter.Event) =>
            slider.vfunc_key_press_event(event),
        );
        this.#refreshers.push(() => {
            const width = clampWidth(settings.get_int(KEYS.appletWidth));
            value.text = `${width}px`;
            updating = true;
            slider.value = toValue(width);
            updating = false;
        });
        return item;
    }

    /// A submenu of choices, the chosen one checked, its label beside the
    /// title.
    #choiceSubmenu<Id extends string>(
        title: string,
        choices: readonly { id: Id; label: string }[],
        key: string,
        fallback: Id,
    ): PopupMenu.PopupSubMenuMenuItem {
        const settings = this.#host.settings;
        const submenu = new PopupMenu.PopupSubMenuMenuItem(title, false);
        const current = new St.Label({
            style_class: 'super-voice-caption',
            y_align: Clutter.ActorAlign.CENTER,
        });
        insertCaption(submenu, current);
        const items = choices.map((choice) => {
            const item = new PopupMenu.PopupMenuItem(choice.label);
            item.connect('activate', () => settings.set_string(key, choice.id));
            submenu.menu.addMenuItem(item);
            return { id: choice.id, item };
        });
        this.#refreshers.push(() => {
            const value = choiceOr(choices, settings.get_string(key), fallback);
            current.text = choices.find((c) => c.id === value)?.label ?? '';
            for (const { id, item } of items) {
                item.setOrnament(id === value ? PopupMenu.Ornament.CHECK : PopupMenu.Ornament.NONE);
            }
        });
        return submenu;
    }

    /// Turn to `page`. Someone moving through the menu by keyboard lands on
    /// the new page's first row.
    #turnTo(page: number): void {
        const focus = global.stage.get_key_focus();
        const fromKeyboard = focus !== null && this.#menu.box.contains(focus);
        this.#pages.turnTo(page, true);
        if (fromKeyboard) {
            // A section's actor is its St.BoxLayout, though typed as an actor.
            const actor = (page === COLORS_PAGE ? this.#colorsPage : this.#mainPage)
                .actor as St.Widget;
            actor.navigate_focus(null, St.DirectionType.TAB_FORWARD, false);
        }
    }

    #selectedPalette(): PaletteId {
        const value = this.#host.settings.get_string(KEYS.palette);
        return isPaletteId(value) ? value : 'sunset';
    }

    /// The Colors setting, on the main page: the picked pair's circle, and
    /// an arrow saying the palettes are a page of their own.
    #colorsRow(): PageLink {
        const row = new PageLink(() => this.#turnTo(COLORS_PAGE), 'super-voice-colors-row');
        row.add_child(
            new St.Label({ text: 'Colors', x_expand: true, y_align: Clutter.ActorAlign.CENTER }),
        );
        const circle = this.#swatchArea(() => this.#selectedPalette(), ROW_CIRCLE);
        circle.y_align = Clutter.ActorAlign.CENTER;
        row.add_child(circle);
        row.add_child(PopupMenu.arrowIcon(St.Side.RIGHT));
        row.accessible_name = 'Colors';
        return row;
    }

    /// The Colors page: the way back to the main page, under the page's
    /// name, then a legend of the two features, the Accent choice, and the
    /// designed palettes as swatches, six to a row.
    #buildColorsPage(): void {
        const settings = this.#host.settings;
        const page = this.#colorsPage;

        // The page's name, as large as the extension's on the main page,
        // behind an arrow back to it. The picked palette's name sits at the
        // far end; hovering a swatch names that one instead, as the shell
        // has no tooltips.
        const back = new PageLink(() => this.#turnTo(MAIN_PAGE), 'super-voice-back');
        back.add_child(PopupMenu.arrowIcon(St.Side.LEFT));
        back.add_child(
            new St.Label({
                text: 'Colors',
                style_class: 'super-voice-title',
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
            }),
        );
        const current = new St.Label({
            style_class: 'super-voice-caption',
            y_align: Clutter.ActorAlign.CENTER,
        });
        back.add_child(current);
        back.accessible_name = 'Back';
        page.addMenuItem(back);
        page.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const panel = new PopupMenu.PopupBaseMenuItem({
            activate: false,
            hover: false,
            can_focus: false,
            style_class: 'super-voice-colors',
        });
        const column = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            style_class: 'super-voice-colors-column',
        });

        // Which feature each color in a pair is.
        const legend = new St.BoxLayout({ style_class: 'super-voice-legend', x_expand: true });
        const legendEntry = (feature: Feature) => {
            const entry = new St.BoxLayout({ style_class: 'super-voice-legend-entry' });
            entry.add_child(this.#dot(feature));
            entry.add_child(
                new St.Label({ text: FEATURE_NAMES[feature], y_align: Clutter.ActorAlign.CENTER }),
            );
            return entry;
        };
        legend.add_child(legendEntry('stt'));
        legend.add_child(new St.Widget({ x_expand: true }));
        legend.add_child(legendEntry('tts'));
        column.add_child(legend);

        // Accent, on a row of its own: it takes the system's color where the
        // others have colors of their own.
        const accent = new St.Button({
            style_class: 'super-voice-accent-choice',
            can_focus: true,
            x_expand: true,
            accessible_name: 'Accent',
        });
        const accentBox = new St.BoxLayout({ x_expand: true });
        accentBox.add_child(this.#swatchArea(() => 'accent'));
        const accentText = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'super-voice-accent-text',
        });
        accentText.add_child(new St.Label({ text: 'Accent' }));
        accentText.add_child(
            new St.Label({ text: 'Follows your system color', style_class: 'super-voice-caption' }),
        );
        accentBox.add_child(accentText);
        accent.set_child(accentBox);
        accent.connect('clicked', () => settings.set_string(KEYS.palette, 'accent'));
        column.add_child(accent);

        // The designed palettes. Picking one stays on this page.
        const designed = PALETTES.filter((p) => p.id !== 'accent');
        const buttons: { id: PaletteId; button: St.Button }[] = [{ id: 'accent', button: accent }];
        for (let i = 0; i < designed.length; i += SWATCHES_PER_ROW) {
            const row = new St.BoxLayout({ style_class: 'super-voice-swatch-row', x_expand: true });
            for (const palette of designed.slice(i, i + SWATCHES_PER_ROW)) {
                const button = new St.Button({
                    style_class: 'super-voice-swatch',
                    can_focus: true,
                    accessible_name: palette.label,
                    x_expand: true,
                    x_align: Clutter.ActorAlign.CENTER,
                    child: this.#swatchArea(() => palette.id),
                });
                button.connect('clicked', () => settings.set_string(KEYS.palette, palette.id));
                button.connect('notify::hover', () => {
                    current.text = button.hover
                        ? palette.label
                        : paletteLabel(this.#selectedPalette());
                });
                row.add_child(button);
                buttons.push({ id: palette.id, button });
            }
            column.add_child(row);
        }

        panel.add_child(column);
        page.addMenuItem(panel);

        this.#refreshers.push(() => {
            const id = this.#selectedPalette();
            current.text = paletteLabel(id);
            for (const { id: buttonId, button } of buttons) {
                button.checked = buttonId === id;
            }
            this.redrawSwatches();
        });
    }

    /// A swatch of `palette()`, `size` wide: both features' gradients on one
    /// disc.
    #swatchArea(palette: () => PaletteId, size = SWATCH_SIZE): St.DrawingArea {
        const area = new St.DrawingArea({
            style_class: 'super-voice-swatch-area',
            width: size,
            height: size,
        });
        area.connect('repaint', () => {
            const cr = area.get_context();
            try {
                const [w, h] = area.get_surface_size();
                const size = Math.min(w, h);
                const { stt, tts } = this.#host.gradients(palette());
                swatch(cr, (w - size) / 2, (h - size) / 2, size, swatchColors(stt, tts));
            } finally {
                cr.$dispose();
            }
        });
        this.#swatches.push(area);
        return area;
    }

    /// The legend's dot: one feature's gradient in the selected palette.
    #dot(feature: Feature): St.DrawingArea {
        const area = new St.DrawingArea({
            width: 10,
            height: 10,
            y_align: Clutter.ActorAlign.CENTER,
        });
        area.connect('repaint', () => {
            const cr = area.get_context();
            try {
                const [w, h] = area.get_surface_size();
                const gradient = this.#host.gradients(this.#selectedPalette())[feature];
                swatch(cr, 0, 0, Math.min(w, h), gradient);
            } finally {
                cr.$dispose();
            }
        });
        this.#swatches.push(area);
        return area;
    }
}
