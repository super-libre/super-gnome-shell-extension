// SPDX-License-Identifier: GPL-3.0-only
//! The menu's pages, and the slide from one to the next: the port of the
//! applet's `src/app/pages.rs` and `src/ui/components/page_slide.rs`.
//!
//! The menu opens on its main page, and Colors is a page of its own that
//! slides in from the right. While the pages slide, the one leaving and the
//! one entering are side by side, each as wide as the menu and as tall as it
//! is alone, and the menu grows or shrinks from one's height to the other's.

import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

/// How long a page takes to slide in, as in the applet. It sets off fast and
/// settles into place: an ease-out cubic, the applet's `1 - (1 - t)^3`.
export const PAGE_TURN_MS = 250;

/// The pages side by side. Its children are the pages, in order, the first
/// the one the menu opens on.
export class PageStack extends St.Widget {
    static {
        GObject.registerClass(
            {
                GTypeName: 'SuperVoice_PageStack',
                Properties: {
                    // How far the page entering has come, from 0 to 1.
                    progress: GObject.ParamSpec.double(
                        'progress',
                        null,
                        null,
                        GObject.ParamFlags.READWRITE,
                        0,
                        1,
                        1,
                    ),
                },
            },
            PageStack,
        );
    }

    declare private _progress: number;
    declare private _shown: number;
    /// The page sliding out while a page slides in.
    declare private _leaving: number | null;

    constructor() {
        super({ clip_to_allocation: true, x_expand: true });
        this._progress = 1;
        this._shown = 0;
        this._leaving = null;
    }

    get progress(): number {
        return this._progress;
    }

    set progress(value: number) {
        this._progress = Math.min(Math.max(value, 0), 1);
        this.notify('progress');
        this.queue_relayout();
    }

    /// The page shown, or sliding in.
    get shown(): number {
        return this._shown;
    }

    /// Slide to page `index`, or go there at once. Already there, nothing
    /// moves.
    turnTo(index: number, animate: boolean): void {
        if (index === this._shown) {
            return;
        }
        this.remove_transition('progress');
        const pages = this.get_children();
        const leaving = this._shown;
        this._shown = index;
        pages.forEach((page, i) => {
            page.visible = i === index || (animate && i === leaving);
        });
        if (!animate) {
            this._leaving = null;
            this.progress = 1;
            return;
        }
        this._leaving = leaving;
        this.progress = 0;
        this.ease_property('progress', 1, {
            duration: PAGE_TURN_MS,
            mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
            onComplete: () => this.#settle(),
        });
    }

    #settle(): void {
        const leaving = this._leaving;
        this._leaving = null;
        if (leaving !== null) {
            const page = this.get_children()[leaving];
            if (page) {
                page.visible = false;
            }
        }
        this.queue_relayout();
    }

    /// As wide as the widest page, hidden or not, so the menu keeps its
    /// width from page to page.
    override vfunc_get_preferred_width(forHeight: number): [number, number] {
        let min = 0;
        let natural = 0;
        for (const page of this.get_children()) {
            const [pageMin, pageNatural] = page.get_preferred_width(forHeight);
            min = Math.max(min, pageMin);
            natural = Math.max(natural, pageNatural);
        }
        return [min, natural];
    }

    /// As tall as the page shown, or while one slides in, eased from the
    /// height of the page leaving to the height of the one entering.
    override vfunc_get_preferred_height(forWidth: number): [number, number] {
        const pages = this.get_children();
        const heightOf = (i: number | null): [number, number] => {
            const page = i === null ? undefined : pages[i];
            return page ? page.get_preferred_height(forWidth) : [0, 0];
        };
        const [toMin, toNatural] = heightOf(this._shown);
        if (this._leaving === null) {
            return [toMin, toNatural];
        }
        const [fromMin, fromNatural] = heightOf(this._leaving);
        const t = this._progress;
        return [fromMin + (toMin - fromMin) * t, fromNatural + (toNatural - fromNatural) * t];
    }

    /// Each page as wide as the stack and as tall as it is alone; the stack
    /// clips what overflows. Into a page further in, the pages move right to
    /// left, and back out of one, left to right.
    override vfunc_allocate(box: Clutter.ActorBox): void {
        this.set_allocation(box);
        const width = box.get_width();
        const shift = width * this._progress;
        const forward = this._leaving !== null && this._shown > this._leaving;
        this.get_children().forEach((page, i) => {
            if (!page.visible) {
                return;
            }
            let x = 0;
            if (this._leaving !== null) {
                if (i === this._leaving) {
                    x = forward ? -shift : shift;
                } else {
                    x = forward ? width - shift : shift - width;
                }
            }
            const [, height] = page.get_preferred_height(width);
            const pageBox = new Clutter.ActorBox();
            pageBox.set_origin(x, 0);
            pageBox.set_size(width, height);
            page.allocate(pageBox);
        });
    }
}

/// A menu row that leads to another page: activating it turns the page and
/// leaves the menu open, where an ordinary item would close it.
export class PageLink extends PopupMenu.PopupBaseMenuItem {
    static {
        GObject.registerClass({ GTypeName: 'SuperVoice_PageLink' }, PageLink);
    }

    declare private _onActivate: () => void;

    constructor(onActivate: () => void, styleClass = '') {
        super({ style_class: styleClass });
        this._onActivate = onActivate;
    }

    override activate(_event: Clutter.Event | null): void {
        this._onActivate();
    }
}
