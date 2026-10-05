import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { envWithToolDirs, findBinary } from './binaries.js';
import { run } from './process.js';

export interface LeanEnv {
  leanDir: string;
  leanBin: string;
  lakeBin: string;
  /** Colon-joined LEAN_PATH so `lean` can be invoked directly, skipping `lake env` start-up (1–2 s per call). */
  leanPath: string;
  leanVersion: string;
  toolchain: string;
  mathlibCommit: string | null;
}

/** Where the Lake project lives: FAITHFUL_LEAN_DIR, the monorepo's lean/, or ~/.faithful/lean. */
export function resolveLeanDir(env: NodeJS.ProcessEnv = process.env): string | null {
  if (env.FAITHFUL_LEAN_DIR) return resolve(env.FAITHFUL_LEAN_DIR);
  const here = dirname(fileURLToPath(import.meta.url));
  for (let d = here, i = 0; i < 8; i++, d = dirname(d)) {
    if (existsSync(join(d, 'lean', 'lean-toolchain'))) return join(d, 'lean');
  }
  const home = join(homedir(), '.faithful', 'lean');
  return existsSync(join(home, 'lean-toolchain')) ? home : null;
}

const cache = new Map<string, Promise<LeanEnv>>();

/** Resolve (and cache) the tools and search path for a Lake project. Throws with a fixable message when missing. */
export function loadLeanEnv(leanDir: string): Promise<LeanEnv> {
  let p = cache.get(leanDir);
  if (!p) {
    p = doLoad(leanDir);
    cache.set(leanDir, p);
    p.catch(() => cache.delete(leanDir));
  }
  return p;
}

async function doLoad(leanDir: string): Promise<LeanEnv> {
  const lake = await findBinary('lake');
  if (!lake) throw new Error('lake not found: install elan (https://github.com/leanprover/elan) or run `faithful setup`');
  const env = envWithToolDirs();
  const r = await run(lake, ['env', 'printenv', 'LEAN_PATH'], { cwd: leanDir, env, timeoutMs: 120_000 });
  if (r.code !== 0) throw new Error(`lake env failed in ${leanDir}: ${r.stderr.trim().slice(0, 400)}`);
  const w = await run(lake, ['env', 'which', 'lean'], { cwd: leanDir, env, timeoutMs: 120_000 });
  const leanBin = w.stdout.trim();
  const v = await run(leanBin, ['--version'], { env, timeoutMs: 30_000 });
  const toolchain = (await readFile(join(leanDir, 'lean-toolchain'), 'utf8')).trim();
  let mathlibCommit: string | null = null;
  try {
    const m = JSON.parse(await readFile(join(leanDir, 'lake-manifest.json'), 'utf8')) as {
      packages: Array<{ name: string; rev: string }>;
    };
    mathlibCommit = m.packages.find((x) => x.name === 'mathlib')?.rev ?? null;
  } catch {
    /* no manifest yet */
  }
  return {
    leanDir,
    leanBin,
    lakeBin: lake,
    leanPath: r.stdout.trim(),
    leanVersion: v.stdout.trim(),
    toolchain,
    mathlibCommit,
  };
}

/** Hash of the `Faithful` Lean library sources (lean/Faithful/*.lean): proofs are checked against exactly this text. */
export async function faithfulLibraryHash(leanDir: string): Promise<string> {
  const { hashText } = await import('./hash.js');
  const dir = join(leanDir, 'Faithful');
  const names = (await readdir(dir)).filter((n) => n.endsWith('.lean')).sort();
  const parts: string[] = [];
  for (const n of names) parts.push(`${n}\n${await readFile(join(dir, n), 'utf8')}`);
  return hashText(parts.join('\n---\n'));
}
