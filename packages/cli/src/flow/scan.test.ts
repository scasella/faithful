/**
 * The background scan and the server-side ranking of the Pick list. Temp directories as repository roots; no model, no
 * Lean; nothing is written anywhere (the scan's own contract, checked here against a directory snapshot).
 *
 * Most tests use a stub backend so the order of events is exact (a gate holds the Tested preflight back, a flag says a
 * job is running); the end-to-end ones use the real worker pool, the real translator and the real sandboxes.
 */
import { mkdir, mkdtemp, readdir, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Sandbox } from '@faithful/engine';
import { listFiles } from './files.js';
import { PICK_MAX_AGE_MS, RepoScanner, compareMatches, matchRank, type PickResult } from './scan.js';
import {
  CLASSIFY_CHUNK,
  TriageTimeout,
  classifyFunction,
  clearTriageCache,
  quickInfo,
  slowStatus,
  unknownCause,
  type ClassifyItem,
  type FunctionStatus,
  type TriageBackend,
} from './triage.js';
import { createTriagePool, type TriagePool } from './triagePool.js';

const doc = (name: string, body: string): string => `/** ${name} */\n${body}`;
/** Inside the subset: provable. */
const gcd = (name: string): string => `export function ${name}(a: number, b: number): number {\n  if (a < b) {\n    return b - a;\n  }\n  return a - b;\n}\n`;
/** Refused (non-integer division), runnable on the Tested tier. */
const half = (name: string): string => `export function ${name}(x: number): number {\n  return x / 2;\n}\n`;
/** Uses a value it imports: cannot run on its own. */
const usesImport = (name: string): string => `import { scale } from './scale';\nexport function ${name}(x: number): number {\n  return x * scale / 3;\n}\n`;
/** A declaration it uses throws at load, with a percent sign in its message. */
const throwsAtLoad = (name: string): string =>
  `function compute(): number {\n  throw new Error('50% of the budget');\n}\nconst LIMIT: number = compute();\nexport function ${name}(x: number): number {\n  return x / LIMIT;\n}\n`;
const OVERLOADED = `/** Halves it. */\nexport function halve(n: number): number;\nexport function halve(n: string): string;\nexport function halve(n: any): any {\n  return n / 2;\n}\n`;

async function repoWith(files: Record<string, string>): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), 'faithful-scan-'));
  for (const [p, text] of Object.entries(files)) {
    await mkdir(join(repo, p, '..'), { recursive: true });
    await writeFile(join(repo, p), text);
  }
  return repo;
}

/** Every path under `dir` with its size and mtime: equal before and after means nothing was written. */
async function snapshot(dir: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (d: string): Promise<void> => {
    for (const e of await readdir(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      const st = await stat(p);
      out.push(`${p}:${st.size}:${st.mtimeMs}`);
      if (e.isDirectory()) await walk(p);
    }
  };
  await walk(dir);
  return out.sort();
}

interface Stub extends TriageBackend {
  quickCalls: number;
  classifyCalls: string[];
  /** Hold every Tested preflight until `release()`. */
  hold(): void;
  release(): void;
  /** Decide a function by name (default: tested). */
  decide: (name: string) => FunctionStatus;
}

/** A backend with the real quick pass, and a Tested preflight that is a table lookup (held back on demand). */
function stub(): Stub {
  let gate: Promise<void> | null = null;
  let open: () => void = () => undefined;
  const s: Stub = {
    quickCalls: 0,
    classifyCalls: [],
    hold() {
      gate = new Promise<void>((r) => (open = r));
    },
    release() {
      open();
      gate = null;
    },
    decide: () => ({ tier: 'tested', reason: null }),
    async quick(text) {
      s.quickCalls++;
      return quickInfo(text);
    },
    async classify(_text, items: ClassifyItem[]) {
      for (const i of items) s.classifyCalls.push(i.name);
      if (gate) await gate;
      return Object.fromEntries(items.map((i) => [i.name, s.decide(i.name)]));
    },
    close: async () => undefined,
  };
  return s;
}

let sandbox: Sandbox;
let pool: TriagePool;
beforeAll(async () => {
  sandbox = await Sandbox.open();
  pool = createTriagePool({ size: 2 });
});
afterAll(async () => {
  await pool?.close();
  await sandbox?.close();
});
beforeEach(() => clearTriageCache());

const scanner = (repo: string, backend: TriageBackend, extra: Partial<ConstructorParameters<typeof RepoScanner>[0]> = {}): RepoScanner =>
  new RepoScanner({ repoRoot: repo, backend, concurrency: 1, ...extra });

async function settled(sc: RepoScanner, query = '', o: { limit?: number; includeUnrunnable?: boolean } = {}): Promise<PickResult> {
  const first = await sc.pick(query, o);
  void first;
  await sc.idle();
  return sc.pick(query, o);
}

const names = (r: PickResult): string[] => r.rows.map((x) => x.name);

describe('ranking', () => {
  it('provable first, then testable, then not decided, never a function that cannot run; counts cover every match', async () => {
    const repo = await repoWith({
      'a.ts': half('aTested') + usesImport('aNone'),
      'b.ts': gcd('bProvable'),
      'c.ts': gcd('cProvable') + half('cTested'),
    });
    const back = stub();
    back.decide = (n) => (n === 'aNone' ? { tier: 'none', reason: 'Cannot run on its own: it uses scale.' } : { tier: 'tested', reason: null });
    // while the Tested preflight is held back: only the provable ones are known, the rest wait ("not reached yet")
    back.hold();
    const sc = scanner(repo, back);
    let r = await sc.pick('');
    // the translator's pass is over once the Tested preflight has been asked for the first time (and is held)
    for (let i = 0; i < 300 && back.classifyCalls.length === 0; i++) await new Promise((x) => setTimeout(x, 10));
    r = await sc.pick('');
    expect(r.rows.slice(0, 2).map((x) => [x.name, x.tier])).toEqual([
      ['bProvable', 'provable'],
      ['cProvable', 'provable'],
    ]);
    expect(r.rows.slice(2).every((x) => x.tier === 'unknown' && x.reason === 'Not checked yet: the scan has not reached it.')).toBe(true);
    expect(r.counts).toEqual({ provable: 2, tested: 0, unknown: 3, none: 0 });
    expect(r.scan.state).toBe('running');
    back.release();
    r = await settled(sc, '', { includeUnrunnable: true });
    expect(r.scan.state).toBe('done');
    expect(r.rows.map((x) => [x.name, x.tier])).toEqual([
      ['bProvable', 'provable'],
      ['cProvable', 'provable'],
      ['aTested', 'tested'],
      ['cTested', 'tested'],
    ]);
    expect(r.counts).toEqual({ provable: 2, tested: 2, unknown: 0, none: 1 });
    expect(r.totalMatches).toBe(5);
    expect(r.cannotRun).toEqual([{ file: 'a.ts', name: 'aNone', line: 5, hasJsDoc: false, tier: 'none', reason: 'Cannot run on its own: it uses scale.' }]);
    // without includeUnrunnable the can't-run list is empty (the count still says how many there are)
    const plain = await sc.pick('');
    expect(plain.cannotRun).toEqual([]);
    expect(plain.counts.none).toBe(1);
  });

  it('within a tier: an exact name outranks a prefix, which outranks any other match; then a documented function; then path, then line', async () => {
    const repo = await repoWith({
      'a.ts': gcd('behalfOf') + gcd('halfway'),
      'b.ts': doc('documented', gcd('halfDocumented')) + gcd('half'),
      'c.ts': gcd('halfPlain'),
      'd.ts': gcd('halfZ') + doc('documented', gcd('halfA')),
    });
    const sc = scanner(repo, stub());
    const r = await settled(sc, 'half', { limit: 50 });
    // exact `half`; then the prefix matches (documented first: halfDocumented, halfA; then path, then line: halfPlain (c), halfZ (d), halfway (a)... )
    expect(names(r)).toEqual(['half', 'halfDocumented', 'halfA', 'halfway', 'halfPlain', 'halfZ', 'behalfOf']);
    expect(r.counts.provable).toBe(7);
    expect(r.totalMatches).toBe(7);
  });

  it('a name that contains the query outranks a path-only or scattered-letters match, even one with a JSDoc', async () => {
    const repo = await repoWith({
      'a.ts': gcd('isEven'), // prefix
      'b.ts': gcd('thisOne'), // contains, undocumented
      'c.ts': doc('documented', gcd('iXsY')), // letters in order, documented
      'lib/isolated.ts': doc('documented', gcd('plain')), // the path contains it, documented
    });
    const r = await settled(scanner(repo, stub()), 'is', { limit: 50 });
    expect(names(r)).toEqual(['isEven', 'thisOne', 'iXsY', 'plain']); // then the two documented ones, by path
  });

  it('JSDoc breaks ties before path and line, in every tier', async () => {
    const repo = await repoWith({
      'a.ts': half('aPlain'),
      'z.ts': doc('documented', half('zDocumented')),
      'b.ts': gcd('bPlain'),
      'y.ts': doc('documented', gcd('yDocumented')),
    });
    const r = await settled(scanner(repo, stub()), '', { limit: 50 });
    expect(names(r)).toEqual(['yDocumented', 'bPlain', 'zDocumented', 'aPlain']);
  });

  it('the limit defaults to 8 and is at most 50, totals and counts still cover every match', async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 60; i++) files[`f${String(i).padStart(2, '0')}.ts`] = gcd(`fn${i}`);
    const sc = scanner(await repoWith(files), stub());
    const def = await settled(sc, '');
    expect(def.rows).toHaveLength(8);
    expect(def.totalMatches).toBe(60);
    expect(def.counts.provable).toBe(60);
    expect((await sc.pick('', { limit: 1000 })).rows).toHaveLength(50);
    expect((await sc.pick('', { limit: 0 })).rows).toHaveLength(1);
    // fn5 and fn50..fn59 contain it; fn15, fn25, fn35, fn45 have its letters in order (the page's typeahead matches those too)
    expect((await sc.pick('fn5')).totalMatches).toBe(15);
  });

  it('matches the way the page does: exact, prefix, substring, path, letters in order', () => {
    expect(matchRank('half', 'half', 'a.ts')).toBe(0);
    expect(matchRank('half', 'halfway', 'a.ts')).toBe(1);
    expect(matchRank('half', 'behalf', 'a.ts')).toBe(2);
    expect(matchRank('a.ts half', 'behalf', 'src/a.ts')).toBe(3);
    expect(matchRank('src/a', 'zzz', 'src/a.ts')).toBe(4);
    expect(matchRank('fbn', 'fibonacci', 'x.ts')).toBe(5);
    expect(matchRank('nope', 'fibonacci', 'x.ts')).toBeNull();
    expect(matchRank('', 'anything', 'x.ts')).toBe(0);
    const m = (tier: 'provable' | 'tested', group: number, hasJsDoc: boolean, file: string, line: number) => ({ file, name: 'n', line, hasJsDoc, tier, reason: null, group });
    expect(compareMatches(m('tested', 0, true, 'a', 1), m('provable', 2, false, 'z', 9))).toBeGreaterThan(0);
  });
});

describe('what is not decided', () => {
  it('"not reached yet" and "took longer than the cap" are told apart in the reason; a slow function is not retried', async () => {
    const repo = await repoWith({ 'a.ts': half('slowOne') + half('fastOne') });
    const back = stub();
    back.decide = (n) => (n === 'slowOne' ? slowStatus(3000) : { tier: 'tested', reason: null });
    const sc = scanner(repo, back);
    const r = await settled(sc, '', { limit: 50 });
    expect(r.rows.map((x) => [x.name, x.tier])).toEqual([
      ['fastOne', 'tested'],
      ['slowOne', 'unknown'],
    ]);
    expect(r.rows[1]!.reason).toBe('Checking took longer than 3 seconds; not run.');
    expect(unknownCause(r.rows[1]!)).toBe('slow');
    expect(r.counts).toEqual({ provable: 0, tested: 1, unknown: 1, none: 0 });
    // another pass over the same content asks nothing again
    const calls = back.classifyCalls.length;
    sc.start({ maxAgeMs: 0 });
    await sc.idle();
    expect(back.classifyCalls.length).toBe(calls);
    expect((await sc.pick('')).rows[1]!.reason).toBe('Checking took longer than 3 seconds; not run.');
  });

  it('a file whose cheap pass gave up: every function says it took longer than the budget, nothing is asked again for that content', async () => {
    const repo = await repoWith({ 'a.ts': half('one') + half('two'), 'b.ts': gcd('fine') });
    const back = stub();
    const quickOf = back.quick.bind(back);
    let gaveUp = 0;
    back.quick = async (text, o) => {
      if (text.includes('function one')) {
        gaveUp++;
        throw new TriageTimeout(30_000);
      }
      return quickOf(text, o);
    };
    const sc = scanner(repo, back);
    const r = await settled(sc, '', { limit: 50 });
    expect(r.rows.map((x) => [x.name, x.tier])).toEqual([
      ['fine', 'provable'],
      ['one', 'unknown'],
      ['two', 'unknown'],
    ]);
    expect(r.rows[1]!.reason).toBe('Checking took longer than 30 seconds; not run.');
    expect(unknownCause(r.rows[1]!)).toBe('slow');
    expect(r.counts).toEqual({ provable: 1, tested: 0, unknown: 2, none: 0 });
    expect(sc.status()).toMatchObject({ state: 'done', filesDone: 2, filesTotal: 2 });
    expect(back.classifyCalls).toEqual([]); // nothing of it was classified
    sc.start({ maxAgeMs: 0 });
    await sc.idle();
    expect(gaveUp).toBe(1); // not tried again while the file is unchanged
  });

  it('a check that itself failed is tried once more in the same pass, then stays "failed"', async () => {
    const repo = await repoWith({ 'a.ts': half('flaky') + half('broken') });
    const back = stub();
    const seen = new Map<string, number>();
    back.decide = (n) => {
      seen.set(n, (seen.get(n) ?? 0) + 1);
      if (n === 'broken' || (n === 'flaky' && seen.get(n) === 1)) return { tier: 'unknown', reason: 'The check itself failed; not run.' };
      return { tier: 'tested', reason: null };
    };
    const sc = scanner(repo, back);
    const r = await settled(sc, '', { limit: 50 });
    expect(r.rows.map((x) => [x.name, x.tier, unknownCause(x)])).toEqual([
      ['flaky', 'tested', null],
      ['broken', 'unknown', 'failed'],
    ]);
    expect(seen.get('flaky')).toBe(2);
    expect(seen.get('broken')).toBe(2);
    // a pass that ends counts a file whose check failed as dealt with: progress reaches its total
    expect(r.scan).toMatchObject({ state: 'done', filesDone: 1, filesTotal: 1 });
  });

  it('a file that cannot be read from inside the repository is not part of the list (and the scan does not stumble on it)', async () => {
    const outer = await mkdtemp(join(tmpdir(), 'faithful-scan-outer-'));
    await writeFile(join(outer, 'outside.ts'), gcd('outsider'));
    const repo = await repoWith({ 'in.ts': gcd('insider') });
    await symlink(join(outer, 'outside.ts'), join(repo, 'link.ts'));
    // the listing itself leaves a link that escapes the repository out
    expect((await listFiles(repo)).map((f) => f.path)).toEqual(['in.ts']);
    // and a listing that includes one anyway (a race, a stale list) is handled by the read's own containment check
    const sc = scanner(repo, stub(), { list: async () => [{ path: 'in.ts', functions: [{ name: 'insider', line: 1, hasJsDoc: false }] }, { path: 'link.ts', functions: [{ name: 'outsider', line: 1, hasJsDoc: false }] }] });
    const r = await settled(sc, '');
    expect(names(r)).toEqual(['insider']);
    expect(r.totalMatches).toBe(1);
    expect(r.scan.filesTotal).toBe(1);
  });

  it.each([['in this thread', () => stub()], ['in the worker pool', () => pool]] as const)('files that do not parse or are not text never fail the scan (%s)', async (_how, backend) => {
    const repo = await repoWith({
      'ok.ts': gcd('fine'),
      'garbage.ts': 'export function (((( {{{ ]]] =>',
      'unterminated.ts': 'export function a(x: number): number {\n  return `${x',
      'binary.ts': '\u0000\u0001\u0002 export function \uffff',
      'empty.ts': '',
      'weird.mts': 'export const x = ; export function y( : number {',
      'half-done.ts': 'export function z(x: number): number {\n  return x / 2;\n',
      'huge-line.ts': `export function big(x: number): number { return x${' + 1'.repeat(30000)}; }\n`,
    });
    const sc = scanner(repo, backend());
    const r = await settled(sc, '', { limit: 50, includeUnrunnable: true });
    expect(r.scan.state).toBe('done');
    expect(r.rows.find((x) => x.name === 'fine')?.tier).toBe('provable');
    // whatever the tolerant parser made of the rest, nothing is left undecided by an exception
    for (const x of [...r.rows, ...r.cannotRun]) if (x.tier === 'unknown') expect(unknownCause(x)).not.toBe('pending');
  });

  it('a backend that rejects makes that file unknown ("failed"), never an exception', async () => {
    const repo = await repoWith({ 'a.ts': half('one'), 'b.ts': gcd('two') });
    const back = stub();
    back.quick = async (text) => {
      if (text.includes('one')) throw new Error('worker pool exploded');
      return quickInfo(text);
    };
    const sc = scanner(repo, back);
    const r = await settled(sc, '', { limit: 50 });
    expect(r.scan.state).toBe('done');
    expect(r.rows.map((x) => [x.name, x.tier])).toEqual([
      ['two', 'provable'],
      ['one', 'unknown'],
    ]);
    expect(unknownCause(r.rows[1]!)).toBe('failed');
  });
});

describe('overloads', () => {
  it('an overloaded function is one row, at its lowest line, with the reason that it is overloaded', async () => {
    const repo = await repoWith({ 'o.ts': OVERLOADED });
    const files = await listFiles(repo);
    expect(files).toEqual([{ path: 'o.ts', functions: [{ name: 'halve', line: 2, hasJsDoc: true }] }]);
    const sc = scanner(repo, pool);
    const r = await settled(sc, '', { includeUnrunnable: true });
    expect(r.totalMatches).toBe(1);
    expect(r.rows).toEqual([]);
    expect(r.cannotRun).toHaveLength(1);
    expect(r.cannotRun[0]).toMatchObject({ file: 'o.ts', name: 'halve', line: 2, hasJsDoc: true, tier: 'none' });
    expect(r.cannotRun[0]!.reason).toMatch(/is overloaded/);
  });
});

describe('reasons are safe for the page', () => {
  it('no percent sign (and no "percent") in anything the pick answers, including a reason that quotes one', async () => {
    const repo = await repoWith({ 'a.ts': throwsAtLoad('lim') + usesImport('imp'), 'b.ts': half('h') });
    const sc = scanner(repo, pool);
    const r = await settled(sc, '', { includeUnrunnable: true, limit: 50 });
    const lim = r.cannotRun.find((x) => x.name === 'lim');
    expect(lim?.reason).toContain('50 mod of the budget');
    const text = JSON.stringify(r);
    expect(text).not.toMatch(/%/);
    expect(text).not.toMatch(/\bpercent\b/i);
    for (const x of [...r.rows, ...r.cannotRun]) expect((x.reason ?? '').length).toBeLessThanOrEqual(340);
  });
});

describe('the scan is read-only, bounded, polite', () => {
  it('writes nothing: not a file, not a directory, not even `.faithful`', async () => {
    const repo = await repoWith({ 'a.ts': half('a') + usesImport('b'), 'sub/c.ts': gcd('c') });
    const before = await snapshot(repo);
    const sc = scanner(repo, pool);
    await settled(sc, '', { includeUnrunnable: true });
    sc.start({ maxAgeMs: 0 });
    await sc.idle();
    expect(await snapshot(repo)).toEqual(before);
    expect(await readdir(repo)).not.toContain('.faithful');
  });

  it('start is idempotent: a pass in progress is not restarted, a fresh result is not re-scanned, a stale one is (all cache hits, nothing changes)', async () => {
    const repo = await repoWith({ 'a.ts': half('a'), 'b.ts': gcd('b') });
    const back = stub();
    back.hold();
    let clock = 1_000;
    const sc = scanner(repo, back, { now: () => clock });
    expect(sc.status().state).toBe('idle');
    const first = sc.start();
    expect(first.state).toBe('running');
    expect(sc.start().state).toBe('running');
    back.release();
    await sc.idle();
    const done = sc.status();
    expect(done).toMatchObject({ state: 'done', filesDone: 2, filesTotal: 2 });
    const calls = [back.quickCalls, back.classifyCalls.length];
    clock += 1000;
    expect(sc.start().state).toBe('done'); // finished a second ago: nothing to do
    clock += 10_000;
    // a pass over an unchanged repository does not make the page's progress fall back to zero
    expect(sc.start()).toMatchObject({ state: 'running', filesDone: 2, filesTotal: 2 });
    await sc.idle();
    // every file was a cache hit: no new work, and nothing a ranking could notice changed
    expect([back.quickCalls, back.classifyCalls.length]).toEqual(calls);
    expect(sc.status()).toEqual(done);
  });

  it('pauses while a session job runs and carries on when it ends', async () => {
    const repo = await repoWith({ 'a.ts': gcd('a'), 'b.ts': gcd('b'), 'c.ts': gcd('c') });
    let busy = true;
    const sc = scanner(repo, stub(), { isBusy: () => busy });
    sc.start();
    await new Promise((r) => setTimeout(r, 250));
    // listed, but nothing was checked: the scan is waiting
    expect(sc.status()).toMatchObject({ state: 'running', filesDone: 0, filesTotal: 3 });
    expect((await sc.pick('')).rows.every((x) => x.tier === 'unknown')).toBe(true);
    busy = false;
    sc.poke();
    await sc.idle();
    expect(sc.status()).toMatchObject({ state: 'done', filesDone: 3 });
    // a job starting mid-scan freezes progress at the unit in flight
    busy = true;
    sc.start({ maxAgeMs: 0 });
    await new Promise((r) => setTimeout(r, 100));
    const paused = sc.status().state;
    busy = false;
    sc.poke();
    await sc.idle();
    expect(['running', 'done']).toContain(paused);
    expect(sc.status().state).toBe('done');
  });

  it('pauses between chunks of one file\'s functions, not only between files', async () => {
    const n = 2 * CLASSIFY_CHUNK + 1;
    const repo = await repoWith({ 'a.ts': Array.from({ length: n }, (_, i) => half(`h${i}`)).join('') });
    const inner = stub();
    let busy = false;
    let asked = 0;
    const back: TriageBackend = {
      ...inner,
      classify: async (t, items, o) => {
        const r = await inner.classify(t, items, o);
        if (++asked === 1) busy = true; // a session job starts right after the first chunk
        return r;
      },
    };
    const sc = scanner(repo, back, { isBusy: () => busy });
    sc.start();
    await new Promise((r) => setTimeout(r, 400));
    // the first chunk was asked; the file's other functions wait for the job to end
    expect(inner.classifyCalls).toHaveLength(CLASSIFY_CHUNK);
    expect(sc.status().state).toBe('running');
    busy = false;
    sc.poke();
    await sc.idle();
    expect(inner.classifyCalls).toHaveLength(n);
    expect((await sc.pick('', { limit: 50 })).counts.tested).toBe(n);
  });

  it('a change made while the page stays open is noticed by the next pick once the last pass is older than PICK_MAX_AGE_MS, not before', async () => {
    const repo = await repoWith({ 'a.ts': gcd('a') });
    let clock = 5_000;
    const sc = scanner(repo, stub(), { now: () => clock });
    await settled(sc, '');
    await writeFile(join(repo, 'b.ts'), gcd('b'));
    clock += PICK_MAX_AGE_MS - 1000;
    expect(names(await sc.pick(''))).toEqual(['a']); // too soon: answered from what is known
    await sc.idle();
    expect(sc.status().state).toBe('done');
    clock += 2000;
    await sc.pick(''); // older than the limit: starts a pass
    await sc.idle();
    expect(names(await sc.pick(''))).toEqual(['a', 'b']);
  });

  it('does the files the latest query matches first', async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 12; i++) files[`f${String(i).padStart(2, '0')}.ts`] = half(`fn${i}`);
    files['zz.ts'] = half('target');
    const back = stub();
    back.hold();
    const sc = scanner(await repoWith(files), back);
    await sc.pick('target'); // starts the scan and asks for `target`
    for (let i = 0; i < 200 && back.classifyCalls.length === 0; i++) await new Promise((r) => setTimeout(r, 10));
    back.release();
    await sc.idle();
    // 12 other files are alphabetically earlier; the one the query names was taken before them
    expect(back.classifyCalls[0]).toBe('target');
  });

  it('a changed file is classified again on the next pass; unchanged files are not', async () => {
    const repo = await repoWith({ 'a.ts': half('a'), 'b.ts': half('b') });
    const back = stub();
    const sc = scanner(repo, back);
    await settled(sc, '');
    expect(back.classifyCalls.sort()).toEqual(['a', 'b']);
    const v = sc.status().version;
    await writeFile(join(repo, 'b.ts'), gcd('b')); // now provable
    sc.start({ maxAgeMs: 0 });
    await sc.idle();
    expect(back.classifyCalls.sort()).toEqual(['a', 'b']); // `a` was not asked again; `b` is provable and needs no preflight
    const r = await sc.pick('b');
    expect(r.rows[0]).toMatchObject({ name: 'b', tier: 'provable' });
    expect(sc.status().version).toBeGreaterThan(v);
  });

  it('keeps only paths, hashes and statuses: nothing of a file`s text is in the answers, and the listing is bounded', async () => {
    const SECRET = 'SECRET_TOKEN_THAT_IS_ONLY_IN_THE_SOURCE';
    const repo = await repoWith({ 'a.ts': `const s = '${SECRET}';\n` + half('a') });
    const sc = scanner(repo, pool);
    const r = await settled(sc, '', { includeUnrunnable: true });
    expect(JSON.stringify(r)).not.toContain(SECRET);
    // a listing beyond the bounds is cut, not tracked
    const many = Array.from({ length: 2300 }, (_, i) => ({ path: `m${i}.ts`, functions: [{ name: `f${i}`, line: 1, hasJsDoc: false }] }));
    const bounded = scanner(repo, stub(), { list: async () => many });
    bounded.start();
    await bounded.idle();
    expect(bounded.status().filesTotal).toBeLessThanOrEqual(2000);
  });
});

describe('function names that are properties of every object', () => {
  const odd = ['__proto__', 'constructor', 'toString', 'valueOf', 'hasOwnProperty', 'then'];
  const ok = new Set(['provable', 'tested', 'unknown', 'none']);
  const check = (r: PickResult, total: number): void => {
    expect(Object.keys(r.counts).sort()).toEqual(['none', 'provable', 'tested', 'unknown']);
    expect(Object.values(r.counts).reduce((a, b) => a + b, 0)).toBe(total);
    for (const x of [...r.rows, ...r.cannotRun]) expect(ok.has(x.tier), `${x.name}: ${String(x.tier)}`).toBe(true);
  };

  it('each is a row of its own with a real tier, and the counts have exactly the four keys (stub backend)', async () => {
    const repo = await repoWith({ 'a.ts': gcd('plain') + odd.map((n) => half(n)).join('') });
    const r = await settled(scanner(repo, stub()), '', { limit: 50 });
    check(r, 1 + odd.length);
    expect(r.rows.map((x) => x.name).sort()).toEqual(['plain', ...odd].sort());
    expect(r.rows.filter((x) => x.tier === 'tested').map((x) => x.name).sort()).toEqual([...odd].sort());
  });

  it('the same through the real worker pool', async () => {
    const repo = await repoWith({ 'a.ts': gcd('plain') + odd.map((n) => half(n)).join('') });
    const r = await settled(scanner(repo, pool), '', { limit: 50 });
    check(r, 1 + odd.length);
    expect(r.rows.filter((x) => x.tier === 'tested').map((x) => x.name).sort()).toEqual([...odd].sort());
  });
});

describe('the same verdicts wherever they are computed', () => {
  it('the worker pool and the in-thread classification agree on every fixture', async () => {
    const src: Record<string, [string, string]> = {
      gcd: [gcd('gcd'), 'gcd'],
      half: [half('half'), 'half'],
      imp: [usesImport('imp'), 'imp'],
      load: [throwsAtLoad('lim'), 'lim'],
    };
    const repo = await repoWith(Object.fromEntries(Object.entries(src).map(([k, [t]]) => [`${k}.ts`, t])));
    const sc = scanner(repo, pool);
    const r = await settled(sc, '', { includeUnrunnable: true, limit: 50 });
    const got = new Map([...r.rows, ...r.cannotRun].map((x) => [x.name, x] as const));
    for (const [text, fn] of Object.values(src)) {
      const want = await classifyFunction(text, fn, { sandbox });
      expect({ tier: got.get(fn)!.tier, reason: got.get(fn)!.reason }, fn).toEqual({ tier: want.tier, reason: want.reason });
    }
  });
});
