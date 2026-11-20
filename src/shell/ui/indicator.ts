// SPDX-License-Identifier: GPL-3.0-only
//! The top-bar button: a box of fixed size holding the meter, where bars and
//! animations are drawn, and the icon, shown the rest of the time.

import Clutter from 'gi://Clutter';
import type Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import St from 'gi://St';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import type { IconAlignment } from '../../core/settings.js';
import { Meter } from './meter.js';

const ALIGN: Record<IconAlignment, Clutter.ActorAlign> = {
    start: Clutter.ActorAlign.START,
    center: Clutter.ActorAlign.CENTER,
    end: Clutter.ActorAlign.END,
};

export class Indicator extends PanelMenu.Button {
    static {
        GObject.registerClass({ GTypeName: 'SuperVoice_Indicator' }, Indicator);
    }

    declare readonly box: St.Widget;
    declare readonly meter: Meter;
    declare readonly icon: St.Icon;

    constructor() {
        super(0.5, 'Super Voice', false);
        this.add_style_class_name('super-voice-indicator');
        const box = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            style_class: 'super-voice-box',
            y_expand: true,
            y_align: Clutter.ActorAlign.FILL,
        });
        const meter = new Meter({
            style_class: 'super-voice-meter',
            x_expand: true,
            y_expand: true,
        });
        // BinLayout honors a child's alignment only when it expands.
        const icon = new St.Icon({
            style_class: 'super-voice-icon',
            x_expand: true,
            y_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            x_align: Clutter.ActorAlign.END,
        });
        box.add_child(meter);
        box.add_child(icon);
        this.add_child(box);
        Object.assign(this, { box, meter, icon });
    }

    /// Size the box, in logical pixels; the theme scales them with the
    /// display.
    setBoxSize(width: number, height: number | null): void {
        this.box.style =
            height === null ? `width: ${width}px;` : `width: ${width}px; height: ${height}px;`;
    }

    setIcon(gicon: Gio.Icon | null, size: number, alignment: IconAlignment): void {
        this.icon.gicon = gicon;
        this.icon.icon_size = size;
        this.icon.x_align = ALIGN[alignment];
        this.icon.visible = gicon !== null;
    }

    showMeter(show: boolean): void {
        this.meter.visible = show;
        if (!show) {
            this.meter.stopAnimating();
        }
    }
}
