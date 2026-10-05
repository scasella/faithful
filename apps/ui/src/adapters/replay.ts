/**
 * ReplayAdapter: plays a StampedEvent[] with the recorded timing (event.t, ms since the first event), with pause,
 * step, seek and speed. Used by dev mode `?mock=<name>` and by the showcase. Read-only: every action is refused.
 *
 * Playback state is exposed through `subscribe` so a control bar can render it. The clock is injectable for tests.
 */
import type { StampedEvent } from '@faithful/session';
import { ReadOnlyError, type Adapter, type CarveOption, type ConnectionStatus, type DoctorCheck, type FileEntry } from '../actions';

export interface Clock {
  setTimeout(f: () => void, ms: number): unknown;
  clearTimeout(h: unknown): void;
}

const realClock: Clock = {
  setTimeout: (f, ms) => setTimeout(f, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export const SPEEDS = [1, 2, 4, 8, 16, 64] as const;

export interface PlaybackState {
  /** Number of events delivered so far (0..total). */
  pos: number;
  total: number;
  playing: boolean;
  speed: number;
  /** Recorded time (ms since first event) of the last delivered event. */
  t: number;
  /** Recorded duration of the whole list. */
  duration: number;
}

export interface ReplayOptions {
  label: string;
  /** True for hand-authored fixtures: the UI shows "Development fixture, not a recording". */
  fixture: boolean;
  clock?: Clock;
  speed?: number;
}

export class ReplayAdapter implements Adapter {
  readonly readOnly = true;
  readonly label: string;
  readonly fixture: boolean;
  private events: StampedEvent[];
  private clock: Clock;
  private onEvent: ((e: StampedEvent) => void) | null = null;
  private onReset: (() => void) | null = null;
  private timer: unknown = null;
  private st: PlaybackState;
  private subs = new Set<(s: PlaybackState) => void>();

  constructor(events: StampedEvent[], opts: ReplayOptions) {
    this.events = [...events].sort((a, b) => a.seq - b.seq);
    this.label = opts.label;
    this.fixture = opts.fixture;
    this.clock = opts.clock ?? realClock;
    this.st = {
      pos: 0,
      total: this.events.length,
      playing: false,
      speed: opts.speed ?? 1,
      t: 0,
      duration: this.events.at(-1)?.t ?? 0,
    };
  }

  get state(): PlaybackState {
    return this.st;
  }

  subscribe(f: (s: PlaybackState) => void): () => void {
    this.subs.add(f);
    f(this.st);
    return () => this.subs.delete(f);
  }

  private set(p: Partial<PlaybackState>) {
    this.st = { ...this.st, ...p };
    for (const f of this.subs) f(this.st);
  }

  /** `onReset` is called before a backwards seek re-delivers events from the start. */
  connect(onEvent: (e: StampedEvent) => void, onStatus: (s: ConnectionStatus) => void = () => {}, onReset?: () => void): () => void {
    this.onEvent = onEvent;
    this.onReset = onReset ?? null;
    onStatus({ kind: 'open' });
    return () => {
      this.pause();
      this.onEvent = null;
      onStatus({ kind: 'closed' });
    };
  }

  private deliverNext(): boolean {
    const e = this.events[this.st.pos];
    if (!e) return false;
    this.onEvent?.(e);
    this.set({ pos: this.st.pos + 1, t: e.t });
    return true;
  }

  private schedule() {
    if (!this.st.playing) return;
    const next = this.events[this.st.pos];
    if (!next) {
      this.set({ playing: false });
      return;
    }
    const prevT = this.st.pos === 0 ? next.t : this.events[this.st.pos - 1]!.t;
    const wait = Math.max(0, (next.t - prevT) / this.st.speed);
    this.timer = this.clock.setTimeout(() => {
      this.timer = null;
      this.deliverNext();
      this.schedule();
    }, wait);
  }

  play() {
    if (this.st.playing) return;
    if (this.st.pos >= this.st.total) this.seek(0);
    this.set({ playing: true });
    this.schedule();
  }

  pause() {
    if (this.timer !== null) this.clock.clearTimeout(this.timer);
    this.timer = null;
    if (this.st.playing) this.set({ playing: false });
  }

  toggle() {
    if (this.st.playing) this.pause();
    else this.play();
  }

  /** Deliver exactly one event, paused. */
  step() {
    this.pause();
    this.deliverNext();
  }

  setSpeed(speed: number) {
    const wasPlaying = this.st.playing;
    this.pause();
    this.set({ speed });
    if (wasPlaying) this.play();
  }

  cycleSpeed() {
    const i = SPEEDS.indexOf(this.st.speed as (typeof SPEEDS)[number]);
    this.setSpeed(SPEEDS[(i + 1) % SPEEDS.length]!);
  }

  /** Move to position `pos` (number of events delivered). Backwards seeks reset and re-deliver. */
  seek(pos: number) {
    const target = Math.max(0, Math.min(pos, this.st.total));
    const wasPlaying = this.st.playing;
    this.pause();
    if (target < this.st.pos) {
      this.onReset?.();
      this.set({ pos: 0, t: 0 });
    }
    while (this.st.pos < target) this.deliverNext();
    if (wasPlaying && target < this.st.total) this.play();
  }

  toEnd() {
    this.seek(this.st.total);
  }

  private refuse(what: string): Promise<never> {
    return Promise.reject(new ReadOnlyError(what));
  }
  listFiles(): Promise<FileEntry[]> {
    return this.refuse('Listing files');
  }
  openFunction() {
    return this.refuse('Opening a function');
  }
  pasteFunction() {
    return this.refuse('Pasting a function');
  }
  chooseThrow() {
    return this.refuse('Choosing how to treat throw');
  }
  proposeSpec() {
    return this.refuse('Proposing a spec');
  }
  reviseSpec() {
    return this.refuse('Revising the spec');
  }
  rerunChallenge() {
    return this.refuse('Re-running the challenge');
  }
  carveOptions(): Promise<CarveOption[]> {
    return this.refuse('Listing carve-out classes');
  }
  rule() {
    return this.refuse('Ruling');
  }
  agree() {
    return this.refuse('Agreeing');
  }
  proveOriginal() {
    return this.refuse('Proving the original');
  }
  startOptimize() {
    return this.refuse('Optimizing');
  }
  acceptFasterNotProved() {
    return this.refuse('Accepting a candidate');
  }
  stopOptimize() {
    return this.refuse('Stopping');
  }
  deliver() {
    return this.refuse('Delivering');
  }
  doctor(): Promise<DoctorCheck[]> {
    return this.refuse('Checking the toolchain');
  }
}
