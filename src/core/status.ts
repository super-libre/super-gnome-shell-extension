// SPDX-License-Identifier: GPL-3.0-only
//! The status lines the menu shows while the extension isn't connected: the
//! port of the applet's `src/ui/sections/status.rs`, for one daemon.

import type { Connection } from './model.js';
import { PRODUCT, RESTART_COMMAND } from './protocol.js';

export interface StatusText {
    /// The first line, in the menu's regular size.
    title: string;
    /// The lines under it, smaller.
    details: string[];
    /// Whether to offer "Retry authorization".
    canRetryAuthorization: boolean;
}

export const RETRY_AUTHORIZATION = 'Retry authorization';

/// What to tell the user, or `null` when all is well.
export function statusText(installed: boolean, connection: Connection): StatusText | null {
    const name = PRODUCT.displayName;
    if (!installed) {
        return {
            title: `${name} is not installed.`,
            details: ['Install it to use this extension.'],
            canRetryAuthorization: false,
        };
    }
    switch (connection.kind) {
        case 'connected':
            return null;
        case 'connecting':
            return {
                title: `${name}: connecting`,
                details: ['The daemon may still be starting.'],
                canRetryAuthorization: false,
            };
        case 'asking':
            return {
                title: `${name}: asking for permission`,
                details: [`Allow the request ${name} shows to see what it is doing here.`],
                canRetryAuthorization: false,
            };
        case 'needs-permission':
            return {
                title: `${name}: waiting for permission`,
                details: [permissionDetail(connection.reason), `${name} will ask again.`],
                canRetryAuthorization: false,
            };
        case 'error':
            return {
                title: `${name}: ${connection.message}`,
                details: [`Asking ${name} for a new session.`],
                canRetryAuthorization: false,
            };
        case 'blocked':
            return {
                title: `${name}: authorization denied`,
                details: [
                    `Reason: ${connection.reason}`,
                    'Restart the daemon to clear the denial:',
                    `  ${RESTART_COMMAND}`,
                    'Then ask for authorization again.',
                ],
                canRetryAuthorization: true,
            };
    }
}

function permissionDetail(reason: string): string {
    switch (reason) {
        case 'user_dismissed':
            return 'The permission request closed without an answer.';
        case 'popup_failed':
            return `${PRODUCT.displayName} couldn't show its permission request.`;
        default:
            return `Reason: ${reason}`;
    }
}
