/**
 * Triage: which exported functions Faithful can run (provable / tested / none / unknown). Real translator, real signature
 * inference, real sandbox; temp directories as repository roots; no model, no Lean, nothing written anywhere.
 */
import { mkdir, mkdtemp, readFile, readdir, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resolveConfig } from '@faithful/core';
import { Sandbox, liveSandboxWorkers, type LoadResult } from '@faithful/engine';
import { CodexClient } from '@faithful/prover';
import { createApi } from '../api.js';
import { SessionRuntime } from './runtime.js';
import {
  CLASSIFY_CHUNK,
  MAX_REASON,
  QUICK_BEAT,
  TriageTimeout,
  classifyFile,
  classifyFiles,
  classifyFunction,
  classifyText,
  clearTriageCache,
  getOwn,
  pickReason,
  quickInfo,
  quickText,
  tidyReason,
  unknownCause,
  type QuickInfo,
  type SandboxLike,
  type TriageBackend,
  type TriageDeps,
} from './triage.js';

/** Inside the subset: integers only. */
const GCD = `export function gcd(a: number, b: number): number {
  if (a < b) {
    return b - a;
  }
  return a - b;
}
`;

/** Refused (non-integer division), runnable on the Tested tier. */
const HALF = `export function half(x: number): number {
  return x / 2;
}
`;

/** Uses a value it imports: cannot run on its own. */
const USES_IMPORT = `import { scale } from './scale';
export function scaled(x: number): number {
  return x * scale / 3;
}
`;

/** An unrelated import elsewhere in the file: blocks the whole-file load, not an extracted unit. */
const UNRELATED_IMPORT = `import { readFileSync } from 'node:fs';
export function readIt(p: string): string {
  return readFileSync(p, 'utf8');
}
export function third(x: number): number {
  return x / 3;
}
`;

/** Top-level code touching ambient state at load. */
const CLOCK_AT_LOAD = `const started = Date.now();
export function since(x: number): number {
  return (x - started) / 1000;
}
`;

const GENERIC = `export function first<T>(xs: T[]): T | undefined {
  return xs[0];
}
`;

let sandbox: Sandbox;
let deps: TriageDeps;
beforeAll(async () => {
  sandbox = await Sandbox.open();
  deps = { sandbox };
});
afterAll(async () => {
  await sandbox?.close();
});
beforeEach(() => clearTriageCache());

async function repoWith(files: Record<string, string>): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), 'faithful-triage-'));
  for (const [p, text] of Object.entries(files)) {
    await mkdir(join(repo, p, '..'), { recursive: true });
    await writeFile(join(repo, p), text);
  }
  return repo;
}

describe('classifyFunction', () => {
  it('a self-contained integer function is provable (strongest, even though the Tested tier could run it too)', async () => {
    expect(await classifyFunction(GCD, 'gcd', deps)).toEqual({ tier: 'provable', reason: null });
  });

  it('a float function the translator refuses is tested', async () => {
    expect(await classifyFunction(HALF, 'half', deps)).toEqual({ tier: 'tested', reason: null });
  });

  it('a function that uses an imported value cannot run, with a plain reason', async () => {
    const s = await classifyFunction(USES_IMPORT, 'scaled', deps);
    expect(s.tier).toBe('none');
    expect(s.reason).toMatch(/^Cannot run on its own: .*scale.*\(line \d+, column \d+\)\./);
    expect(s.reason).toContain('The translator refuses it too (syntax outside the subset).');
    expect(s.reason).not.toContain('scaled cannot');
  });

  it('a function in a file with an UNRELATED import is tested (extracted unit); the one using the import is not', async () => {
    expect(await classifyFunction(UNRELATED_IMPORT, 'third', deps)).toEqual({ tier: 'tested', reason: null });
    const s = await classifyFunction(UNRELATED_IMPORT, 'readIt', deps);
    expect(s.tier).toBe('none');
    expect(s.reason).toMatch(/^Cannot run on its own: .*readFileSync.*\(line \d+, column \d+\)\./);
  });

  it('an unrelated top-level side effect no longer blocks; the declarations the unit carries are named', async () => {
    const src = `const live = new Set<number>();\nconst SCALE = 3;\nexport function scaleIt(x: number): number {\n  return x / SCALE;\n}\nexport function track(n: number): number {\n  live.add(n);\n  return live.size;\n}\n`;
    expect(await classifyFunction(src, 'scaleIt', deps)).toEqual({ tier: 'tested', reason: null, included: ['SCALE'] });
  });

  it('top-level code that touches the clock at load: none, in the Tested wording', async () => {
    const s = await classifyFunction(CLOCK_AT_LOAD, 'since', deps);
    expect(s.tier).toBe('none');
    expect(s.reason).toBe('Cannot run on its own: a declaration it uses from its file uses Date.now when the file loads. The translator refuses it too (syntax outside the subset).');
  });

  it('when extraction refuses, the whole file is tried (as the Tested run does); it can still be tested', async () => {
    // dropping \`Object.freeze(SCALE)\` could change what half2 sees, so extraction refuses; the whole file loads
    const src = `const SCALE = { k: 2 };\nexport function half2(x: number): number {\n  return x / SCALE.k;\n}\nObject.freeze(SCALE);\n`;
    expect(await classifyFunction(src, 'half2', deps)).toEqual({ tier: 'tested', reason: null });
  });

  it('a generic function: none, inputs cannot be generated from its signature', async () => {
    const s = await classifyFunction(GENERIC, 'first', deps);
    expect(s.tier).toBe('none');
    expect(s.reason).toMatch(/^Inputs cannot be generated from its signature: first is generic/);
    expect(s.reason).toContain('The translator refuses it too (generic type parameters).');
  });

  it('a load slower than the cap is unknown ("took longer than ..."), and the sandbox is still unloaded after', async () => {
    const unloaded: string[] = [];
    let release!: () => void;
    const slow: SandboxLike = {
      load: () => new Promise<LoadResult>((r) => (release = () => r({ ok: true, ms: 1 }))),
      unload: async (id) => void unloaded.push(id),
    };
    const s = await classifyFunction(HALF, 'half', { sandbox: slow, capMs: 30 });
    expect(s).toEqual({ tier: 'unknown', reason: 'Checking took longer than 0.03 seconds; not run.' });
    expect(unknownCause(s)).toBe('slow');
    release();
    await new Promise((r) => setTimeout(r, 0));
    expect(unloaded.length).toBe(1);
  });

  it('a check that throws is unknown, never a crash', async () => {
    const broken: SandboxLike = { load: async () => Promise.reject(new Error('worker died')), unload: async () => {} };
    expect((await classifyFunction(HALF, 'half', { sandbox: broken })).tier).toBe('unknown');
  });

  it('a preflight past its cap holds the lane until it settles: a fast function queued behind it is still decided (no cascade of unknowns)', async () => {
    // the stuck function's load takes 900 ms in the sandbox's own queue; the cap is 300 ms
    const stalling = new Proxy(sandbox, {
      get: (t, k) =>
        k === 'load'
          ? async (id: string, src: string, fn: string, o: { values: 'js' }) => {
              if (fn === 'stuck') await new Promise((r) => setTimeout(r, 900));
              return t.load(id, src, fn, o);
            }
          : typeof t[k as keyof Sandbox] === 'function'
            ? (t[k as keyof Sandbox] as (...x: unknown[]) => unknown).bind(t)
            : t[k as keyof Sandbox],
    });
    const d: TriageDeps = { sandbox: stalling, capMs: 300 };
    const [stuck, fast] = await Promise.all([classifyFunction(HALF.replace(/half/g, 'stuck'), 'stuck', d), classifyFunction(HALF, 'half', d)]);
    expect(stuck.tier).toBe('unknown');
    expect(fast).toEqual({ tier: 'tested', reason: null });
  });

  it('an overloaded function is none, even though its whole file loads (no whole-file fallback for it)', async () => {
    const s = await classifyFunction(`export function f(n: number): number;\nexport function f(n: any): any {\n  return n / 2;\n}\n`, 'f', deps);
    expect(s.tier).toBe('none');
    expect(s.reason).toMatch(/^Cannot run on its own: f is overloaded \(1 signature before the implementation\)/);
  });

  it('a whole-file fallback that cannot be prepared (value import) is refused before the compile gate; the verdict and the words are the extraction refusal', async () => {
    const src = `import { k } from './k';\nconst SCALE = { k: 2 };\nObject.freeze(SCALE);\nexport function half3(x: number): number {\n  return x / SCALE.k + 0 * k.length;\n}\n`;
    const s = await classifyFunction(src.replace(' + 0 * k.length', ''), 'half3', deps);
    expect(s.tier).toBe('none');
    expect(s.reason).toMatch(/^Cannot run on its own: module-level code outside the function \(line 3\) passes on SCALE/);
  });

  it('opens a lazy sandbox once and only when a load is needed', async () => {
    let opens = 0;
    const lazy = async () => (opens++, sandbox as SandboxLike);
    const d: TriageDeps = { sandbox: lazy };
    await classifyFunction(GCD, 'gcd', d);
    expect(opens).toBe(0);
    await Promise.all([classifyFunction(HALF, 'half', d), classifyFunction(HALF.replace('half', 'halve'), 'halve', d)]);
    expect(opens).toBe(1);
  });
});

describe('classifyFile / classifyFiles', () => {
  it('classifies every exported function of a file, cached by content (no second load)', async () => {
    const repo = await repoWith({ 'src/m.ts': GCD + HALF });
    let loads = 0;
    // every other method goes to the real sandbox, bound to it (the preflight also runs the original on a sample)
    const counting = new Proxy(sandbox, {
      get: (t, k) => (k === 'load' ? (...a: Parameters<Sandbox['load']>) => (loads++, t.load(...a)) : typeof t[k as keyof Sandbox] === 'function' ? (t[k as keyof Sandbox] as (...x: unknown[]) => unknown).bind(t) : t[k as keyof Sandbox]),
    });
    const d = { sandbox: counting };
    expect(await classifyFile(repo, 'src/m.ts', d)).toEqual({ gcd: { tier: 'provable', reason: null }, half: { tier: 'tested', reason: null } });
    const first = loads;
    expect(first).toBeGreaterThan(0);
    await classifyFile(repo, 'src/m.ts', d);
    expect(loads).toBe(first);
    // nothing written into the repository
    expect((await readdir(repo)).sort()).toEqual(['src']);
  });

  it('refuses paths outside the repository and non-TypeScript files; a missing file is 404', async () => {
    const repo = await repoWith({ 'a.ts': GCD, 'b.js': 'export function f() {}' });
    await expect(classifyFile(repo, '../etc/passwd.ts', deps)).rejects.toMatchObject({ status: 400 });
    await expect(classifyFile(repo, 'b.js', deps)).rejects.toMatchObject({ status: 400 });
    await expect(classifyFile(repo, 'nope.ts', deps)).rejects.toMatchObject({ status: 404 });
    expect(await classifyFiles(repo, ['a.ts', 'nope.ts', 'a.ts'], deps)).toEqual({ 'a.ts': { gcd: { tier: 'provable', reason: null } }, 'nope.ts': null });
  });
});

describe('classifyFile: symlinks', () => {
  it('a symlink inside the repository that points outside it is refused (file or directory), like a ../ path', async () => {
    const outer = await mkdtemp(join(tmpdir(), 'faithful-triage-outer-'));
    await writeFile(join(outer, 'outside.ts'), HALF);
    const repo = await repoWith({ 'in.ts': HALF });
    await symlink(join(outer, 'outside.ts'), join(repo, 'link.ts'));
    await symlink(outer, join(repo, 'up'));
    await symlink(join(repo, 'in.ts'), join(repo, 'inner-link.ts'));
    await expect(classifyFile(repo, 'link.ts', deps)).rejects.toMatchObject({ status: 400 });
    await expect(classifyFile(repo, 'up/outside.ts', deps)).rejects.toMatchObject({ status: 400 });
    // a symlink that stays inside the repository is fine
    expect(await classifyFile(repo, 'inner-link.ts', deps)).toEqual({ half: { tier: 'tested', reason: null } });
    // the session runtime applies the same containment
    const rt = new SessionRuntime({ repoRoot: repo, codex: new CodexClient({ ...resolveConfig({}), codexBin: '/bin/false' }) });
    try {
      await expect(rt.openFunction('link.ts', 'half')).rejects.toThrow(/inside the repository/);
      await expect(rt.openFunction('up/outside.ts', 'half')).rejects.toThrow(/inside the repository/);
    } finally {
      await rt.close();
    }
  });
});

describe('routes', () => {
  it('GET /api/functions/status?file= and POST /api/functions/status {files}, capped at 20 files; /api/files unchanged', async () => {
    const repo = await repoWith({ 'src/a.ts': GCD, 'src/b.ts': HALF, 'src/c.ts': USES_IMPORT });
    const api = await createApi(repo);
    try {
      const ctx = (path: string, body?: unknown) => ({ body, url: new URL(`http://x${path}`), repoRoot: repo });
      expect(await api.routes['GET /api/files']!(ctx('/api/files'))).toEqual([
        { path: 'src/a.ts', functions: [{ name: 'gcd', line: 1, hasJsDoc: false }] },
        { path: 'src/b.ts', functions: [{ name: 'half', line: 1, hasJsDoc: false }] },
        { path: 'src/c.ts', functions: [{ name: 'scaled', line: 2, hasJsDoc: false }] },
      ]);
      expect(await api.routes['GET /api/functions/status']!(ctx('/api/functions/status?file=src%2Fb.ts'))).toEqual({ half: { tier: 'tested', reason: null } });
      await expect(api.routes['GET /api/functions/status']!(ctx('/api/functions/status'))).rejects.toMatchObject({ status: 400 });
      const many = (await api.routes['POST /api/functions/status']!(ctx('/api/functions/status', { files: ['src/a.ts', 'src/c.ts'] }))) as Record<string, Record<string, { tier: string }>>;
      expect(many['src/a.ts']!.gcd!.tier).toBe('provable');
      expect(many['src/c.ts']!.scaled!.tier).toBe('none');
      await expect(api.routes['POST /api/functions/status']!(ctx('/api/functions/status', { files: Array.from({ length: 21 }, (_, i) => `f${i}.ts`) }))).rejects.toMatchObject({ status: 400 });
      await expect(api.routes['POST /api/functions/status']!(ctx('/api/functions/status', { files: 'src/a.ts' }))).rejects.toMatchObject({ status: 400 });
      expect((await readdir(repo)).sort()).toEqual(['src']);
    } finally {
      await api.close();
    }
  });
});

describe('the Pick list agrees with the Tested path (one preflight, same verdict, same reason)', () => {
  it('provable -> translator accepts; tested -> /api/tested/check ok and startTestedOnly starts with the same unit; none -> refused with the reason the Pick list shortens', async () => {
    const cases: Array<[string, string, string]> = [
      ['src/gcd.ts', GCD, 'gcd'],
      ['src/half.ts', HALF, 'half'],
      ['src/uses.ts', USES_IMPORT, 'scaled'],
      ['src/unrelated.ts', UNRELATED_IMPORT, 'third'],
      ['src/unrelated.ts', UNRELATED_IMPORT, 'readIt'],
      ['src/clock.ts', CLOCK_AT_LOAD, 'since'],
      ['src/generic.ts', GENERIC, 'first'],
      ['src/side.ts', `const live = new Set<number>();\nconst SCALE = 3;\nexport function scaleIt(x: number): number {\n  return x / SCALE;\n}\n`, 'scaleIt'],
      ['src/frozen.ts', `const SCALE = { k: 2 };\nexport function half2(x: number): number {\n  return x / SCALE.k;\n}\nObject.freeze(SCALE);\n`, 'half2'],
    ];
    const files: Record<string, string> = {};
    for (const [f, t] of cases) files[f] = t;
    const repo = await repoWith(files);
    const seen = new Set<string>();
    // the server's own route (GET /api/tested/check), on a server that never starts a run here (no model is called)
    const api = await createApi(repo);
    const ctx = (path: string, body?: unknown) => ({ body, url: new URL(`http://x${path}`), repoRoot: repo });
    const serverCheck = async (file: string, fn: string): Promise<{ ok: boolean; reason?: string }> => {
      await api.routes['POST /api/session/open']!(ctx('/api/session/open', { file, fn }));
      for (let i = 0; i < 400; i++) {
        const st = (await api.routes['GET /api/session']!(ctx('/api/session'))) as { fn: string; job: { running: string | null } };
        if (!st.job.running && st.fn === fn) break;
        await new Promise((r) => setTimeout(r, 10));
      }
      return (await api.routes['GET /api/tested/check']!(ctx('/api/tested/check'))) as { ok: boolean; reason?: string };
    };
    try {
      for (const [file, text, fn] of cases) {
        const triage = await classifyFunction(text, fn, deps);
        // a fresh runtime per function: startTestedOnly records tested.started once per session
        const rt = new SessionRuntime({ repoRoot: repo, codex: new CodexClient({ ...resolveConfig({}), codexBin: '/bin/false' }) });
        try {
          await rt.openFunction(file, fn);
          const check = await serverCheck(file, fn);
          if (triage.tier === 'provable') {
            expect(rt.state.translation?.ok, fn).toBe(true);
            await expect(rt.startTestedOnly()).rejects.toThrow(/inside the verifiable subset/);
          } else if (triage.tier === 'tested') {
            expect(rt.state.translation?.ok, fn).toBe(false);
            expect(await rt.testedBlocker(), fn).toBeNull();
            expect(check, fn).toEqual({ ok: true });
            await rt.startTestedOnly();
            expect(rt.state.tested, fn).toBeTruthy();
            const started = rt.events.map((e) => e.event).find((e) => e.kind === 'tested.started') as { included?: string[] } | undefined;
            expect((started?.included ?? []).filter((n) => n !== fn), fn).toEqual(triage.included ?? []);
          } else {
            expect(triage.tier, fn).toBe('none');
            const why = await rt.testedBlocker();
            expect(why, fn).not.toBeNull();
            expect(check, fn).toEqual({ ok: false, reason: why });
            expect(triage.reason!.startsWith(pickReason(fn, why!)), fn).toBe(true);
            await expect(rt.startTestedOnly()).rejects.toThrow(why!);
            expect(rt.state.tested ?? null, fn).toBeNull();
          }
          seen.add(triage.tier);
        } finally {
          await rt.close();
        }
      }
    } finally {
      await api.close();
    }
    expect([...seen].sort()).toEqual(['none', 'provable', 'tested']);
  }, 60_000);
});

describe('unknown: over the cap is decided and kept, a failed check is asked again', () => {
  it('a function over the cap keeps its status for that content (no endless retry); a check that failed is retried by the next request', async () => {
    let loads = 0;
    const hang: SandboxLike = { load: () => (loads++, new Promise<LoadResult>(() => undefined)), unload: async () => {} };
    const d: TriageDeps = { sandbox: hang, capMs: 30 };
    const first = await classifyText(HALF, d);
    expect(first.half).toEqual({ tier: 'unknown', reason: 'Checking took longer than 0.03 seconds; not run.' });
    const asked = loads;
    expect(asked).toBeGreaterThan(0);
    expect(await classifyText(HALF, d)).toEqual(first);
    expect(loads).toBe(asked);

    clearTriageCache();
    let n = 0;
    // the first load fails; every other method goes to the real sandbox, bound to it (the preflight also runs the original)
    const flaky = new Proxy(sandbox, {
      get: (t, k) =>
        k === 'load'
          ? async (...a: Parameters<Sandbox['load']>) => {
              if (n++ === 0) throw new Error('worker died');
              return t.load(...a);
            }
          : typeof t[k as keyof Sandbox] === 'function'
            ? (t[k as keyof Sandbox] as (...x: unknown[]) => unknown).bind(t)
            : t[k as keyof Sandbox],
    });
    const bad = await classifyText(HALF, { sandbox: flaky });
    expect(unknownCause(bad.half!)).toBe('failed');
    expect(bad.half!.reason).toBe('The check itself failed; not run.');
    expect(await classifyText(HALF, { sandbox: flaky })).toEqual({ half: { tier: 'tested', reason: null } });
  });
});

describe('reasons are safe for the page (tidyReason, the one place)', () => {
  it('a percent sign becomes the word "mod"; white space and control characters collapse', () => {
    expect(tidyReason("Operator '%' cannot be applied")).toBe("Operator 'mod' cannot be applied");
    expect(tidyReason('it throws when the file loads (Error: 50% of the budget).')).toBe('it throws when the file loads (Error: 50 mod of the budget).');
    expect(tidyReason('a % b, then x %= 2.')).toBe('a mod b, then x mod 2.');
    expect(tidyReason('line\none\t\ttwo\u0000three')).toBe('line one two three');
    expect(tidyReason('100%')).toBe('100 mod');
    expect(tidyReason('plain words.')).toBe('plain words.');
  });

  it('a long reason is cut at a word, never inside a code span, and ends with an ellipsis', () => {
    const long = `Cannot run on its own: ${'word '.repeat(100)}`;
    const cut = tidyReason(long);
    expect(cut.length).toBeLessThanOrEqual(MAX_REASON);
    expect(cut.endsWith('…')).toBe(true);
    const spanned = tidyReason(`Cannot run on its own: ${'x '.repeat(150)}\`${'y'.repeat(40)} more\` and then more words after the span`, 200);
    expect((spanned.match(/`/g) ?? []).length % 2).toBe(0);
    expect(spanned.length).toBeLessThanOrEqual(200);
  });

  it('pickReason is tidied too, and the whole reason of a function whose declaration throws with a percent sign has none', async () => {
    expect(pickReason('f', 'f cannot run on its own: a declaration throws (Error: 50% done). The Tested tier does not run it.')).toBe('Cannot run on its own: a declaration throws (Error: 50 mod done).');
    const src = `function compute(): number {\n  throw new Error('50% of the budget');\n}\nconst LIMIT: number = compute();\nexport function lim(x: number): number {\n  return x / LIMIT;\n}\n`;
    const s = await classifyFunction(src, 'lim', deps);
    expect(s.tier).toBe('none');
    expect(s.reason).toContain('50 mod of the budget');
    expect(s.reason).not.toContain('%');
  });
});

/** The fixture the page's claim sweep can render: what the server answers for a small repository (see API.md). */
describe('the pick answer for a fixture repository (golden: packages/cli/src/flow/fixtures/pick-response.json)', () => {
  const FIXTURE_REPO: Record<string, string> = {
    'src/gcd.ts': `/** Distance between two numbers. */\n${GCD}`,
    'src/clamp.ts': `export function clamp(x: number, lo: number, hi: number): number {\n  if (x < lo) {\n    return lo;\n  }\n  if (x > hi) {\n    return hi;\n  }\n  return x;\n}\n`,
    'src/half.ts': `/** Half of a number. */\n${HALF}`,
    'src/scaled.ts': USES_IMPORT,
    'src/generic.ts': GENERIC,
    'src/limit.ts': `function compute(): number {\n  throw new Error('50% of the budget');\n}\nconst LIMIT: number = compute();\nexport function limit(x: number): number {\n  return x / LIMIT;\n}\n`,
    'src/overloaded.ts': `/** Halves it. */\nexport function halve(n: number): number;\nexport function halve(n: string): string;\nexport function halve(n: any): any {\n  return n / 2;\n}\n`,
  };

  it('is what the route answers once the scan is done; no reason in it holds a percent sign', async () => {
    const repo = await repoWith(FIXTURE_REPO);
    const api = await createApi(repo);
    try {
      const ctx = (path: string, body?: unknown) => ({ body, url: new URL(`http://x${path}`), repoRoot: repo });
      const pick = (body: unknown) => api.routes['POST /api/functions/pick']!(ctx('/api/functions/pick', body)) as Promise<{ scan: { state: string; version: number }; rows: unknown[]; cannotRun: Array<{ reason: string | null }> }>;
      let r = await pick({ query: '', includeUnrunnable: true, limit: 50 });
      for (let i = 0; i < 400 && r.scan.state !== 'done'; i++) {
        await new Promise((x) => setTimeout(x, 25));
        r = await pick({ query: '', includeUnrunnable: true, limit: 50 });
      }
      expect(r.scan.state).toBe('done');
      const normalized = { ...r, scan: { ...r.scan, version: 1 } };
      expect(JSON.stringify(normalized)).not.toMatch(/%/);
      const file = new URL('./fixtures/pick-response.json', import.meta.url);
      if (process.env.UPDATE_TRIAGE_FIXTURES === '1') await writeFile(file, `${JSON.stringify(normalized, null, 2)}\n`);
      expect(normalized).toEqual(JSON.parse(await readFile(file, 'utf8')));
      expect(r.cannotRun.some((x) => x.reason?.includes('50 mod of the budget'))).toBe(true);
    } finally {
      await api.close();
    }
  });
});

describe('routes: pick, scan, scan/start', () => {
  const ctxFor = (repo: string) => (path: string, body?: unknown) => ({ body, url: new URL(`http://x${path}`), repoRoot: repo });

  it('GET /api/files lists an overloaded function once; pick validates its input and answers the contract shape', async () => {
    const repo = await repoWith({ 'src/a.ts': GCD, 'src/o.ts': `/** Halves it. */\nexport function halve(n: number): number;\nexport function halve(n: string): string;\nexport function halve(n: any): any {\n  return n / 2;\n}\n` });
    const api = await createApi(repo);
    const ctx = ctxFor(repo);
    try {
      expect(await api.routes['GET /api/files']!(ctx('/api/files'))).toEqual([
        { path: 'src/a.ts', functions: [{ name: 'gcd', line: 1, hasJsDoc: false }] },
        { path: 'src/o.ts', functions: [{ name: 'halve', line: 2, hasJsDoc: true }] },
      ]);
      const pick = api.routes['POST /api/functions/pick']!;
      await expect(pick(ctx('/api/functions/pick', { query: 5 }))).rejects.toMatchObject({ status: 400 });
      await expect(pick(ctx('/api/functions/pick', { query: '', limit: 'many' }))).rejects.toMatchObject({ status: 400 });
      await expect(pick(ctx('/api/functions/pick', { query: '', includeUnrunnable: 'yes' }))).rejects.toMatchObject({ status: 400 });
      const r = (await pick(ctx('/api/functions/pick', { query: 'gcd' }))) as Record<string, unknown>;
      expect(Object.keys(r).sort()).toEqual(['cannotRun', 'counts', 'rows', 'scan', 'totalMatches']);
      expect(r.totalMatches).toBe(1);
      expect((r.rows as Array<Record<string, unknown>>)[0]).toMatchObject({ file: 'src/a.ts', name: 'gcd', line: 1, hasJsDoc: false });
      expect(Object.keys((r.rows as Array<Record<string, unknown>>)[0]!).sort()).toEqual(['file', 'hasJsDoc', 'line', 'name', 'reason', 'tier']);
      expect(Object.keys(r.scan as object).sort()).toEqual(['filesDone', 'filesTotal', 'state', 'version']);
      // a missing query is the empty query
      expect(((await pick(ctx('/api/functions/pick'))) as { totalMatches: number }).totalMatches).toBe(2);
    } finally {
      await api.close();
    }
  });

  it('GET /api/functions/scan is cheap progress; POST /api/functions/scan/start starts a pass (idempotent); the scan waits while a job runs', async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 6; i++) files[`src/f${i}.ts`] = HALF.replace('half', `fn${i}`);
    const repo = await repoWith(files);
    const api = await createApi(repo);
    const ctx = ctxFor(repo);
    const scan = () => api.routes['GET /api/functions/scan']!(ctx('/api/functions/scan')) as Promise<{ state: string; filesDone: number; filesTotal: number; version: number }>;
    try {
      expect(await scan()).toEqual({ state: 'idle', filesDone: 0, filesTotal: 0, version: 0 });
      // a job is running: the scan starts, lists, and waits
      await api.runtime.emit({ kind: 'job.started', job: 'optimize' });
      const started = (await api.routes['POST /api/functions/scan/start']!(ctx('/api/functions/scan/start', {}))) as { state: string };
      expect(started.state).toBe('running');
      expect(((await api.routes['POST /api/functions/scan/start']!(ctx('/api/functions/scan/start', {}))) as { state: string }).state).toBe('running');
      await new Promise((r) => setTimeout(r, 400));
      const waiting = await scan();
      expect(waiting).toMatchObject({ state: 'running', filesDone: 0, filesTotal: 6 });
      // the job ends: the scan carries on and finishes
      await api.runtime.emit({ kind: 'job.finished', job: 'optimize' });
      for (let i = 0; i < 400 && (await scan()).state !== 'done'; i++) await new Promise((r) => setTimeout(r, 25));
      expect(await scan()).toMatchObject({ state: 'done', filesDone: 6, filesTotal: 6 });
      expect((await readdir(repo)).sort()).toEqual(['src']);
    } finally {
      await api.close();
    }
  });
});

describe('reasons the Pick list shows are plain words, not compiler output', () => {
  it('a name the file neither defines nor gets from a plain run: one sentence, and the translator clause reads as a sentence', async () => {
    const s = await classifyFunction(`export function f(n: number): number {\n  return document.title.length + n;\n}\n`, 'f', deps);
    expect(s.tier).toBe('none');
    expect(s.reason).toMatch(/^Cannot run on its own: it uses `document`, which the file does not define and a plain function run does not provide \(line 2, column \d+\)\. The translator refuses it too \(input or output\)\.$/);
    expect(s.reason).not.toMatch(/Cannot find name|Do you need|Try changing|compiler option|refuses it too:/);
  });

  it('another diagnostic keeps only its first sentence: the compiler advice about its settings is dropped, and nothing is cut mid-sentence', async () => {
    const s = await classifyFunction(`export function f(xs: number[]): number[] {\n  return xs.toSorted();\n}\n`, 'f', deps);
    expect(s.tier).toBe('none');
    expect(s.reason).toMatch(/do not compile by themselves \(line 2, column \d+: Property 'toSorted' does not exist on type 'number\[\]'\)\./);
    expect(s.reason).not.toMatch(/Do you need|Try changing|compiler option|…/);
    expect(s.reason).toMatch(/The translator refuses it too \(.+\)\.$/);
  });

  it('pickReason: the compile gate sentence with the compiler\'s advice, from a text as the Tested path words it', () => {
    const raw =
      "f cannot run on its own: it and the declarations it uses do not compile by themselves (line 70, column 22: Cannot find name 'Worker'. Do you need to change your target library? Try changing the 'lib' compiler option to include 'dom'). The Tested tier runs the function in an isolated sandbox together with only the declarations it uses from its own file.";
    expect(pickReason('f', raw)).toBe('Cannot run on its own: it uses `Worker`, which the file does not define and a plain function run does not provide (line 70, column 22).');
    const other =
      "f cannot run on its own: it and the declarations it uses do not compile by themselves (line 5, column 3: Function lacks ending return statement and return type does not include 'undefined'). The Tested tier runs the function in an isolated sandbox together with only the declarations it uses from its own file.";
    expect(pickReason('f', other)).toBe("Cannot run on its own: it and the declarations it uses do not compile by themselves (line 5, column 3: Function lacks ending return statement and return type does not include 'undefined').");
    // the Tested path's advice at the end of "cannot be tested" is dropped, so the sentence fits and is not cut
    const nothing = "f cannot be tested: it failed or took longer than 100 ms on each of the first 50 inputs generated from its signature (first: fault (uncaught ReferenceError: Cannot access 'ys' before initialization)), so there is nothing to compare a faster version with.";
    expect(pickReason('f', nothing)).toBe("Cannot be tested: it failed or took longer than 100 ms on each of the first 50 inputs generated from its signature (first: fault (uncaught ReferenceError: Cannot access 'ys' before initialization)).");
    // a file-level compile error has the same shape
    const whole = "g cannot run on its own: its file does not compile by itself (line 9, column 1: Property 'x' does not exist on type 'string'. Did you mean 'y'?). The Tested tier needs a file that loads by itself.";
    expect(pickReason('g', whole)).toBe("Cannot run on its own: it and the declarations it uses do not compile by themselves (line 9, column 1: Property 'x' does not exist on type 'string').");
  });
});

describe('a reason that had to be cut is not followed by another sentence', () => {
  it('a long first sentence ends with an ellipsis and the translator clause is left off; a short one keeps it', async () => {
    const long = `Cannot run on its own: ${'x'.repeat(400)}`;
    expect(pickReason('f', `f ${long}`)).toMatch(/…$/);
    // end to end: a declaration that throws with a very long message, in a file the translator also refuses
    const msg = 'long message '.repeat(40);
    const src = `const BAD: number = (() => { throw new Error('${msg}'); })();\nexport function f(x: number): number {\n  return x / BAD;\n}\n`;
    const s = await classifyFunction(src, 'f', deps);
    expect(s.tier).toBe('none');
    expect(s.reason).toMatch(/…$/);
    expect(s.reason).not.toMatch(/…\s+The translator/);
    expect(s.reason!.length).toBeLessThanOrEqual(MAX_REASON);
    const short = await classifyFunction(USES_IMPORT, 'scaled', deps);
    expect(short.reason).toMatch(/The translator refuses it too \(.+\)\.$/);
  });
});

describe('chunks, giving up, abandoned work, names', () => {
  const many = (n: number): string => Array.from({ length: n }, (_, i) => `export function h${i}(x: number): number {\n  return x / ${i + 2};\n}\n`).join('');

  it('a file\'s functions go to the backend a chunk at a time, with a chance to pause before each', async () => {
    const asked: number[] = [];
    let pauses = 0;
    const inner: TriageBackend = {
      quick: async (t) => quickInfo(t),
      classify: async (_t, items) => {
        asked.push(items.length);
        return Object.fromEntries(items.map((i) => [i.name, { tier: 'tested' as const, reason: null }]));
      },
      close: async () => undefined,
    };
    const n = 2 * CLASSIFY_CHUNK + 1;
    const out = await classifyText(many(n), { backend: inner, beforeChunk: async () => void pauses++ });
    expect(asked).toEqual([CLASSIFY_CHUNK, CLASSIFY_CHUNK, 1]);
    expect(pauses).toBe(3);
    expect(Object.keys(out)).toHaveLength(n);
  });

  it('the cheap pass reports signs of life as it goes (one per QUICK_BEAT functions), so a long synchronous pass is not mistaken for a stall', () => {
    let beats = 0;
    const q = quickInfo(many(3 * QUICK_BEAT + 3), () => void beats++);
    expect(q.fns).toHaveLength(3 * QUICK_BEAT + 3);
    expect(beats).toBe(3);
  });

  it('a readable file whose cheap pass gave up has a status per function, not "could not be read"; asking again does not start the work again', async () => {
    const repo = await repoWith({ 'a.ts': GCD + HALF + `export function third(x: number): number {\n  return x / 3;\n}\n` });
    let quickCalls = 0;
    const gives: TriageBackend = {
      quick: async () => {
        quickCalls++;
        throw new TriageTimeout(30_000);
      },
      classify: async () => ({}),
      close: async () => undefined,
    };
    const slow = { tier: 'unknown', reason: 'Checking took longer than 30 seconds; not run.' };
    expect(await classifyFiles(repo, ['a.ts'], { backend: gives })).toEqual({ 'a.ts': { gcd: slow, half: slow, third: slow } });
    expect(unknownCause(slow as never)).toBe('slow');
    expect(quickCalls).toBe(1);
    await classifyFiles(repo, ['a.ts'], { backend: gives });
    expect(quickCalls).toBe(1);
    // any other failure is "the check itself failed", and is asked again
    clearTriageCache();
    let failedCalls = 0;
    const breaks: TriageBackend = {
      quick: async () => {
        failedCalls++;
        throw new Error('worker died');
      },
      classify: async () => ({}),
      close: async () => undefined,
    };
    const failed = { tier: 'unknown', reason: 'The check itself failed; not run.' };
    expect(await classifyFiles(repo, ['a.ts', 'missing.ts'], { backend: breaks })).toEqual({ 'a.ts': { gcd: failed, half: failed, third: failed }, 'missing.ts': null });
    await classifyFiles(repo, ['a.ts'], { backend: breaks });
    expect(failedCalls).toBe(2);
  });

  it('quickText keeps "gave up" for that content and forgets other failures', async () => {
    let calls = 0;
    const mk = (err: Error): TriageBackend => ({ quick: async () => (calls++, Promise.reject(err)), classify: async () => ({}), close: async () => undefined });
    await expect(quickText(GCD, { backend: mk(new TriageTimeout(30_000)) })).rejects.toBeInstanceOf(TriageTimeout);
    await expect(quickText(GCD, { backend: mk(new TriageTimeout(30_000)) })).rejects.toBeInstanceOf(TriageTimeout);
    expect(calls).toBe(1);
    clearTriageCache();
    calls = 0;
    await expect(quickText(HALF, { backend: mk(new Error('x')) })).rejects.toThrow('x');
    await expect(quickText(HALF, { backend: mk(new Error('x')) })).rejects.toThrow('x');
    expect(calls).toBe(2);
  });

  it('a preflight past its cap aborts the sandbox it ran in (the loop stops using a core) and the next one opens a fresh sandbox', async () => {
    const aborted: string[] = [];
    let opens = 0;
    let abandoned = 0;
    const open = async (): Promise<SandboxLike> => {
      const id = `sb${++opens}`;
      if (opens === 1) return { load: () => new Promise<LoadResult>(() => undefined), unload: async () => undefined, abort: () => void aborted.push(id) };
      return sandbox as SandboxLike;
    };
    const d: TriageDeps = { sandbox: open, capMs: 40, onAbandoned: () => void abandoned++ };
    expect(await classifyFunction(HALF, 'half', d)).toEqual({ tier: 'unknown', reason: 'Checking took longer than 0.04 seconds; not run.' });
    expect(aborted).toEqual(['sb1']);
    expect(abandoned).toBe(1);
    // the next function gets a sandbox of its own, not the abandoned one
    expect(await classifyFunction(HALF.replace('half', 'half2'), 'half2', { ...d, capMs: 3000 })).toEqual({ tier: 'tested', reason: null });
    expect(opens).toBe(2);
    expect(aborted).toEqual(['sb1']);
  });

  it('a preflight queued behind an abandoned one runs on the fresh sandbox, not on the aborted one', async () => {
    let opens = 0;
    const first = { aborted: false, rejectLoad: (): void => undefined };
    const open = async (): Promise<SandboxLike> => {
      if (++opens > 1) return sandbox as SandboxLike;
      return {
        get isAborted() {
          return first.aborted;
        },
        load: () => new Promise<LoadResult>((_, reject) => (first.rejectLoad = () => reject(new Error('sandbox was aborted')))),
        unload: async () => undefined,
        abort: () => {
          first.aborted = true;
          first.rejectLoad(); // what Sandbox.abort does to the work in flight
        },
      };
    };
    const d: TriageDeps = { sandbox: open, capMs: 60 };
    const [stuck, queued] = await Promise.all([classifyFunction(HALF, 'half', d), classifyFunction(HALF.replace('half', 'half2'), 'half2', { ...d, capMs: 3000 })]);
    expect(stuck.tier).toBe('unknown');
    expect(unknownCause(stuck)).toBe('slow');
    // not "the check itself failed": it ran, on the sandbox opened after the abort
    expect(queued).toEqual({ tier: 'tested', reason: null });
    expect(opens).toBe(2);
  });

  it('a sandbox the caller passed in is never aborted by a timeout (it is the caller\'s)', async () => {
    let aborts = 0;
    const mine: SandboxLike = { load: () => new Promise<LoadResult>(() => undefined), unload: async () => undefined, abort: () => void aborts++ };
    expect((await classifyFunction(HALF, 'half', { sandbox: mine, capMs: 30 })).tier).toBe('unknown');
    expect(aborts).toBe(0);
  });

  it('a function that loops stops using its core when the cap passes (the sample of 50 inputs does not run on for seconds)', async () => {
    const LOOP = `export function spin(x: number): number {\n  let s = x;\n  while (s !== -1) {\n    s = s + 1 - 1;\n  }\n  return s;\n}\n`;
    const before = liveSandboxWorkers();
    const d: TriageDeps = { sandbox: () => Sandbox.open(), capMs: 700 };
    const t0 = Date.now();
    const s = await classifyFunction(LOOP, 'spin', d);
    expect(s).toEqual({ tier: 'unknown', reason: 'Checking took longer than 0.7 seconds; not run.' });
    // the sample alone (50 inputs x 100 ms) would keep a worker busy for about 5 s; the abort ends it within a moment
    for (let i = 0; i < 60 && liveSandboxWorkers() > before; i++) await new Promise((r) => setTimeout(r, 50));
    expect(liveSandboxWorkers()).toBe(before);
    expect(Date.now() - t0).toBeLessThan(4500);
  });

  it('a function named like an inherited property (__proto__, constructor, toString, then, ...) is classified like any other, as an own entry', async () => {
    const odd = ['__proto__', 'constructor', 'toString', 'valueOf', 'hasOwnProperty', 'then'];
    const text = GCD + odd.map((n) => `export function ${n}(x: number): number {\n  return x / 2;\n}\n`).join('');
    const q = quickInfo(text);
    expect(q.fns.map((f) => f.name).sort()).toEqual(['gcd', ...odd].sort());
    for (const n of ['gcd', ...odd]) expect(getOwn(q.verdicts, n), n).toBeDefined();
    const out = await classifyText(text, deps);
    expect(getOwn(out, 'gcd')).toEqual({ tier: 'provable', reason: null });
    for (const n of odd) expect(getOwn(out, n), n).toEqual({ tier: 'tested', reason: null });
    // it crosses the wire as JSON with every name present
    const wire = JSON.parse(JSON.stringify(out)) as Record<string, unknown>;
    expect(Object.keys(wire).sort()).toEqual(['gcd', ...odd].sort());
    // a name that is NOT a function of the file is not found through the prototype
    expect(getOwn(JSON.parse('{}') as Record<string, QuickInfo>, 'constructor')).toBeUndefined();
    expect(getOwn(JSON.parse('{}') as Record<string, QuickInfo>, '__proto__')).toBeUndefined();
  });
});
