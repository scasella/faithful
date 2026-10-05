/**
 * ScriptedAdapter: a development fixture you can DRIVE (dev mode `?mock=<name>&interactive`). Not read-only: every
 * Actions call is accepted and answered by releasing the fixture's next events up to the following decision point, so
 * the whole flow (Select → Translate → Agree → Prove → Optimize → Deliver) can be exercised with the keyboard against
 * the real screens. The fixture banner stays on; nothing runs and every number is still invented.
 *
 * What comes from the user, not the fixture:
 *   - rulings: `rule()` emits the user's own `ruling.made` (pinned to the latest proposal's hash); the fixture's rulings
 *     are skipped. A carve-out is picked from `carveOptions()` (the same deterministic menu the server offers); the
 *     fixture's own carve-out is used when the class matches it, else one is built the way the server builds it. Like
 *     the server, a carve-out ruling re-runs the challenge (the fixture's next run is released).
 *   - jobs: each action that the server runs as a job is wrapped in `job.started` / `job.finished`, as the server does.
 *   - the threshold: `startOptimize()` replaces the fixture's threshold with the chosen one.
 *   - accepting a faster-not-proved candidate: emits `candidate.decided` (accepted-at-verified) + `incumbent.changed`.
 * What the fixture cannot answer (a spec revision, a paste) is refused with a plain reason, shown inline.
 */
import type { SessionEvent, SessionState, StampedEvent, Threshold } from '@faithful/session';
import { replay as replayEvents } from '@faithful/session';
import type { Precondition, Val } from '@faithful/translate';
import type { Adapter, CarveClass, CarveOption, ConnectionStatus, DoctorCheck, FileEntry, ProveBudget, RulingInput } from '../actions';

export interface ScriptedOptions {
  label: string;
  /** Delay between streamed events, ms (default 120). Use 0 in tests. */
  stepMs?: number;
  setTimeout?(f: () => void, ms: number): unknown;
}

type Kind = SessionEvent['kind'];

export class ScriptedAdapter implements Adapter {
  readonly readOnly = false;
  readonly label: string;
  private script: StampedEvent[];
  /** Index of the next fixture event to release. */
  private pos = 0;
  private sent: SessionEvent[] = [];
  private onEvent: ((e: StampedEvent) => void) | null = null;
  private stepMs: number;
  private later: (f: () => void, ms: number) => unknown;
  private chain: Promise<void> = Promise.resolve();

  constructor(events: StampedEvent[], opts: ScriptedOptions) {
    this.script = [...events].sort((a, b) => a.seq - b.seq);
    this.label = opts.label;
    this.stepMs = opts.stepMs ?? 120;
    this.later = opts.setTimeout ?? ((f, ms) => setTimeout(f, ms));
  }

  connect(onEvent: (e: StampedEvent) => void, onStatus: (s: ConnectionStatus) => void = () => {}): () => void {
    this.onEvent = onEvent;
    onStatus({ kind: 'open' });
    return () => {
      this.onEvent = null;
      onStatus({ kind: 'closed' });
    };
  }

  /** State as the UI has it now (for decisions such as "which spec hash"). */
  private state(): SessionState {
    return replayEvents(this.sent);
  }

  private emit(event: SessionEvent) {
    const t = this.script[Math.max(0, Math.min(this.pos, this.script.length) - 1)]?.t ?? 0;
    const se: StampedEvent = { seq: this.sent.length, t, event };
    this.sent.push(event);
    this.onEvent?.(se);
  }

  private find(kind: Kind, from = this.pos): number {
    for (let i = from; i < this.script.length; i++) if (this.script[i]!.event.kind === kind) return i;
    return -1;
  }

  /**
   * Release fixture events up to and including index `end` (or up to, excluding, when `inclusive` is false), skipping
   * the fixture's own rulings. `map` may rewrite an event (e.g. the threshold). Streams with a short delay so live
   * screens (the catch moment) are seen arriving; resolves when all are delivered.
   */
  private release(end: number, opts: { inclusive?: boolean; stream?: boolean; map?: (e: SessionEvent) => SessionEvent; job?: string } = {}): Promise<void> {
    const last = opts.inclusive === false ? end - 1 : end;
    const run = async () => {
      while (this.pos <= last && this.pos < this.script.length) {
        const ev = this.script[this.pos]!.event;
        this.pos++;
        if (ev.kind === 'ruling.made') continue;
        this.emit(opts.map ? opts.map(ev) : ev);
        if (opts.stream && this.stepMs > 0) await new Promise<void>((r) => this.later(r, this.stepMs));
      }
    };
    const job = opts.job;
    const wrapped = job
      ? async () => {
          this.emit({ kind: 'job.started', job });
          await run();
          this.emit({ kind: 'job.finished', job });
        }
      : run;
    // Serialize: an action arriving mid-stream waits for the previous one.
    this.chain = this.chain.then(wrapped);
    return opts.stream ? Promise.resolve() : this.chain;
  }

  /** Resolves when every released event has been delivered (tests). */
  idle(): Promise<void> {
    return this.chain;
  }

  private refuse(why: string): Promise<never> {
    return Promise.reject(new Error(`${why} (development fixture: only the recorded path can be driven).`));
  }

  async listFiles(): Promise<FileEntry[]> {
    const start = this.script.find((e) => e.event.kind === 'session.started')?.event;
    if (!start || start.kind !== 'session.started') return [];
    const line = start.source.split('\n').findIndex((l) => l.includes(`function ${start.fn}`)) + 1;
    return [{ path: start.file, functions: [{ name: start.fn, line: Math.max(1, line), hasJsDoc: start.source.includes('/**') }] }];
  }

  async openFunction(file: string, fn: string): Promise<void> {
    const start = this.script[0]?.event;
    if (!start || start.kind !== 'session.started' || start.file !== file || start.fn !== fn) return this.refuse(`${fn} in ${file} is not in this fixture`);
    if (this.pos > 0) return this.refuse('This function is already open');
    // Up to the translation (and a throw choice, when the fixture has one, is left to the user).
    const tr = this.find('translate.done');
    return this.release(tr, { job: 'open' });
  }

  pasteFunction(): Promise<void> {
    return this.refuse('Pasting is not available here');
  }

  async chooseThrow(choice: 'precondition' | 'spec-case'): Promise<void> {
    const i = this.find('throw.choice');
    if (i >= 0) this.pos = i + 1;
    this.emit({ kind: 'throw.choice', choice });
  }

  proposeSpec(): Promise<void> {
    const run = this.find('challenge.run');
    if (run < 0) return this.refuse('No spec proposal is recorded');
    return this.release(run, { stream: true, job: 'spec-proposal' });
  }

  reviseSpec(): Promise<void> {
    return this.refuse('This fixture has no revised spec; rule "my function is wrong" to continue');
  }

  rerunChallenge(): Promise<void> {
    const run = this.find('challenge.run');
    const agreed = this.find('spec.agreed');
    if (run < 0 || (agreed >= 0 && run > agreed)) return this.refuse('No further challenge run is recorded');
    return this.release(run, { job: 'challenge' });
  }

  async carveOptions(challengeId: string): Promise<CarveOption[]> {
    const st = this.state();
    const c = st.challengeRuns.flatMap((r) => r.disagreements).find((d) => d.id === challengeId);
    if (!c || !st.translation?.ok) return this.refuse('Unknown challenge');
    return carveMenu(st.translation.value.params.map((p) => ({ name: p.name, k: p.ty.k })), c.input);
  }

  async rule(challengeId: string, ruling: RulingInput): Promise<void> {
    const st = this.state();
    const p = st.proposals.at(-1);
    if (!p || !p.validation.ok) return this.refuse('There is no spec to rule against');
    const specHash = p.validation.hash;
    if (ruling.ruling === 'spec-wrong' || ruling.then === 'fix-original') {
      this.emit({ kind: 'ruling.made', ruling: { ...ruling, challengeId, specHash } });
      return;
    }
    const c = st.challengeRuns.flatMap((r) => r.disagreements).find((d) => d.id === challengeId);
    if (!c || !st.translation?.ok) return this.refuse('Unknown challenge');
    const names = st.translation.value.params.map((x) => x.name);
    const carveOut = this.fixtureCarve(ruling.carve) ?? buildCarve(names, c.input, ruling.carve);
    const { carve: _c, ...rest } = ruling;
    this.emit({ kind: 'ruling.made', ruling: { ...rest, carveOut, challengeId, specHash } });
    // The server re-runs the challenge after a carve-out: release the fixture's next run, if it has one before agreeing.
    const run = this.find('challenge.run');
    const agreed = this.find('spec.agreed');
    if (run >= 0 && (agreed < 0 || run < agreed)) await this.release(run, { job: 'ruling' });
  }

  /** The fixture's own carve-out, when the user picked the class it encodes (recorded in its id as `carve-<kind>-<param>`). */
  private fixtureCarve(cls: CarveClass): Precondition | null {
    for (const e of this.script) {
      const ev = e.event;
      if (ev.kind === 'ruling.made' && ev.ruling.ruling === 'function-wrong' && ev.ruling.carveOut?.id.startsWith(`carve-${cls.kind}-${cls.param}`)) return ev.ruling.carveOut;
    }
    return null;
  }

  agree(): Promise<void> {
    const i = this.find('spec.agreed');
    if (i < 0) return this.refuse('No agreement is recorded');
    return this.release(i, { job: 'agree' });
  }

  proveOriginal(_budget: ProveBudget): Promise<void> {
    const i = this.find('proof.done');
    if (i < 0) return this.refuse('No proof is recorded');
    // Like the server: the proof run carries the budget the user chose.
    return this.release(i, { stream: true, job: 'prove-original', map: (e) => (e.kind === 'proof.started' ? { ...e, proof: { ...e.proof, budget: { ..._budget } } } : e) });
  }

  startOptimize(threshold: Threshold): Promise<void> {
    const i = this.find('optimize.stopped');
    if (i < 0) return this.refuse('No optimization is recorded');
    return this.release(i, { stream: true, job: 'optimize', map: (e) => (e.kind === 'optimize.started' ? { ...e, threshold } : e) });
  }

  async acceptFasterNotProved(candidateId: number): Promise<void> {
    const c = this.state().optimize.candidates.find((x) => x.id === candidateId);
    if (!c || c.outcome !== 'faster-not-proved') return this.refuse(`Candidate ${candidateId} is not faster-not-proved`);
    this.emit({ kind: 'candidate.decided', candidateId, outcome: 'accepted-at-verified', tier: c.tier, rejection: null, bench: c.bench, speedup: c.speedup });
    this.emit({ kind: 'incumbent.changed', candidateId });
  }

  stopOptimize(): Promise<void> {
    const i = this.find('optimize.stopped');
    if (i < 0) return this.refuse('Nothing to stop');
    return this.release(i);
  }

  deliver(): Promise<void> {
    const i = this.find('deliver.done');
    if (i < 0) return this.refuse('No delivery is recorded');
    return this.release(i, { job: 'deliver' });
  }

  doctor(): Promise<DoctorCheck[]> {
    return this.refuse('The toolchain check needs the local server');
  }
}

// ───────────── carve-out menu (mirrors packages/cli/src/flow/carveout.ts; fixtures only) ─────────────

function carveMenu(params: Array<{ name: string; k: string }>, input: Val[]): CarveOption[] {
  const out: CarveOption[] = [];
  params.forEach((p, i) => {
    const v = input[i];
    if (p.k === 'int' && typeof v === 'number') {
      if (v < 0) out.push({ cls: { param: i, kind: 'negative' }, excluded: `inputs where ${p.name} is negative` });
      if (v === 0) out.push({ cls: { param: i, kind: 'zero' }, excluded: `inputs where ${p.name} is 0` });
      if (v > 0) out.push({ cls: { param: i, kind: 'positive' }, excluded: `inputs where ${p.name} is positive` });
      out.push({ cls: { param: i, kind: 'equals' }, excluded: `inputs where ${p.name} is exactly ${v}` });
    } else if ((p.k === 'array' || p.k === 'string') && (Array.isArray(v) || typeof v === 'string')) {
      if (v.length === 0) out.push({ cls: { param: i, kind: 'empty' }, excluded: `inputs where ${p.name} is empty` });
      else out.push({ cls: { param: i, kind: 'length-equals' }, excluded: `inputs where ${p.name} has length ${v.length}` });
    }
  });
  out.push({ cls: { param: -1, kind: 'exact-input' }, excluded: `only the input ${JSON.stringify(input)}` });
  return out;
}

function buildCarve(names: string[], input: Val[], cls: CarveClass): Precondition {
  const opt = carveMenu(names.map((name, i) => ({ name, k: typeof input[i] === 'number' ? 'int' : Array.isArray(input[i]) ? 'array' : typeof input[i] })), input).find(
    (o) => o.cls.kind === cls.kind && o.cls.param === cls.param,
  );
  const n = names[cls.param] ?? '';
  const v = input[cls.param];
  const ts: Record<CarveClass['kind'], string> = {
    negative: `(${n} >= 0)`,
    zero: `(${n} !== 0)`,
    positive: `(${n} <= 0)`,
    equals: `(${n} !== ${JSON.stringify(v)})`,
    empty: `(${n}.length !== 0)`,
    'length-equals': `(${n}.length !== ${Array.isArray(v) || typeof v === 'string' ? v.length : 0})`,
    'exact-input': `!(${names.map((x, i) => `JSON.stringify(${x}) === ${JSON.stringify(JSON.stringify(input[i]))}`).join(' && ')})`,
  };
  return {
    id: `carve-${cls.kind}-${cls.param}-fixture`,
    kind: 'carve-out',
    words: `Carved out (known problem in the original): ${opt?.excluded ?? 'these inputs'} are excluded from everything proved below.`,
    lean: '',
    ts: ts[cls.kind],
  };
}
