// SPDX-License-Identifier: GPL-3.0-only
//! Ties the daemon's events, the model and the settings to the top bar.
//!
//! The extension shows as one button in the status area, or as two halves
//! around the clock that read as one picture: the COSMIC applet's left and
//! right halves, here in one process. Each half has its own menu, with the
//! same contents, so a click on either opens it under that half.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import type Cairo from 'cairo';
import { drawAnimation } from '../core/draw/animations.js';
import type { Bounds, Side } from '../core/draw/ops.js';
import { drawVisualization } from '../core/draw/visualizations.js';
import { toDaemonEvent } from '../core/events.js';
import { contentSize, iconSize } from '../core/layout.js';
import { ALTERNATE_MS, type Effects, Model } from '../core/model.js';
import { gradient, isPaletteId, type PaletteId } from '../core/palette.js';
import { type Env, socketPath, tokenPath } from '../core/paths.js';
import { flankClock, flanksClock } from '../core/placement.js';
import {
    DAEMON_BINARY,
    FEATURE_NAMES,
    type Feature,
    INSTALL_DIRS,
    REPOSITORY_URL,
    SETTINGS_APP,
} from '../core/protocol.js';
import {
    choiceOr,
    clampWidth,
    DEFAULTS,
    ICON_ALIGNMENTS,
    KEYS,
    POSITIONS,
    VISUALIZATION_STYLES,
    WORKING_ANIMATIONS,
} from '../core/settings.js';
import { statusText } from '../core/status.js';
import { errorMessage, nowMs } from './async.js';
import { DaemonHttp } from './daemon/http.js';
import { type Logger, Session } from './daemon/session.js';
import { Subscription, type Update } from './daemon/subscription.js';
import { Indicator } from './ui/indicator.js';
import { IndicatorMenu, type MenuHost } from './ui/menu.js';
import { play, roundRect } from './ui/paint.js';
import { type PanelLook, panelLook } from './ui/theme.js';

/// How long the size preview stays after the slider stops.
const SIZE_PREVIEW_LINGER_MS = 1_200;

/// What the meters are showing.
type Mode = 'visualization' | 'animation' | 'preview' | 'icon';

const SIDE_NAMES: Record<Side, string> = {
    full: '',
    left: ' (left half)',
    right: ' (right half)',
};

export interface ControllerOptions {
    uuid: string;
    /// The extension's directory, where its icons are.
    path: string;
    version: string;
    settings: Gio.Settings;
    logger: Logger;
}

type Handler = { object: { disconnect(id: number): void }; id: number };

/// One button in the top bar: the whole picture, or one half of it.
interface Half {
    side: Side;
    indicator: Indicator;
    menu: IndicatorMenu;
    /// Whether the panel has laid it out yet.
    laidOut: boolean;
    handlers: Handler[];
}

export class Controller {
    readonly #uuid: string;
    readonly #settings: Gio.Settings;
    readonly #logger: Logger;
    readonly #model = new Model(nowMs);
    readonly #http: DaemonHttp;
    readonly #subscription: Subscription;
    readonly #menuHost: MenuHost;
    readonly #appIcon: Gio.Icon;
    readonly #errorIcon: Gio.Icon;
    #halves: Half[] = [];
    #look: PanelLook = {
        isDark: true,
        foreground: { r: 1, g: 1, b: 1, a: 1 },
        accent: { r: 0x35 / 255, g: 0x84 / 255, b: 0xe4 / 255, a: 1 },
    };
    #lookRead = false;
    #mode: Mode = 'icon';
    #alternateTimer = 0;
    #previewTimer = 0;
    #renderSource = 0;
    #rebuildSource = 0;
    #hugSource = 0;
    /// What the halves watch to stay around the clock: the clock, for a move
    /// to another box, and the box it's in, for anything put beside it.
    #clockWatch: Handler[] = [];
    #previewUntil = 0;
    #previewDragging = false;
    #handlers: Handler[] = [];

    constructor(options: ControllerOptions) {
        this.#uuid = options.uuid;
        this.#settings = options.settings;
        this.#logger = options.logger;
        this.#appIcon = Gio.FileIcon.new(
            Gio.File.new_for_path(`${options.path}/icons/super-voice.svg`),
        );
        this.#errorIcon = Gio.ThemedIcon.new_from_names([
            'microphone-disabled-symbolic',
            'dialog-warning-symbolic',
        ]);

        const env: Env = {
            getenv: (name) => GLib.getenv(name),
            uid: new Gio.Credentials().get_unix_user(),
            home: GLib.get_home_dir(),
        };
        const socket = socketPath(env);
        this.#logger.log(`Super Voice socket: ${socket}`);
        this.#http = new DaemonHttp(socket);
        const session = new Session(this.#http, tokenPath(env), options.version, this.#logger);
        this.#subscription = new Subscription(
            this.#http,
            session,
            (update) => this.#onUpdate(update),
            this.#logger,
        );

        this.#menuHost = {
            settings: this.#settings,
            version: options.version,
            githubIcon: Gio.FileIcon.new(
                Gio.File.new_for_path(`${options.path}/icons/github-symbolic.svg`),
            ),
            gradients: (palette) => ({
                stt: this.#gradientFor(palette, 'stt'),
                tts: this.#gradientFor(palette, 'tts'),
            }),
            retryAuthorization: () => this.#retryAuthorization(),
            launchApp: () => this.#launchApp(),
            openRepository: () => this.#openRepository(),
            previewSize: (dragging) => this.#previewSize(dragging),
        };

        this.#handlers.push({
            object: this.#settings,
            id: this.#settings.connect('changed', (_settings, key: string) => {
                if (key === KEYS.position) {
                    this.#scheduleRebuild();
                } else {
                    this.#scheduleRender();
                }
            }),
        });

        // The first render waits for the panel to lay the halves out: their
        // height sizes the icon, and St and Clutter want an allocation before
        // an icon loads or the theme is read.
        this.#model.setInstalled(this.#isInstalled());
        this.#build();
        this.#subscription.start();
    }

    destroy(): void {
        this.#subscription.stop();
        this.#http.close();
        for (const source of [
            this.#alternateTimer,
            this.#previewTimer,
            this.#renderSource,
            this.#rebuildSource,
            this.#hugSource,
        ]) {
            if (source !== 0) {
                GLib.source_remove(source);
            }
        }
        this.#alternateTimer = 0;
        this.#previewTimer = 0;
        this.#renderSource = 0;
        this.#rebuildSource = 0;
        this.#hugSource = 0;
        for (const { object, id } of this.#handlers) {
            object.disconnect(id);
        }
        this.#handlers = [];
        this.#teardown();
    }

    /// Put the buttons the position setting asks for in the top bar.
    #build(): void {
        const position = choiceOr(
            POSITIONS,
            this.#settings.get_string(KEYS.position),
            DEFAULTS.position,
        );
        if (position === 'clock') {
            const left = this.#makeHalf('left');
            const right = this.#makeHalf('right');
            this.#halves = [left, right];
            this.#placeAroundClock(left.indicator, right.indicator);
        } else {
            const full = this.#makeHalf('full');
            this.#halves = [full];
            Main.panel.addToStatusArea(this.#uuid, full.indicator);
        }
    }

    #makeHalf(side: Side): Half {
        const indicator = new Indicator();
        indicator.meter.setPainter((cr, w, h) => this.#paint(cr, w, h, side));
        const menu = new IndicatorMenu(indicator.menu as never, this.#menuHost);
        const half: Half = { side, indicator, menu, laidOut: false, handlers: [] };
        half.handlers.push({
            object: indicator,
            id: indicator.connect('style-changed', () => this.#readLook()),
        });
        half.handlers.push({
            object: indicator.box,
            id: indicator.box.connect('notify::height', () => {
                if (indicator.box.height > 0) {
                    half.laidOut = true;
                }
                this.#scheduleRender();
            }),
        });
        return half;
    }

    /// The left half just before the clock, the right half just after it,
    /// wherever the clock is: in the middle of the top bar, or wherever
    /// another extension has moved it since. Without a clock the halves stay
    /// together in the middle, as one picture.
    #placeAroundClock(left: Indicator, right: Indicator): void {
        // The panel registers the halves, for their menus and the session's
        // modes, as it does any indicator; then they move beside the clock.
        Main.panel.addToStatusArea(`${this.#uuid}-left`, left, 0, 'center');
        Main.panel.addToStatusArea(`${this.#uuid}-right`, right, 1, 'center');
        this.#watchClock();
        this.#hugClock();
    }

    /// Keep watching the clock and the box it's in, to follow it there.
    #watchClock(): void {
        this.#unwatchClock();
        const clock = Main.panel.statusArea.dateMenu?.container;
        if (!clock) {
            return;
        }
        this.#clockWatch.push({
            object: clock,
            id: clock.connect('parent-set', () => {
                this.#watchClock();
                this.#scheduleHug();
            }),
        });
        const box = clock.get_parent();
        if (box) {
            this.#clockWatch.push({
                object: box,
                id: box.connect('child-added', () => this.#scheduleHug()),
            });
        }
    }

    #unwatchClock(): void {
        for (const { object, id } of this.#clockWatch) {
            object.disconnect(id);
        }
        this.#clockWatch = [];
    }

    /// Move the halves around the clock once the main loop is idle, so an
    /// extension moving the clock has finished before they follow.
    #scheduleHug(): void {
        if (this.#hugSource !== 0) {
            return;
        }
        this.#hugSource = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            this.#hugSource = 0;
            this.#hugClock();
            return GLib.SOURCE_REMOVE;
        });
    }

    #hugClock(): void {
        const [left, right] = this.#halves;
        if (left?.side !== 'left' || right?.side !== 'right') {
            return;
        }
        const l = left.indicator.container;
        const r = right.indicator.container;
        const clock = Main.panel.statusArea.dateMenu?.container;
        // The clock's box, or with no clock, the middle of the top bar.
        const box =
            clock?.get_parent() ??
            (Main.panel as unknown as { _centerBox?: St.BoxLayout })._centerBox ??
            null;
        if (!box) {
            return;
        }
        if (clock && flanksClock(box.get_children(), clock, l, r)) {
            return;
        }
        for (const half of [l, r]) {
            const parent = half.get_parent();
            if (parent !== box) {
                parent?.remove_child(half);
                box.add_child(half);
            }
        }
        // Reordering adds no child, so the box's watch doesn't fire again.
        const order = flankClock(box.get_children(), clock ?? null, l, r);
        box.set_child_at_index(l, order.indexOf(l));
        box.set_child_at_index(r, order.indexOf(r));
    }

    #teardown(): void {
        this.#unwatchClock();
        if (this.#hugSource !== 0) {
            GLib.source_remove(this.#hugSource);
            this.#hugSource = 0;
        }
        for (const half of this.#halves) {
            for (const { object, id } of half.handlers) {
                object.disconnect(id);
            }
            half.menu.destroy();
            half.indicator.destroy();
        }
        this.#halves = [];
        this.#lookRead = false;
    }

    /// Rebuild for a new position, once the main loop is idle: the change may
    /// come from a menu item of a button the rebuild destroys.
    #scheduleRebuild(): void {
        if (this.#rebuildSource !== 0) {
            return;
        }
        this.#rebuildSource = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            this.#rebuildSource = 0;
            this.#teardown();
            this.#build();
            return GLib.SOURCE_REMOVE;
        });
    }

    #onUpdate(update: Update): void {
        switch (update.kind) {
            case 'connected':
                this.#logger.log('Connected to Super Voice');
                // Something answered on the socket, so the daemon is there,
                // wherever it is installed.
                this.#apply(this.#model.setInstalled(true));
                this.#apply(this.#model.setConnection({ kind: 'connected' }));
                break;
            case 'asking':
                this.#apply(this.#model.setConnection({ kind: 'asking' }));
                break;
            case 'disconnected':
                if (this.#model.connection.kind === 'connected') {
                    this.#logger.log(`Lost Super Voice: ${update.reason}`);
                }
                this.#apply(this.#model.setInstalled(this.#isInstalled()));
                this.#apply(this.#model.setConnection({ kind: 'connecting' }));
                break;
            case 'needs-permission':
                this.#logger.log(`Super Voice gave no session yet: ${update.reason}`);
                this.#apply(
                    this.#model.setConnection({ kind: 'needs-permission', reason: update.reason }),
                );
                break;
            case 'revoked':
                this.#logger.log(`Super Voice withdrew the session: ${update.reason}`);
                this.#apply(this.#model.setConnection({ kind: 'error', message: update.reason }));
                break;
            case 'blocked':
                this.#logger.warn(`Super Voice denied the extension a session: ${update.reason}`);
                this.#apply(this.#model.setConnection({ kind: 'blocked', reason: update.reason }));
                break;
            case 'event': {
                const event = toDaemonEvent(update.event);
                const effects = this.#model.apply(event);
                // A new frame of bands only needs the bars redrawn.
                if (event.kind === 'bands' && !effects.frontChanged && !effects.clearBars) {
                    if (effects.redraw && this.#mode === 'visualization') {
                        for (const half of this.#halves) {
                            half.indicator.meter.queue_repaint();
                        }
                    }
                } else {
                    this.#apply(effects);
                }
                break;
            }
        }
    }

    #apply(effects: Effects): void {
        if (effects.redraw || effects.frontChanged || effects.clearBars) {
            this.#scheduleRender();
        }
    }

    /// Render once the main loop is idle, so a burst of events renders once.
    /// A half renders only once the panel has laid it out. Not gated on
    /// `has_allocation()`, which is false whenever a relayout is pending, as
    /// it is right after a render that changed the icon: the state that
    /// follows would never be drawn.
    #scheduleRender(): void {
        if (this.#renderSource !== 0) {
            return;
        }
        this.#renderSource = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            this.#renderSource = 0;
            this.#render();
            return GLib.SOURCE_REMOVE;
        });
    }

    /// Put the model and settings on screen.
    #render(): void {
        const model = this.#model;
        const settings = this.#settings;
        const ready = this.#halves.filter((h) => h.laidOut && h.indicator.get_stage());
        if (ready.length === 0) {
            return;
        }
        if (!this.#lookRead) {
            this.#readLook();
        }
        const showVisualization = settings.get_boolean(KEYS.showVisualization);
        const showIcon = settings.get_boolean(KEYS.showIcon);
        const alignment = choiceOr(
            ICON_ALIGNMENTS,
            settings.get_string(KEYS.iconAlignment),
            DEFAULTS.iconAlignment,
        );
        const width = clampWidth(settings.get_int(KEYS.appletWidth));

        const front = model.front;
        const phase = front === null ? null : model.phase(front);
        let mode: Mode = 'icon';
        if (showVisualization && phase?.hasLiveAudio) {
            mode = 'visualization';
        } else if (showVisualization && phase?.isWorking) {
            mode = 'animation';
        } else if (this.#previewing()) {
            mode = 'preview';
        }
        this.#mode = mode;
        const gicon = model.needsAttention ? this.#errorIcon : showIcon ? this.#appIcon : null;

        for (const { side, indicator } of ready) {
            // The box: as long as the setting while visualizations are on,
            // else square, and as tall as the panel lets it be.
            const height = Math.max(indicator.box.height / this.#scale(), 16);
            const content = contentSize(height, showVisualization, width);
            indicator.setBoxSize(content.width, null);
            indicator.setIcon(mode === 'icon' ? gicon : null, iconSize(content), alignment);
            indicator.showMeter(mode !== 'icon');
            if (mode === 'animation') {
                indicator.meter.startAnimating();
            } else {
                indicator.meter.stopAnimating();
            }
            indicator.meter.queue_repaint();
            indicator.accessible_name = this.#accessibleName(front, mode) + SIDE_NAMES[side];
        }

        this.#syncAlternation();
        const status = statusText(model.installed, model.connection);
        for (const { menu } of this.#halves) {
            menu.update(status, model.installed, model.connection.kind === 'connected');
        }
    }

    #paint(cr: Cairo.Context, width: number, height: number, side: Side): void {
        const bounds: Bounds = { x: 0, y: 0, w: width, h: height };
        const model = this.#model;
        const settings = this.#settings;
        switch (this.#mode) {
            case 'visualization': {
                const style = choiceOr(
                    VISUALIZATION_STYLES,
                    settings.get_string(KEYS.visualizationStyle),
                    DEFAULTS.visualizationStyle,
                );
                const ops = drawVisualization(style, {
                    bounds,
                    bands: model.bands,
                    totalEnergy: model.totalEnergy,
                    side,
                });
                play(cr, ops, bounds, this.#gradientFor(this.#palette(), model.shown));
                break;
            }
            case 'animation': {
                const front = model.front;
                const elapsed = front === null ? 0 : (model.phase(front).animationElapsedMs() ?? 0);
                const kind = choiceOr(
                    WORKING_ANIMATIONS,
                    settings.get_string(KEYS.workingAnimation),
                    DEFAULTS.workingAnimation,
                );
                play(
                    cr,
                    drawAnimation(kind, bounds, elapsed, side),
                    bounds,
                    this.#gradientFor(this.#palette(), model.shown),
                );
                break;
            }
            case 'preview': {
                const fg = this.#look.foreground;
                cr.setSourceRGBA(fg.r, fg.g, fg.b, 0.22);
                roundRect(cr, 0, 0, width, height, 6);
                cr.fill();
                break;
            }
            case 'icon':
                break;
        }
    }

    #palette(): PaletteId {
        const value = this.#settings.get_string(KEYS.palette);
        return isPaletteId(value) ? value : 'sunset';
    }

    #gradientFor(palette: PaletteId, feature: Feature) {
        return gradient(palette, feature, this.#look.isDark, this.#look.accent);
    }

    /// Read the panel's look from the first half on stage.
    #readLook(): void {
        const half = this.#halves.find((h) => h.indicator.get_stage());
        if (half === undefined) {
            return;
        }
        this.#look = panelLook(half.indicator);
        this.#lookRead = true;
        for (const { indicator, menu } of this.#halves) {
            indicator.meter.queue_repaint();
            menu.redrawSwatches();
        }
    }

    /// Stage pixels per logical pixel, which the theme's lengths are in.
    #scale(): number {
        return Math.max(St.ThemeContext.get_for_stage(global.stage).scale_factor, 1);
    }

    /// Run the alternation timer only while both features are active.
    #syncAlternation(): void {
        const both = this.#model.bothActive;
        if (both && this.#alternateTimer === 0) {
            this.#alternateTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ALTERNATE_MS, () => {
                this.#apply(this.#model.alternateFront());
                return GLib.SOURCE_CONTINUE;
            });
        } else if (!both && this.#alternateTimer !== 0) {
            GLib.source_remove(this.#alternateTimer);
            this.#alternateTimer = 0;
        }
    }

    #previewing(): boolean {
        return this.#previewDragging || nowMs() < this.#previewUntil;
    }

    /// Show the box's new size on the panel while the slider moves, and for a
    /// moment after.
    #previewSize(dragging: boolean): void {
        this.#previewDragging = dragging;
        this.#previewUntil = nowMs() + SIZE_PREVIEW_LINGER_MS;
        if (this.#previewTimer === 0) {
            this.#previewTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
                if (this.#previewing()) {
                    return GLib.SOURCE_CONTINUE;
                }
                this.#previewTimer = 0;
                this.#scheduleRender();
                return GLib.SOURCE_REMOVE;
            });
        }
        this.#scheduleRender();
    }

    #retryAuthorization(): void {
        this.#apply(this.#model.setConnection({ kind: 'connecting' }));
        this.#subscription.retry();
    }

    #isInstalled(): boolean {
        if (GLib.find_program_in_path(DAEMON_BINARY) !== null) {
            return true;
        }
        return INSTALL_DIRS.some((dir) =>
            GLib.file_test(`${dir}/${DAEMON_BINARY}`, GLib.FileTest.IS_EXECUTABLE),
        );
    }

    /// Open Super Voice's app: through the shell when it has a desktop entry,
    /// so it launches like any app, else its binary.
    #launchApp(): void {
        const app = Shell.AppSystem.get_default().lookup_app(SETTINGS_APP.desktopId);
        if (app !== null) {
            app.activate();
            return;
        }
        const binary =
            GLib.find_program_in_path(SETTINGS_APP.binary) ??
            INSTALL_DIRS.map((dir) => `${dir}/${SETTINGS_APP.binary}`).find((path) =>
                GLib.file_test(path, GLib.FileTest.IS_EXECUTABLE),
            );
        if (binary === undefined) {
            Main.notifyError('Super Voice', "Couldn't find Super Voice's app.");
            return;
        }
        try {
            // GSubprocess reaps the child when it exits.
            Gio.Subprocess.new([binary], Gio.SubprocessFlags.NONE);
        } catch (error) {
            this.#logger.warn(`Can't start ${binary}: ${errorMessage(error)}`);
        }
    }

    #openRepository(): void {
        try {
            Gio.AppInfo.launch_default_for_uri(
                REPOSITORY_URL,
                global.create_app_launch_context(0, -1),
            );
        } catch (error) {
            this.#logger.warn(`Can't open ${REPOSITORY_URL}: ${errorMessage(error)}`);
        }
    }

    #accessibleName(front: Feature | null, mode: Mode): string {
        if (front !== null && mode === 'visualization') {
            return `Super Voice: ${FEATURE_NAMES[front]} active`;
        }
        if (front !== null && mode === 'animation') {
            return `Super Voice: ${FEATURE_NAMES[front]} working`;
        }
        return 'Super Voice';
    }
}
