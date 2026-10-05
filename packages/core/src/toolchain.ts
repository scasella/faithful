import { findBinary } from './binaries.js';
import { resolveConfig } from './config.js';
import { loadLeanEnv, resolveLeanDir } from './lean-env.js';
import { run } from './process.js';

/**
 * Every number the tool reports carries a date, a model id and the toolchain versions. This snapshot is the
 * only source for those fields; artifact writers take it as a required argument.
 */
export interface Z3Info {
  kind: 'wasm' | 'system';
  version: string;
}

export interface ToolchainSnapshot {
  capturedAt: string;
  node: string;
  platform: string;
  codex: { version: string | null; model: string; effort: string };
  lean: { version: string | null; toolchain: string | null; mathlibCommit: string | null };
  z3: Z3Info | null;
}

export interface Stamp {
  /** ISO date (UTC) the figure was measured. */
  date: string;
  modelId: string;
  toolchain: ToolchainSnapshot;
}

export async function captureToolchain(opts: { z3?: Z3Info | null; env?: NodeJS.ProcessEnv } = {}): Promise<ToolchainSnapshot> {
  const env = opts.env ?? process.env;
  const cfg = resolveConfig(env);
  let codexVersion: string | null = null;
  const codex = await findBinary(cfg.codexBin);
  if (codex) {
    try {
      const r = await run(codex, ['--version'], { timeoutMs: 15_000 });
      codexVersion = r.stdout.trim() || null;
    } catch {
      codexVersion = null;
    }
  }
  const lean: ToolchainSnapshot['lean'] = { version: null, toolchain: null, mathlibCommit: null };
  const leanDir = resolveLeanDir(env);
  if (leanDir) {
    try {
      const le = await loadLeanEnv(leanDir);
      lean.version = le.leanVersion;
      lean.toolchain = le.toolchain;
      lean.mathlibCommit = le.mathlibCommit;
    } catch {
      /* reported by doctor */
    }
  }
  return {
    capturedAt: new Date().toISOString(),
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
    codex: { version: codexVersion, model: cfg.model, effort: cfg.effort },
    lean,
    z3: opts.z3 ?? null,
  };
}

export function stampFrom(tc: ToolchainSnapshot): Stamp {
  return { date: tc.capturedAt.slice(0, 10), modelId: tc.codex.model, toolchain: tc };
}
