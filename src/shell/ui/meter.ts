// SPDX-License-Identifier: GPL-3.0-only
//! The canvas the bars and animations are drawn on.

import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';
import type Cairo from 'cairo';

/// What the meter draws each frame, given its size in pixels.
export type Painter = (cr: Cairo.Context, width: number, height: number) => void;

/// The animations run at the applet's rate, about 30 frames a second, which
/// is smooth at this size and spares the compositor half the work of 60.
const ANIMATION_FRAME_MS = 33;

export class Meter extends St.DrawingArea {
    static {
        GObject.registerClass({ GTypeName: 'SuperVoice_Meter' }, Meter);
    }

    declare private _painter: Painter | null;
    declare private _timeline: Clutter.Timeline | null;
    declare private _lastFrame: number;

    constructor(params: Partial<St.DrawingArea.ConstructorProps> = {}) {
        super(params);
        this._painter = null;
        this._timeline = null;
        this._lastFrame = 0;
    }

    setPainter(painter: Painter | null): void {
        this._painter = painter;
        this.queue_repaint();
    }

    /// Redraw on every frame, at the animation rate, until `stopAnimating`.
    /// The timeline is bound to the meter, so it follows its monitor's frame
    /// clock and stops costing anything when the meter isn't painted.
    startAnimating(): void {
        if (this._timeline !== null) {
            return;
        }
        if (!this.get_stage()) {
            return;
        }
        this._timeline = new Clutter.Timeline({ actor: this, duration: 1000, repeat_count: -1 });
        this._timeline.connect('new-frame', () => {
            const now = this._timeline?.get_elapsed_time() ?? 0;
            if (Math.abs(now - this._lastFrame) >= ANIMATION_FRAME_MS || now < this._lastFrame) {
                this._lastFrame = now;
                this.queue_repaint();
            }
        });
        this._timeline.start();
    }

    stopAnimating(): void {
        this._timeline?.stop();
        this._timeline = null;
        this._lastFrame = 0;
    }

    get animating(): boolean {
        return this._timeline !== null;
    }

    override vfunc_repaint(): void {
        const cr = this.get_context();
        try {
            const [width, height] = this.get_surface_size();
            if (this._painter !== null && width > 0 && height > 0) {
                this._painter(cr, width, height);
            }
        } finally {
            cr.$dispose();
        }
    }

    override destroy(): void {
        this.stopAnimating();
        this._painter = null;
        super.destroy();
    }
}
