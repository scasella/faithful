/**
 * LiveAdapter: the Actions port over HTTP to the local `faithful` server (127.0.0.1 only). Route table: apps/ui/API.md.
 *
 * Every request carries `x-faithful-token` from `<meta name="faithful-token">` (the server substitutes it into
 * index.html). Events stream from GET /api/session/events as text/event-stream, read with fetch() because EventSource
 * cannot send the token header. Reconnects replay the whole stream and de-duplicate it (see `connect`).
 */
import type { StampedEvent, Threshold } from '@faithful/session';
import { PICK_MAX_LIMIT, type Adapter, type CarveOption, type ConnectionStatus, type DoctorCheck, type FileEntry, type FunctionStatuses, type PickOptions, type PickResult, type ProveBudget, type RulingInput, type ScanStatus, type TestedCheck } from '../actions';
import { SseParser } from '../lib/sse';

export function readToken(doc: Pick<Document, 'querySelector'> = document): string {
  return doc.querySelector<HTMLMetaElement>('meta[name="faithful-token"]')?.content ?? '';
}

/**
 * The server makes a new token each time it starts, so after a restart it refuses this page (401) until it is reloaded
 * (the reload picks up the new token from index.html). Said in those words instead of a bare status code.
 */
export const STALE_TOKEN = 'the local server does not accept this page any more (HTTP 401); it was probably restarted. Reload the page';

export interface LiveOptions {
  base?: string;
  token?: string;
  fetch?: typeof fetch;
}

export class LiveAdapter implements Adapter {
  readonly readOnly = false;
  readonly label = 'Live session';
  private base: string;
  private token: string;
  private f: typeof fetch;

  constructor(opts: LiveOptions = {}) {
    this.base = opts.base ?? '';
    this.token = opts.token ?? readToken();
    this.f = opts.fetch ?? ((...a) => fetch(...a));
  }

  private async call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const res = await this.f(this.base + path, {
      method,
      headers: { 'x-faithful-token': this.token, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    if (res.status === 401) throw new Error(STALE_TOKEN);
    if (!res.ok) {
      const msg = json && typeof json === 'object' && 'error' in json ? String((json as { error: unknown }).error) : `HTTP ${res.status}`;
      throw new Error(msg);
    }
    return json as T;
  }

  private post(path: string, body: unknown = {}): Promise<void> {
    return this.call<unknown>('POST', path, body).then(() => undefined);
  }

  listFiles(): Promise<FileEntry[]> {
    return this.call<FileEntry[]>('GET', '/api/files');
  }
  functionStatus(files: string[]): Promise<FunctionStatuses | null> {
    return this.call<FunctionStatuses>('POST', '/api/functions/status', { files });
  }
  pickFunctions(query: string, o: PickOptions = {}): Promise<PickResult | null> {
    const body: { query: string; limit?: number; includeUnrunnable?: boolean } = { query };
    if (o.limit !== undefined) body.limit = Math.max(1, Math.min(PICK_MAX_LIMIT, Math.floor(o.limit)));
    if (o.includeUnrunnable !== undefined) body.includeUnrunnable = o.includeUnrunnable;
    return this.call<PickResult>('POST', '/api/functions/pick', body);
  }
  scanStatus(): Promise<ScanStatus | null> {
    return this.call<ScanStatus>('GET', '/api/functions/scan');
  }
  startScan(): Promise<ScanStatus | null> {
    return this.call<ScanStatus>('POST', '/api/functions/scan/start', {});
  }
  openFunction(file: string, fn: string) {
    return this.post('/api/session/open', { file, fn });
  }
  pasteFunction(source: string, fn?: string) {
    return this.post('/api/session/paste', fn === undefined ? { source } : { source, fn });
  }
  chooseThrow(choice: 'precondition' | 'spec-case') {
    return this.post('/api/session/throw-choice', { choice });
  }
  proposeSpec() {
    return this.post('/api/spec/propose');
  }
  reviseSpec() {
    return this.post('/api/spec/revise');
  }
  rerunChallenge() {
    return this.post('/api/challenge/rerun');
  }
  rule(challengeId: string, ruling: RulingInput) {
    return this.post('/api/challenge/rule', { challengeId, ruling });
  }
  agree() {
    return this.post('/api/spec/agree');
  }
  proveOriginal(budget: ProveBudget) {
    return this.post('/api/prove/original', { budget });
  }
  startOptimize(threshold: Threshold) {
    return this.post('/api/optimize/start', { threshold });
  }
  startTestedOnly(threshold: Threshold, opts: { specials?: boolean } = {}) {
    return this.post('/api/tested/start', { threshold, specials: opts.specials === true });
  }
  acceptFasterNotProved(candidateId: number) {
    return this.post('/api/optimize/accept-faster-not-proved', { candidateId });
  }
  stopOptimize() {
    return this.post('/api/optimize/stop');
  }
  deliver() {
    return this.post('/api/deliver');
  }

  carveOptions(challengeId: string): Promise<CarveOption[]> {
    return this.call<CarveOption[]>('GET', `/api/challenge/carve-options?challengeId=${encodeURIComponent(challengeId)}`);
  }
  doctor(): Promise<DoctorCheck[]> {
    return this.call<DoctorCheck[]>('GET', '/api/doctor');
  }
  testedCheck(): Promise<TestedCheck> {
    return this.call<TestedCheck>('GET', '/api/tested/check');
  }

  /**
   * Every (re)connect asks for the whole stream (no `?since`), and events are de-duplicated by seq AND content:
   *   - same seq, same content: already delivered, skipped;
   *   - same seq, different content (the server restarted, and its seq numbering started again): `onReset`, then the
   *     server's events are delivered from the start, so the page shows exactly what the server has. A new
   *     `session.started` reusing a seq is a new session (the server numbers each session from 1 again, after the
   *     `job.started` of the open request): the page starts over without the restart note.
   * `?since` cannot detect a restart: a restarted server has no events at or below the last seq the page saw, so it
   * would send nothing until a new session passed that number. On a reconnect the adapter also asks for
   * `GET /api/session`; a server with no session while the page shows one has restarted, and the page is cleared.
   */
  connect(onEvent: (e: StampedEvent) => void, onStatus: (s: ConnectionStatus) => void = () => {}, onReset: () => void = () => {}): () => void {
    let closed = false;
    let seen = new Map<number, string>();
    let ctrl: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let backoff = 500;
    let attempt = 0;
    let note: string | undefined;

    const reset = (why: string) => {
      seen = new Map();
      note = why;
      onReset();
    };

    const run = async () => {
      if (closed) return;
      ctrl = new AbortController();
      const reconnect = attempt++ > 0;
      onStatus({ kind: 'connecting' });
      try {
        const res = await this.f(`${this.base}/api/session/events`, {
          headers: { 'x-faithful-token': this.token, accept: 'text/event-stream' },
          signal: ctrl.signal,
        });
        if (res.status === 401) throw new Error(STALE_TOKEN);
        if (!res.ok || !res.body) throw new Error(`event stream: HTTP ${res.status}`);
        if (reconnect && seen.size) {
          const st = await this.call<{ fn?: string }>('GET', '/api/session').catch(() => null);
          if (st && !st.fn) reset('The local server restarted and has no session; the page was cleared.');
        }
        onStatus(note ? { kind: 'open', note } : { kind: 'open' });
        note = undefined;
        backoff = 500;
        const parser = new SseParser();
        // Everything this connection has sent: after a restart reset, the events it sent before the mismatch (skipped
        // as duplicates then) are delivered again, so the page holds exactly the server's list.
        const conn: StampedEvent[] = [];
        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          for (const m of parser.push(value)) {
            if (m.event !== 'session') continue;
            const ev = JSON.parse(m.data) as StampedEvent;
            const body = JSON.stringify(ev.event);
            const had = seen.get(ev.seq);
            const earlier = conn.slice();
            conn.push(ev);
            if (had === body) continue; // already delivered (a reconnect replays from the start)
            if (had !== undefined) {
              if (ev.event.kind === 'session.started') {
                // The server numbers each session's events from 1 again (a new session, not a restart): start over quietly.
                seen = new Map();
                onReset();
              } else {
                reset('The local server restarted; the page now shows the session it has.');
                onStatus({ kind: 'open', note });
                note = undefined;
                for (const e of earlier) {
                  seen.set(e.seq, JSON.stringify(e.event));
                  onEvent(e);
                }
              }
            }
            seen.set(ev.seq, body);
            onEvent(ev);
          }
        }
        throw new Error('event stream ended');
      } catch (e) {
        if (closed) return;
        const inMs = backoff;
        backoff = Math.min(backoff * 2, 8_000);
        onStatus({ kind: 'retrying', inMs, error: (e as Error).message });
        timer = setTimeout(run, inMs);
      }
    };
    void run();
    return () => {
      closed = true;
      if (timer) clearTimeout(timer);
      ctrl?.abort();
      onStatus({ kind: 'closed' });
    };
  }
}
