import { describe, expect, it, vi } from 'vitest';
import type { StampedEvent } from '@faithful/session';
import { ReplayAdapter, type Clock } from './replay';
import { LiveAdapter } from './live';
import { ScriptedAdapter } from './scripted';
import { SseParser } from '../lib/sse';
import { ReadOnlyError, type Actions } from '../actions';
import { FIXTURES } from '../fixtures';
import { createStore, attach } from '../store';

function fakeClock() {
  let now = 0;
  const q: Array<{ at: number; f: () => void; id: number }> = [];
  let id = 0;
  const clock: Clock = {
    setTimeout: (f, ms) => {
      q.push({ at: now + ms, f, id: ++id });
      return id;
    },
    clearTimeout: (h) => {
      const i = q.findIndex((x) => x.id === h);
      if (i >= 0) q.splice(i, 1);
    },
  };
  const advance = (ms: number) => {
    const end = now + ms;
    for (;;) {
      q.sort((a, b) => a.at - b.at);
      const next = q[0];
      if (!next || next.at > end) break;
      q.shift();
      now = next.at;
      next.f();
    }
    now = end;
  };
  return { clock, advance };
}

const events: StampedEvent[] = FIXTURES.catch!.events;

describe('ReplayAdapter', () => {
  it('delivers events with the recorded timing, scaled by speed', () => {
    const { clock, advance } = fakeClock();
    const r = new ReplayAdapter(events, { label: 'x', fixture: true, clock, speed: 2 });
    const got: number[] = [];
    r.connect((e) => got.push(e.seq));
    r.play();
    advance(0);
    expect(got).toEqual([0]); // first event at its own time (t = 0)
    advance((events[1]!.t - events[0]!.t) / 2 - 1);
    expect(got).toEqual([0]);
    advance(1);
    expect(got).toEqual([0, 1]);
    advance(events.at(-1)!.t);
    expect(got.length).toBe(events.length);
    expect(r.state.playing).toBe(false);
  });

  it('pause, step and seek (backwards seeks reset the store)', () => {
    const { clock } = fakeClock();
    const r = new ReplayAdapter(events, { label: 'x', fixture: true, clock });
    const store = createStore();
    attach(store, r);
    r.step();
    r.step();
    expect(store.events.value.length).toBe(2);
    r.toEnd();
    expect(store.state.value.stage).toBe('deliver');
    r.seek(4); // session.started, translate.done, call.recorded, spec.proposed
    expect(store.events.value.length).toBe(4);
    expect(store.state.value.stage).toBe('agree');
  });

  it('refuses every action (read-only)', async () => {
    const r = new ReplayAdapter(events, { label: 'x', fixture: true });
    const port: Actions = r;
    await expect(port.agree()).rejects.toBeInstanceOf(ReadOnlyError);
    await expect(port.startOptimize({ kind: 'time-budget', minutes: 1 })).rejects.toBeInstanceOf(ReadOnlyError);
    expect(r.readOnly).toBe(true);
    // the Tested preflight is a question, not an action: unknown in a replay
    expect(await port.testedCheck()).toBeNull();
    // what can be attempted is unknown in a replay too (the pick lists show no status)
    expect(await port.functionStatus(['a.ts'])).toBeNull();
    // and so is the server's ranking and its scan: the pick lists list the functions locally, without a status
    expect(await port.pickFunctions('fib', { limit: 8 })).toBeNull();
    expect(await port.scanStatus()).toBeNull();
    expect(await port.startScan()).toBeNull();
  });
});

describe('SseParser', () => {
  it('parses events split across chunks, CRLF, comments and multi-line data', () => {
    const p = new SseParser();
    expect(p.push(': hello\r\nid: 4\r\nevent: session\r\ndata: {"a":')).toEqual([]);
    expect(p.push('1}\r\n\r\ndata: x\ndata: y\n\n')).toEqual([
      { event: 'session', data: '{"a":1}', id: '4' },
      { event: 'message', data: 'x\ny', id: '4' },
    ]);
  });
});

describe('LiveAdapter', () => {
  it('sends the token header and the documented routes', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const f = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    const a = new LiveAdapter({ token: 'tok', fetch: f as unknown as typeof fetch });
    await a.rule('ch-1', { ruling: 'spec-wrong' });
    await a.proveOriginal({ maxAttempts: 3, minutes: 5 });
    expect(calls.map((c) => c.url)).toEqual(['/api/challenge/rule', '/api/prove/original']);
    expect((calls[0]!.init.headers as Record<string, string>)['x-faithful-token']).toBe('tok');
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({ challengeId: 'ch-1', ruling: { ruling: 'spec-wrong' } });
  });

  it('asks what Faithful can attempt for a batch of files with one POST /api/functions/status', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const answer = { 'src/a.ts': { f: { tier: 'tested', reason: null } }, 'gone.ts': null };
    const f = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(answer), { status: 200 });
    });
    const a = new LiveAdapter({ token: 'tok', fetch: f as unknown as typeof fetch });
    expect(await a.functionStatus(['src/a.ts', 'gone.ts'])).toEqual(answer);
    expect(calls.map((c) => `${c.init.method} ${c.url}`)).toEqual(['POST /api/functions/status']);
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({ files: ['src/a.ts', 'gone.ts'] });
    expect((calls[0]!.init.headers as Record<string, string>)['x-faithful-token']).toBe('tok');
  });

  it('asks for the ranked Pick list with one POST /api/functions/pick, and for the scan with GET scan and POST scan/start', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const scan = { state: 'running', filesDone: 3, filesTotal: 10, version: 2 };
    const pick = { rows: [], totalMatches: 0, counts: { provable: 0, tested: 0, unknown: 0, none: 0 }, cannotRun: [], scan };
    const f = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(url.endsWith('/pick') ? pick : scan), { status: 200 });
    });
    const a = new LiveAdapter({ token: 'tok', fetch: f as unknown as typeof fetch });
    expect(await a.pickFunctions('fib', { limit: 8, includeUnrunnable: true })).toEqual(pick);
    await a.pickFunctions('');
    await a.pickFunctions('x', { limit: 500 }); // the server's cap is 50: never ask for more
    await a.pickFunctions('x', { limit: 0 });
    expect(await a.scanStatus()).toEqual(scan);
    expect(await a.startScan()).toEqual(scan);
    expect(calls.map((c) => `${c.init.method} ${c.url}`)).toEqual([
      'POST /api/functions/pick',
      'POST /api/functions/pick',
      'POST /api/functions/pick',
      'POST /api/functions/pick',
      'GET /api/functions/scan',
      'POST /api/functions/scan/start',
    ]);
    const body = (i: number) => JSON.parse(calls[i]!.init.body as string);
    expect(body(0)).toEqual({ query: 'fib', limit: 8, includeUnrunnable: true });
    expect(body(1)).toEqual({ query: '' });
    expect(body(2)).toEqual({ query: 'x', limit: 50 });
    expect(body(3)).toEqual({ query: 'x', limit: 1 });
    expect(calls[4]!.init.body).toBeUndefined();
    expect(body(5)).toEqual({});
    expect((calls[4]!.init.headers as Record<string, string>)['x-faithful-token']).toBe('tok');
  });

  it('a 401 (the server restarted with a new token) says to reload the page', async () => {
    const f = async () => new Response(JSON.stringify({ error: 'bad token' }), { status: 401 });
    const a = new LiveAdapter({ token: 'old', fetch: f as unknown as typeof fetch });
    await expect(a.agree()).rejects.toThrow(/Reload the page/);
  });

  it('surfaces the server error message', async () => {
    const f = async () => new Response(JSON.stringify({ error: 'no session' }), { status: 409 });
    const a = new LiveAdapter({ token: 't', fetch: f as unknown as typeof fetch });
    await expect(a.agree()).rejects.toThrow('no session');
  });

  it('reads the carve-out menu and the toolchain checks with GETs', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const f = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify([]), { status: 200 });
    });
    const a = new LiveAdapter({ token: 'tok', fetch: f as unknown as typeof fetch });
    await a.carveOptions('ab cd');
    await a.doctor();
    await a.testedCheck();
    await a.rule('ch-1', { ruling: 'function-wrong', then: 'carve-out', carve: { param: 0, kind: 'negative' } });
    expect(calls.map((c) => `${c.init.method} ${c.url}`)).toEqual([
      'GET /api/challenge/carve-options?challengeId=ab%20cd',
      'GET /api/doctor',
      'GET /api/tested/check',
      'POST /api/challenge/rule',
    ]);
    expect(JSON.parse(calls[3]!.init.body as string)).toEqual({
      challengeId: 'ch-1',
      ruling: { ruling: 'function-wrong', then: 'carve-out', carve: { param: 0, kind: 'negative' } },
    });
  });
});

describe('LiveAdapter event stream', () => {
  const enc = new TextEncoder();
  const sse = (evs: StampedEvent[]) =>
    new ReadableStream<Uint8Array>({
      start(c) {
        for (const e of evs) c.enqueue(enc.encode(`id: ${e.seq}\nevent: session\ndata: ${JSON.stringify(e)}\n\n`));
        c.close();
      },
    });
  /** A fake server: each connection to the event stream gets the next list; `/api/session` answers `session`. */
  function server(streams: StampedEvent[][], session: () => { fn: string }) {
    const urls: string[] = [];
    let n = 0;
    const f = async (url: string) => {
      urls.push(url);
      if (url === '/api/session') return new Response(JSON.stringify(session()), { status: 200 });
      const list = streams[n++];
      return list ? new Response(sse(list), { status: 200 }) : new Promise<Response>(() => {});
    };
    return { f: f as unknown as typeof fetch, urls };
  }
  async function run(f: typeof fetch) {
    vi.useFakeTimers();
    const a = new LiveAdapter({ token: 't', fetch: f });
    const got: Array<string | number> = [];
    const notes: string[] = [];
    const off = a.connect(
      (e) => got.push(e.seq),
      (st) => st.kind === 'open' && st.note && notes.push(st.note),
      () => got.push('reset'),
    );
    await vi.advanceTimersByTimeAsync(2_000);
    off();
    vi.useRealTimers();
    return { got, notes };
  }

  it('a reconnect replays the whole stream; events already delivered are skipped', async () => {
    const { f, urls } = server([events.slice(0, 3), events.slice(0, 5)], () => ({ fn: 'fib' }));
    const { got, notes } = await run(f);
    expect(got).toEqual([0, 1, 2, 3, 4]);
    expect(notes).toEqual([]);
    expect(urls.filter((u) => u.startsWith('/api/session/events'))).toEqual(['/api/session/events', '/api/session/events', '/api/session/events']);
  });

  it('a restarted server (same seq, different event) resets the store, replays what the server has, and says so', async () => {
    const restarted: StampedEvent = { seq: 2, t: 0, event: { kind: 'job.failed', job: 'spec-proposal', message: 'x' } };
    const { f } = server([events.slice(0, 4), [...events.slice(0, 2), restarted]], () => ({ fn: 'fib' }));
    const { got, notes } = await run(f);
    expect(got).toEqual([0, 1, 2, 3, 'reset', 0, 1, 2]);
    expect(notes[0]).toMatch(/restarted/);
  });

  it('a different session at the same seq (restart or new session) replaces the page quietly', async () => {
    const other = FIXTURES.refused!.events; // seq 0 and 1, a different session
    const { f } = server([events.slice(0, 4), other], () => ({ fn: 'average' }));
    const { got } = await run(f);
    expect(got).toEqual([0, 1, 2, 3, 'reset', 0, 1]);
  });

  it('a new session that reuses seq numbers (as the server numbers each session from 1) starts over without the restart note', async () => {
    // What the real server sends when a function is opened: job.started (seq 1), then session.started (seq 1 again).
    const jobStarted: StampedEvent = { seq: 1, t: 0, event: { kind: 'job.started', job: 'open' } };
    const fresh = events.slice(0, 2).map((e, i) => ({ ...e, seq: i + 1 }));
    const { f } = server([[jobStarted, ...fresh]], () => ({ fn: 'fib' }));
    const { got, notes } = await run(f);
    expect(got).toEqual([1, 'reset', 1, 2]);
    expect(notes).toEqual([]);
  });

  it('a restarted server with no session clears the page', async () => {
    const { f } = server([events.slice(0, 4), []], () => ({ fn: '' }));
    const { got, notes } = await run(f);
    expect(got).toEqual([0, 1, 2, 3, 'reset']);
    expect(notes[0]).toMatch(/no session/);
  });

  it('a restart is applied to the store: the old session is gone, the new one is shown', async () => {
    const other = FIXTURES.refused!.events;
    const { f } = server([events.slice(0, 4), other], () => ({ fn: 'average' }));
    vi.useFakeTimers();
    const store = createStore();
    const off = attach(store, new LiveAdapter({ token: 't', fetch: f }));
    await vi.advanceTimersByTimeAsync(2_000);
    off();
    vi.useRealTimers();
    expect(store.state.value.fn).toBe('average');
    expect(store.events.value.length).toBe(other.length);
  });
});

describe('ScriptedAdapter', () => {
  it('answers null for what can be attempted: a fixture invents no statuses', async () => {
    const fx = FIXTURES.catch!;
    const a = new ScriptedAdapter(fx.events, { label: fx.title, stepMs: 0 });
    expect(await a.functionStatus(['src/math/fib.ts'])).toBeNull();
    expect(await a.pickFunctions('fib')).toBeNull();
    expect(await a.scanStatus()).toBeNull();
    expect(await a.startScan()).toBeNull();
  });
});
