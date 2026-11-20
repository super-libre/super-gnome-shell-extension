// SPDX-License-Identifier: GPL-3.0-only
//! Daemon events, as the extension acts on them: the port of the applet's
//! `widget_event_to_message` (`src/app/subscription.rs`).

import type { Feature } from './protocol.js';
import type { StreamEvent } from './sse.js';

export type DaemonEvent =
    | { kind: 'recording-state'; isRecording: boolean }
    | { kind: 'transcribing-started' }
    | { kind: 'transcribing-stopped' }
    | { kind: 'speaking-state'; isSpeaking: boolean }
    | { kind: 'speech-progress'; spokenMs: number }
    /// The level meter of one feature: the microphone's for dictation, the
    /// speakers' for speech.
    | { kind: 'bands'; feature: Feature; bands: Float32Array; totalEnergy: number }
    | { kind: 'revoked'; reason: string }
    /// The daemon's `subscribed` greeting and its keepalives: proof the
    /// stream is alive, nothing more.
    | { kind: 'heartbeat' }
    /// Any other event, by name, for the log.
    | { kind: 'other'; name: string };

/// Translate one stream event. Fields the daemon leaves out take the same
/// defaults as in the applet: `false`, `0`, `"unknown"`.
export function toDaemonEvent(event: StreamEvent): DaemonEvent {
    const p = isRecord(event.payload) ? event.payload : {};
    const flag = (key: string) => p[key] === true;
    switch (event.name) {
        case 'recording_state':
            return { kind: 'recording-state', isRecording: flag('is_recording') };
        case 'transcribing_started':
            return { kind: 'transcribing-started' };
        case 'transcribing_stopped':
            return { kind: 'transcribing-stopped' };
        case 'speaking_state':
            return { kind: 'speaking-state', isSpeaking: flag('is_speaking') };
        case 'speech_progress':
            return { kind: 'speech-progress', spokenMs: nonNegative(p.spoken_ms) };
        case 'frequency_bands':
        case 'playback_frequency_bands':
            return {
                kind: 'bands',
                feature: event.name === 'frequency_bands' ? 'stt' : 'tts',
                bands: decodeBands(typeof p.bands_b64 === 'string' ? p.bands_b64 : null),
                totalEnergy: typeof p.total_energy === 'number' ? p.total_energy : 0,
            };
        case 'revoked':
            return {
                kind: 'revoked',
                reason: typeof p.reason === 'string' ? p.reason : 'unknown',
            };
        case 'subscribed':
        case 'keepalive':
            return { kind: 'heartbeat' };
        default:
            return { kind: 'other', name: event.name };
    }
}

/// The bands of a `frequency_bands` payload: base64 of little-endian `f32`s.
/// A trailing partial value is dropped, and anything that isn't base64 is no
/// bands at all.
export function decodeBands(b64: string | null): Float32Array {
    if (!b64) {
        return new Float32Array(0);
    }
    let bytes: Uint8Array;
    try {
        bytes = base64ToBytes(b64);
    } catch {
        return new Float32Array(0);
    }
    const count = Math.floor(bytes.length / 4);
    const view = new DataView(bytes.buffer, bytes.byteOffset, count * 4);
    const out = new Float32Array(count);
    for (let i = 0; i < count; i++) {
        out[i] = view.getFloat32(i * 4, true);
    }
    return out;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_INDEX = new Map([...B64].map((c, i) => [c, i]));

/// Standard base64, padded or not. GJS has no `atob`, and `Uint8Array.fromBase64`
/// is newer than the SpiderMonkey GNOME 50 ships, so this decodes by hand.
export function base64ToBytes(text: string): Uint8Array {
    const clean = text.replace(/=+$/, '');
    if (clean.length % 4 === 1) {
        throw new Error('invalid base64 length');
    }
    const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
    let bits = 0;
    let value = 0;
    let o = 0;
    for (const c of clean) {
        const v = B64_INDEX.get(c);
        if (v === undefined) {
            throw new Error(`invalid base64 character ${JSON.stringify(c)}`);
        }
        value = (value << 6) | v;
        bits += 6;
        if (bits >= 8) {
            bits -= 8;
            out[o++] = (value >> bits) & 0xff;
        }
    }
    return out;
}

function nonNegative(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
