// SPDX-License-Identifier: GPL-3.0-only
//! A scripted Super Voice daemon, for driving the extension in a headless
//! shell. It speaks the parts of the protocol the extension uses, on a Unix
//! socket: `POST /v1/auth/request`, `GET /v1/ping` and the `GET /v1/events`
//! stream. A second socket takes commands that change what it reports.
//!
//!     node tools/fake-daemon.ts <daemon socket> <control socket>
//!
//! Commands, as `POST http://x/<command>` on the control socket:
//!
//! - `scenario/<name>`: idle, recording, transcribing, synthesizing, speaking,
//!   both (recording and speaking), working (transcribing and synthesizing),
//!   and low or high: recording a sound loud only in the low bands (0 to 15,
//!   which the left half draws) or only in the next ones (16 to 31, the right
//!   half's);
//! - `auth/<mode>`: how the next `/auth/request` is answered: grant, deny
//!   (`user_denied`), dismiss (`user_dismissed`) or fail (`popup_failed`);
//! - `revoke`: send `revoked` on every stream, and refuse its token;
//! - `drop`: close every stream, as a daemon restart would;
//! - `GET status`: how many streams are open and tokens were asked for.
//!
//! While something records or speaks, the levels it sends are real speech:
//! the frames the engine's analyzer makes of a recording, in
//! `tests/fixtures/speech-bands.json` (see tools/speech-bands), replayed in a
//! loop at the pace the daemon sends them.

import { readFileSync, rmSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

const [socketPath, controlPath] = process.argv.slice(2);
if (!socketPath || !controlPath) {
    console.error('usage: fake-daemon.ts <daemon socket> <control socket>');
    process.exit(2);
}

type AuthMode = 'grant' | 'deny' | 'dismiss' | 'fail';

let authMode: AuthMode = 'grant';
let tokenCount = 0;
let authRequests = 0;
const validTokens = new Set<string>();
const streams = new Set<{ res: ServerResponse; token: string }>();
const timers: { stt?: NodeJS.Timeout; tts?: NodeJS.Timeout } = {};

interface Frame {
    bands_b64: string;
    total_energy: number;
}

const speech = JSON.parse(
    readFileSync(new URL('../tests/fixtures/speech-bands.json', import.meta.url), 'utf8'),
) as { frame_ms: number; frames: Frame[] };

function send(event: string, payload: unknown): void {
    const block = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const { res } of streams) {
        res.write(block);
    }
}

/// A frame loud (3, the visualization's full height) in bands `from` up to
/// `to`, and silent everywhere else.
function tone(from: number, to: number): Frame {
    const buf = Buffer.alloc(64 * 4);
    for (let i = from; i < to; i++) {
        buf.writeFloatLE(3, i * 4);
    }
    return { bands_b64: buf.toString('base64'), total_energy: 1 };
}

/// Send `feature`'s levels, frame after frame, until stopped: the recorded
/// speech, from its start, or one frame over and over.
function streamBands(feature: 'stt' | 'tts', on: boolean, only?: Frame): void {
    clearInterval(timers[feature]);
    delete timers[feature];
    if (on) {
        const topic = feature === 'stt' ? 'frequency_bands' : 'playback_frequency_bands';
        // Speech starts a second into the recording when both play, so the
        // two don't move in step.
        let next = feature === 'stt' ? 0 : Math.round(1000 / speech.frame_ms);
        timers[feature] = setInterval(() => {
            const frame = only ?? speech.frames[next++ % speech.frames.length];
            if (frame) {
                send(topic, frame);
            }
        }, speech.frame_ms);
    }
}

function scenario(name: string): boolean {
    const stt = (state: 'idle' | 'recording' | 'transcribing', only?: Frame) => {
        if (state === 'recording') {
            send('recording_state', { is_recording: true });
        } else if (state === 'transcribing') {
            send('recording_state', { is_recording: true });
            send('recording_state', { is_recording: false });
            send('transcribing_started', {});
        } else {
            send('recording_state', { is_recording: false });
            send('transcribing_stopped', {});
        }
        streamBands('stt', state === 'recording', only);
    };
    const tts = (state: 'idle' | 'synthesizing' | 'speaking') => {
        if (state === 'idle') {
            send('speaking_state', { is_speaking: false });
        } else {
            send('speaking_state', { is_speaking: true });
            if (state === 'speaking') {
                send('speech_progress', { spoken_ms: 240 });
            }
        }
        streamBands('tts', state === 'speaking');
    };
    switch (name) {
        case 'idle':
            stt('idle');
            tts('idle');
            return true;
        case 'recording':
            tts('idle');
            stt('recording');
            return true;
        case 'low':
            tts('idle');
            stt('recording', tone(0, 16));
            return true;
        case 'high':
            tts('idle');
            stt('recording', tone(16, 32));
            return true;
        case 'transcribing':
            tts('idle');
            stt('transcribing');
            return true;
        case 'synthesizing':
            stt('idle');
            tts('synthesizing');
            return true;
        case 'speaking':
            stt('idle');
            tts('speaking');
            return true;
        case 'both':
            stt('recording');
            tts('speaking');
            return true;
        case 'working':
            stt('transcribing');
            tts('synthesizing');
            return true;
        default:
            return false;
    }
}

function json(res: ServerResponse, status: number, body: unknown): void {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
}

function bearer(req: IncomingMessage): string | null {
    const header = req.headers.authorization ?? '';
    return header.startsWith('Bearer ') ? header.slice('Bearer '.length) : null;
}

const daemon = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (req.method === 'POST' && url.pathname === '/v1/auth/request') {
        authRequests += 1;
        req.resume();
        req.on('end', () => {
            if (authMode !== 'grant') {
                const reason = {
                    deny: 'user_denied',
                    dismiss: 'user_dismissed',
                    fail: 'popup_failed',
                }[authMode];
                json(res, 403, { status: 'error', error_code: 'auth_denied', data: { reason } });
                return;
            }
            const token = `fake-token-${++tokenCount}`;
            validTokens.add(token);
            json(res, 200, {
                status: 'success',
                session_token: token,
                scopes: ['audio_visualization', 'playback_events', 'recording_events'],
                expires_at: new Date(Date.now() + 30 * 86_400_000).toISOString(),
            });
        });
        return;
    }
    const token = bearer(req);
    if (token === null || !validTokens.has(token)) {
        json(res, 401, {
            status: 'error',
            error_code: 'invalid_session',
            data: { reason: 'unknown' },
        });
        return;
    }
    if (req.method === 'GET' && url.pathname === '/v1/ping') {
        json(res, 200, { status: 'success', message: 'pong' });
        return;
    }
    if (req.method === 'GET' && url.pathname === '/v1/events') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
        res.write(`event: subscribed\ndata: ${JSON.stringify({ client_id: 'fake' })}\n\n`);
        const entry = { res, token };
        streams.add(entry);
        const keepalive = setInterval(() => res.write(': keepalive\n\n'), 15_000);
        req.on('close', () => {
            clearInterval(keepalive);
            streams.delete(entry);
        });
        return;
    }
    json(res, 404, { status: 'error', error_code: 'not_found', message: 'not_found' });
});

const control = createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname.replace(/^\/+/, '');
    req.resume();
    const [command, argument = ''] = path.split('/');
    let ok = true;
    switch (command) {
        case 'status':
            json(res, 200, { streams: streams.size, authRequests, authMode });
            return;
        case 'scenario':
            ok = scenario(argument);
            break;
        case 'auth':
            if (['grant', 'deny', 'dismiss', 'fail'].includes(argument)) {
                authMode = argument as AuthMode;
            } else {
                ok = false;
            }
            break;
        case 'revoke':
            for (const entry of streams) {
                validTokens.delete(entry.token);
                entry.res.write(
                    `event: revoked\ndata: ${JSON.stringify({ reason: 'exe_changed' })}\n\n`,
                );
                entry.res.end();
            }
            break;
        case 'drop':
            for (const { res: stream } of streams) {
                stream.end();
            }
            break;
        default:
            ok = false;
    }
    json(res, ok ? 200 : 400, { ok });
});

for (const path of [socketPath, controlPath]) {
    rmSync(path, { force: true });
}
daemon.listen(socketPath, () => console.log(`fake daemon on ${socketPath}`));
control.listen(controlPath, () => console.log(`control on ${controlPath}`));

const stop = () => {
    for (const { res } of streams) {
        res.destroy();
    }
    daemon.close();
    control.close();
    process.exit(0);
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
