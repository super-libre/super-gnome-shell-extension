// SPDX-License-Identifier: GPL-3.0-only
//! Super Voice in the top bar: what speech to text and text to speech are
//! doing, drawn from the daemon's events.
//!
//! Nothing happens until enable(), and disable() undoes all of it: the
//! indicator, every signal, timer and request.

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import { promisifyAll } from './shell/async.js';
import { Controller } from './shell/controller.js';

export default class SuperVoiceExtension extends Extension {
    #controller: Controller | null = null;

    override enable(): void {
        promisifyAll();
        const logger = this.getLogger();
        this.#controller = new Controller({
            uuid: this.uuid,
            path: this.path,
            version: String(this.metadata['version-name'] ?? this.metadata.version ?? '0'),
            settings: this.getSettings(),
            logger: {
                log: (...args: unknown[]) => logger.log(...args),
                warn: (...args: unknown[]) => logger.warn(...args),
            },
        });
    }

    override disable(): void {
        this.#controller?.destroy();
        this.#controller = null;
    }
}
