// SPDX-License-Identifier: GPL-3.0-only
//! The wire: SSE framing, event mapping, error classification, backoff, paths.
import { describe, expect, it } from 'vitest';
import { Backoff, INITIAL_DELAY_MS, MAX_DELAY_MS } from '../../src/core/backoff.js';
import {
    classify,
    describe as describeError,
    isUserDenied,
    needsNewToken,
} from '../../src/core/errors.js';
import { base64ToBytes, decodeBands, toDaemonEvent } from '../../src/core/events.js';
import { type Env, socketPath, tokenPath } from '../../src/core/paths.js';
import { ALL_TOPICS, SCOPES, TOPICS } from '../../src/core/protocol.js';
import { SseParser, type StreamEvent } from '../../src/core/sse.js';

function feed(lines: string[]): StreamEvent[] {
    const parser = new SseParser();
    return lines.map((l) => parser.push(l)).filter((e): e is StreamEvent => e !== null);
}

function b64(floats: number[], extraBytes = 0): string {
    const buf = Buffer.alloc(floats.length * 4 + extraBytes);
    floats.forEach((f, i) => {
        buf.writeFloatLE(f, i * 4);
    });
    return buf.toString('base64');
}

describe('SSE', () => {
    it('names an event and parses its JSON', () => {
        expect(feed(['event: recording_state', 'data: {"is_recording":true}', ''])).toEqual([
            { name: 'recording_state', payload: { is_recording: true } },
        ]);
    });

    it('joins data lines and tolerates CRLF', () => {
        expect(feed(['event: x\r', 'data: {"a":\r', 'data: 1}\r', '\r'])).toEqual([
            { name: 'x', payload: { a: 1 } },
        ]);
    });

    it('reports a comment-only block as a keepalive, so the idle deadline resets', () => {
        expect(feed([': keepalive', ''])).toEqual([{ name: 'keepalive', payload: null }]);
    });

    it('reads a comment before the event as part of it', () => {
        expect(feed([': hi', 'event: test_started', 'data: {"started":true}', ''])).toEqual([
            { name: 'test_started', payload: { started: true } },
        ]);
    });

    it('drops blocks with nothing to say, and extra blank lines', () => {
        expect(feed(['id: 42', 'retry: 1000', '', '', 'data: {}', ''])).toEqual([]);
    });

    it('gives a payload that does not parse as null', () => {
        expect(feed(['event: x', 'data: {nope', ''])).toEqual([{ name: 'x', payload: null }]);
    });
});

describe('events', () => {
    it('maps each topic the extension subscribes to', () => {
        expect(toDaemonEvent({ name: 'recording_state', payload: { is_recording: true } })).toEqual(
            { kind: 'recording-state', isRecording: true },
        );
        expect(toDaemonEvent({ name: 'transcribing_started', payload: {} })).toEqual({
            kind: 'transcribing-started',
        });
        expect(toDaemonEvent({ name: 'transcribing_stopped', payload: {} })).toEqual({
            kind: 'transcribing-stopped',
        });
        expect(toDaemonEvent({ name: 'speaking_state', payload: { is_speaking: true } })).toEqual({
            kind: 'speaking-state',
            isSpeaking: true,
        });
        expect(toDaemonEvent({ name: 'speech_progress', payload: { spoken_ms: 120 } })).toEqual({
            kind: 'speech-progress',
            spokenMs: 120,
        });
        expect(toDaemonEvent({ name: 'revoked', payload: { reason: 'exe_changed' } })).toEqual({
            kind: 'revoked',
            reason: 'exe_changed',
        });
    });

    it('defaults missing fields as the applet does', () => {
        expect(toDaemonEvent({ name: 'recording_state', payload: null })).toEqual({
            kind: 'recording-state',
            isRecording: false,
        });
        expect(toDaemonEvent({ name: 'speech_progress', payload: {} })).toEqual({
            kind: 'speech-progress',
            spokenMs: 0,
        });
        expect(toDaemonEvent({ name: 'revoked', payload: {} })).toEqual({
            kind: 'revoked',
            reason: 'unknown',
        });
    });

    it("decodes each feature's bands from base64 little-endian floats", () => {
        const stt = toDaemonEvent({
            name: 'frequency_bands',
            payload: { bands_b64: b64([0.5, 1.25, 3]), total_energy: 0.4 },
        });
        expect(stt).toMatchObject({ kind: 'bands', feature: 'stt', totalEnergy: 0.4 });
        expect(Array.from((stt as { bands: Float32Array }).bands)).toEqual([0.5, 1.25, 3]);

        const tts = toDaemonEvent({
            name: 'playback_frequency_bands',
            payload: { bands_b64: b64([2]) },
        });
        expect(tts).toMatchObject({ kind: 'bands', feature: 'tts', totalEnergy: 0 });
    });

    it('drops a trailing partial float, and reads garbage as no bands', () => {
        expect(Array.from(decodeBands(b64([1, 2], 3)))).toEqual([1, 2]);
        expect(decodeBands('***')).toHaveLength(0);
        expect(decodeBands(null)).toHaveLength(0);
    });

    it('decodes base64 with and without padding', () => {
        for (const text of ['', 'f', 'fo', 'foo', 'foob', 'fooba', 'foobar']) {
            const encoded = Buffer.from(text).toString('base64');
            expect(Buffer.from(base64ToBytes(encoded)).toString()).toBe(text);
            expect(Buffer.from(base64ToBytes(encoded.replace(/=+$/, ''))).toString()).toBe(text);
        }
    });

    it('treats the greeting and keepalives as heartbeats', () => {
        expect(toDaemonEvent({ name: 'subscribed', payload: {} })).toEqual({ kind: 'heartbeat' });
        expect(toDaemonEvent({ name: 'keepalive', payload: null })).toEqual({ kind: 'heartbeat' });
        expect(toDaemonEvent({ name: 'final_stt', payload: {} })).toEqual({
            kind: 'other',
            name: 'final_stt',
        });
    });

    it("subscribes to each feature's topics, under the scopes it asks for", () => {
        expect(ALL_TOPICS).toEqual([...TOPICS.stt, ...TOPICS.tts]);
        // The daemon refuses the whole stream when a topic's scope is missing.
        const scopeOf: Record<string, string> = {
            recording_state: 'recording_events',
            transcribing_started: 'recording_events',
            transcribing_stopped: 'recording_events',
            frequency_bands: 'audio_visualization',
            speaking_state: 'playback_events',
            speech_progress: 'playback_events',
            playback_frequency_bands: 'audio_visualization',
        };
        for (const topic of ALL_TOPICS) {
            expect(SCOPES).toContain(scopeOf[topic]);
        }
    });
});

describe('errors', () => {
    it('reads 401 as an invalid session with its reason', () => {
        const e = classify(401, '{"data":{"reason":"exe_changed"}}');
        expect(e).toEqual({ kind: 'invalid-session', reason: 'exe_changed' });
        expect(needsNewToken(e)).toBe(true);
        expect(describeError(e)).toBe('invalid_session (exe_changed)');
    });

    it('reads a 403 as a scope refusal only when the daemon says so', () => {
        expect(classify(403, '{"error_code":"scope_denied"}')).toEqual({ kind: 'scope-denied' });
        expect(classify(403, '{"error_code":"forbidden","message":"no"}')).toEqual({
            kind: 'other',
            message: 'forbidden: no (HTTP 403)',
        });
    });

    it('says the code once when the message repeats it', () => {
        expect(classify(500, '{"error_code":"oops","message":"oops"}')).toEqual({
            kind: 'other',
            message: 'oops (HTTP 500)',
        });
        expect(classify(502, 'not json')).toEqual({
            kind: 'other',
            message: 'daemon returned HTTP 502',
        });
    });

    it("reads every refusal of /auth/request as the user's", () => {
        const denied = classify(403, '{"data":{"reason":"user_denied"}}', true);
        expect(denied).toEqual({ kind: 'auth-denied', reason: 'user_denied' });
        expect(isUserDenied(denied)).toBe(true);
        expect(isUserDenied(classify(403, '{"data":{"reason":"user_denied_cached"}}', true))).toBe(
            true,
        );
        // A dismissed or failed popup is worth asking again.
        expect(isUserDenied(classify(403, '{"data":{"reason":"user_dismissed"}}', true))).toBe(
            false,
        );
        expect(isUserDenied(classify(403, '{"data":{"reason":"popup_failed"}}', true))).toBe(false);
        expect(classify(429, '', true)).toEqual({ kind: 'auth-denied', reason: 'auth_denied' });
    });
});

describe('backoff', () => {
    it('doubles from a second to the cap, then resets', () => {
        const backoff = new Backoff(() => 0.5);
        const delays = Array.from({ length: 8 }, () => backoff.next());
        expect(delays).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]);
        backoff.reset();
        expect(backoff.next()).toBe(INITIAL_DELAY_MS);
    });

    it('jitters by at most a tenth either way', () => {
        expect(new Backoff(() => 0).next()).toBe(900);
        const capped = new Backoff(() => 0.999_999);
        for (let i = 0; i < 10; i++) {
            expect(capped.next()).toBeLessThanOrEqual(MAX_DELAY_MS * 1.1);
        }
    });
});

describe('paths', () => {
    const env = (vars: Record<string, string>): Env => ({
        getenv: (name) => vars[name] ?? null,
        uid: 1000,
        home: '/home/me',
    });

    it('finds the socket in the runtime directory', () => {
        expect(socketPath(env({ XDG_RUNTIME_DIR: '/run/user/1000' }))).toBe(
            '/run/user/1000/voice/super-voice-http.sock',
        );
        expect(socketPath(env({}))).toBe('/run/user/1000/voice/super-voice-http.sock');
    });

    it('takes the override verbatim', () => {
        expect(socketPath(env({ SUPER_VOICE_HTTP_SOCKET: '/x/y.sock' }))).toBe('/x/y.sock');
        expect(socketPath(env({ SUPER_VOICE_HTTP_SOCKET: '' }))).toBe(
            '/run/user/1000/voice/super-voice-http.sock',
        );
    });

    it('falls back as the daemon does on a suspicious runtime directory', () => {
        for (const dir of ['../../../etc', '/etc/runtime', '', `/run/user/${'x'.repeat(300)}`]) {
            expect(socketPath(env({ XDG_RUNTIME_DIR: dir }))).toBe(
                '/tmp/voice/super-voice-http.sock',
            );
        }
    });

    it("keeps the token beside the other clients' tokens", () => {
        expect(tokenPath(env({}))).toBe(
            '/home/me/.local/state/super-voice/clients/super-gnome-shell-extension.json',
        );
        expect(tokenPath(env({ XDG_STATE_HOME: '/s' }))).toBe(
            '/s/super-voice/clients/super-gnome-shell-extension.json',
        );
        // A relative XDG directory is ignored, as the spec says.
        expect(tokenPath(env({ XDG_STATE_HOME: 'rel' }))).toBe(
            '/home/me/.local/state/super-voice/clients/super-gnome-shell-extension.json',
        );
    });
});
