import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { envWithToolDirs, loadLeanEnv, resolveLeanDir, run, tierFromAxioms, type Tier } from '@faithful/core';

export type Severity = 'error' | 'warning' | 'info';

export interface LeanDiagnostic {
  file: string;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  severity: Severity;
  message: string;
  /** Lean's own diagnostic kind, e.g. `Tactic.unsolvedGoals`, `hasSorry`. */
  kind: string;
  /** Goal state (hypotheses and `⊢` target) when the message carries one. */
  goal?: string;
}

export interface LeanCheckOptions {
  source: string;
  /** Wall-clock budget; the process group is killed when it elapses. */
  budgetMs: number;
  /** Theorems to run `#print axioms` on (appended after `source`, so source line numbers are unchanged). */
  theorems?: string[];
  leanDir?: string;
  fileName?: string;
}

export interface TheoremAxioms {
  axioms: string[];
  /** `proved`, `proved-trusting-compiler`, or null when the axiom set is not acceptable (e.g. `sorryAx`). */
  tier: 'proved' | 'proved-trusting-compiler' | null;
}

export interface LeanCheckResult {
  /** No error diagnostics, no timeout, and `lean` exited 0. */
  ok: boolean;
  timedOut: boolean;
  ms: number;
  diagnostics: LeanDiagnostic[];
  axioms: Record<string, TheoremAxioms>;
  stderr: string;
  leanVersion: string;
  mathlibCommit: string | null;
}

interface RawMessage {
  data: string;
  fileName: string;
  kind: string;
  pos: { line: number; column: number };
  endPos?: { line: number; column: number } | null;
  severity: string;
}

const GOAL_RE = /⊢/;

/** Extract the goal-state portion of a message: from the first hypothesis line to the end of the last goal. */
export function goalOf(message: string): string | undefined {
  if (!GOAL_RE.test(message)) return undefined;
  const lines = message.split('\n');
  const first = lines.findIndex((l) => /^(case |[^\s:][^:]*:|⊢)/.test(l) && l !== lines[0]);
  const body = (first >= 0 ? lines.slice(first) : lines.slice(1)).join('\n').trim();
  return body.length ? body : undefined;
}

export function parseLeanJson(stdout: string): LeanDiagnostic[] {
  const out: LeanDiagnostic[] = [];
  for (const line of stdout.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('{')) continue;
    let m: RawMessage;
    try {
      m = JSON.parse(t) as RawMessage;
    } catch {
      continue;
    }
    const severity: Severity = m.severity === 'error' ? 'error' : m.severity === 'warning' ? 'warning' : 'info';
    const d: LeanDiagnostic = {
      file: m.fileName,
      line: m.pos.line,
      column: m.pos.column,
      endLine: m.endPos?.line ?? m.pos.line,
      endColumn: m.endPos?.column ?? m.pos.column,
      severity,
      message: m.data,
      kind: m.kind,
    };
    const g = severity === 'error' ? goalOf(m.data) : undefined;
    if (g) d.goal = g;
    out.push(d);
  }
  return out;
}

const AXIOMS_RE = /^'([^']+)' depends on axioms: \[(.*)\]$/s;
const NO_AXIOMS_RE = /^'([^']+)' does not depend on any axioms$/;

export function extractAxioms(diags: LeanDiagnostic[]): Record<string, TheoremAxioms> {
  const out: Record<string, TheoremAxioms> = {};
  for (const d of diags) {
    if (d.severity !== 'info') continue;
    const a = AXIOMS_RE.exec(d.message.trim());
    if (a) {
      const names = a[2]!.split(',').map((s) => s.trim()).filter(Boolean);
      out[a[1]!] = { axioms: names, tier: tierFromAxioms(names) };
      continue;
    }
    const n = NO_AXIOMS_RE.exec(d.message.trim());
    if (n) out[n[1]!] = { axioms: [], tier: 'proved' };
  }
  return out;
}

export const NOT_A_PROOF: Tier = 'not-proved';

/** Compile one Lean file with a wall-clock budget; return structured diagnostics and theorem axioms. */
export async function checkLean(opts: LeanCheckOptions): Promise<LeanCheckResult> {
  const leanDir = opts.leanDir ?? resolveLeanDir();
  if (!leanDir) throw new Error('Lean project not found: run `faithful setup` (see `faithful doctor`)');
  const env = await loadLeanEnv(leanDir);
  const dir = await mkdtemp(join(tmpdir(), 'faithful-lean-'));
  try {
    const name = opts.fileName ?? 'Check.lean';
    const file = join(dir, name);
    const printLines = (opts.theorems ?? []).map((t) => `#print axioms ${t}`).join('\n');
    await writeFile(file, opts.source + (printLines ? `\n${printLines}\n` : '\n'), 'utf8');
    const r = await run(env.leanBin, ['--json', name], {
      cwd: dir,
      env: { ...envWithToolDirs(), LEAN_PATH: env.leanPath },
      timeoutMs: opts.budgetMs,
    });
    const diagnostics = parseLeanJson(r.stdout);
    return {
      ok: !r.timedOut && r.code === 0 && !diagnostics.some((d) => d.severity === 'error'),
      timedOut: r.timedOut,
      ms: r.ms,
      diagnostics,
      axioms: extractAxioms(diagnostics),
      stderr: r.stderr,
      leanVersion: env.leanVersion,
      mathlibCommit: env.mathlibCommit,
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export interface EvalBatchResult {
  /** Output per expression, aligned with the input; `null` when that `#eval` produced no output or failed. */
  outputs: Array<string | null>;
  /** Errors keyed by expression index. */
  errors: Map<number, string>;
  check: LeanCheckResult;
}

/**
 * Evaluate many expressions in ONE Lean process: one `#eval` per line after `prelude`, outputs matched back by
 * line number. Lean start-up dominates (0.4 s bare, ~1.4 s with tactic imports), so batching is not optional.
 */
export async function evalBatch(prelude: string, exprs: string[], opts: { budgetMs: number; leanDir?: string }): Promise<EvalBatchResult> {
  const head = prelude.endsWith('\n') ? prelude : prelude + '\n';
  const firstLine = head.split('\n').length; // 1-based line of the first #eval
  const source = head + exprs.map((e) => `#eval ${e.replace(/\n/g, ' ')}`).join('\n') + '\n';
  const check = await checkLean({ source, budgetMs: opts.budgetMs, leanDir: opts.leanDir });
  const outputs: Array<string | null> = exprs.map(() => null);
  const errors = new Map<number, string>();
  for (const d of check.diagnostics) {
    const idx = d.line - firstLine;
    if (idx < 0 || idx >= exprs.length) continue;
    if (d.severity === 'info') outputs[idx] = (outputs[idx] === null ? '' : outputs[idx] + '\n') + d.message.replace(/\n$/, '');
    else if (d.severity === 'error') errors.set(idx, d.message);
  }
  return { outputs, errors, check };
}
