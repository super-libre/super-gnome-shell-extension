// SPDX-License-Identifier: GPL-3.0-only
//! Promises over GLib's main loop, and cancellation that disable() can pull.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';

/// Give the async methods the extension awaits their Promise forms. Calling
/// it again is harmless.
export function promisifyAll(): void {
    Gio._promisify(Soup.Session.prototype, 'send_async');
    Gio._promisify(Soup.Session.prototype, 'send_and_read_async');
    Gio._promisify(Gio.DataInputStream.prototype, 'read_line_async');
    Gio._promisify(Gio.InputStream.prototype, 'close_async');
    Gio._promisify(Gio.File.prototype, 'load_contents_async');
}

/// Whether `error` is the GIO error `code`.
export function isIoError(error: unknown, code: number): boolean {
    return (
        error instanceof GLib.Error && error.domain === Gio.io_error_quark() && error.code === code
    );
}

/// Whether `error` is GIO's report that the operation was cancelled.
export function isCancelled(error: unknown): boolean {
    return isIoError(error, Gio.IOErrorEnum.CANCELLED);
}

/// The error a cancelled wait rejects with, the same as GIO's own.
function cancelledError(): GLib.Error {
    return GLib.Error.new_literal(
        Gio.IOErrorEnum,
        Gio.IOErrorEnum.CANCELLED,
        'Operation was cancelled',
    );
}

/// Wait `ms`, or until `cancellable` is cancelled, which rejects.
export function sleep(ms: number, cancellable: Gio.Cancellable): Promise<void> {
    return new Promise((resolve, reject) => {
        if (cancellable.is_cancelled()) {
            reject(cancelledError());
            return;
        }
        let handler = 0;
        const source = GLib.timeout_add(GLib.PRIORITY_DEFAULT, Math.max(ms, 0), () => {
            cancellable.disconnect(handler);
            resolve();
            return GLib.SOURCE_REMOVE;
        });
        handler = cancellable.connect(() => {
            GLib.source_remove(source);
            // `connect` runs the callback at once when already cancelled,
            // before `handler` is set; the check above returned then.
            reject(cancelledError());
        });
    });
}

/// A cancellable that is cancelled with `parent`, and can also be cancelled
/// on its own. Call `release()` when done with it.
export function childCancellable(parent: Gio.Cancellable): {
    cancellable: Gio.Cancellable;
    release: () => void;
} {
    const cancellable = new Gio.Cancellable();
    if (parent.is_cancelled()) {
        cancellable.cancel();
        return { cancellable, release: () => {} };
    }
    const handler = parent.connect(() => cancellable.cancel());
    let released = false;
    return {
        cancellable,
        release: () => {
            if (!released) {
                released = true;
                parent.disconnect(handler);
            }
        },
    };
}

/// Milliseconds on the monotonic clock.
export function nowMs(): number {
    return GLib.get_monotonic_time() / 1000;
}

/// A short form of an error, for the log and the menu.
export function errorMessage(error: unknown): string {
    if (error instanceof GLib.Error || error instanceof Error) {
        return error.message;
    }
    return String(error);
}
