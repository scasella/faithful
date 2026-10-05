import { statfs } from 'node:fs/promises';
import { checkLean } from '@faithful/prover';
import {
  envWithToolDirs,
  findBinary,
  loadLeanEnv,
  resolveConfig,
  resolveLeanDir,
  run,
  type Z3Info,
} from '@faithful/core';
import { openZ3 } from '@faithful/smt';

export type DoctorStatus = 'ok' | 'warn' | 'fail';
export interface DoctorCheck {
  id: string;
  label: string;
  status: DoctorStatus;
  detail: string;
  /** Command or step that fixes a warn/fail. */
  fix?: string;
}

const MIN_NODE = [22, 12];
const SETUP_FREE_GB = 12;

export async function runDoctor(env: NodeJS.ProcessEnv = process.env): Promise<{ checks: DoctorCheck[]; z3: Z3Info | null }> {
  const checks: DoctorCheck[] = [];
  const cfg = resolveConfig(env);

  // Node
  const [maj = 0, min = 0] = process.versions.node.split('.').map(Number);
  const nodeOk = maj > MIN_NODE[0]! || (maj === MIN_NODE[0]! && min >= MIN_NODE[1]!);
  checks.push({
    id: 'node',
    label: 'Node',
    status: nodeOk ? 'ok' : 'fail',
    detail: process.version,
    fix: nodeOk ? undefined : `Install Node >= ${MIN_NODE.join('.')} (https://nodejs.org)`,
  });

  // Codex
  const codex = await findBinary(cfg.codexBin);
  if (!codex) {
    checks.push({ id: 'codex', label: 'Codex CLI', status: 'fail', detail: 'not found', fix: 'npm i -g @openai/codex   (spec/proof tiers need it; Tested and Verified-to-k tiers do not)' });
  } else {
    const v = await run(codex, ['--version'], { timeoutMs: 15_000 }).catch(() => null);
    checks.push({ id: 'codex', label: 'Codex CLI', status: v?.code === 0 ? 'ok' : 'fail', detail: v?.stdout.trim() || 'version check failed' });
    const l = await run(codex, ['login', 'status'], { timeoutMs: 15_000 }).catch(() => null);
    const text = ((l?.stdout ?? '') + (l?.stderr ?? '')).trim();
    checks.push({
      id: 'codex-login',
      label: 'Codex login',
      status: l?.code === 0 ? 'ok' : 'fail',
      detail: text || 'unknown',
      fix: l?.code === 0 ? undefined : 'codex login',
    });
    checks.push({ id: 'codex-model', label: 'Model', status: 'ok', detail: `${cfg.model} (effort ${cfg.effort}; FAITHFUL_MODEL / FAITHFUL_EFFORT override)` });
  }

  // Lean / Lake
  const leanDir = resolveLeanDir(env);
  const elan = await findBinary('elan');
  checks.push({
    id: 'elan',
    label: 'elan',
    status: elan ? 'ok' : 'fail',
    detail: elan ?? 'not found',
    fix: elan ? undefined : "faithful setup --install-elan   (runs elan's official installer, ~100 MB; then the pinned toolchain ~400 MB)",
  });
  if (!leanDir) {
    checks.push({ id: 'lean', label: 'Lean project', status: 'fail', detail: 'lean/ project not found', fix: 'faithful setup' });
  } else if (elan) {
    try {
      const le = await loadLeanEnv(leanDir);
      checks.push({ id: 'lean', label: 'Lean', status: 'ok', detail: `${le.leanVersion} (toolchain ${le.toolchain})` });
      checks.push({ id: 'lake', label: 'Lake project', status: 'ok', detail: leanDir });
      // Smoke: the slim tactic import the proof tier uses must resolve and be fast (this is the Mathlib cache check).
      const smoke = await checkLean({
        source: 'import Mathlib.Tactic.Linarith\nimport Mathlib.Tactic.Ring\nexample (a b : Int) (h : a < b) : a < b + 1 := by linarith\n',
        budgetMs: 120_000,
        leanDir,
      });
      checks.push({
        id: 'mathlib',
        label: `Mathlib ${le.mathlibCommit?.slice(0, 10) ?? '?'}`,
        status: smoke.ok ? (smoke.ms < 30_000 ? 'ok' : 'warn') : 'fail',
        detail: smoke.ok ? `tactic imports compile in ${(smoke.ms / 1000).toFixed(1)} s` : (smoke.diagnostics.find((d) => d.severity === 'error')?.message ?? 'import failed').slice(0, 200),
        fix: smoke.ok ? undefined : 'faithful setup   (runs `lake exe cache get`)',
      });
    } catch (e) {
      checks.push({ id: 'lean', label: 'Lean', status: 'fail', detail: (e as Error).message.slice(0, 300), fix: 'faithful setup' });
    }
  } else {
    checks.push({ id: 'lean', label: 'Lean', status: 'fail', detail: 'needs elan', fix: 'faithful setup --install-elan' });
  }

  // Z3
  let z3: Z3Info | null = null;
  try {
    const d = await openZ3();
    z3 = d.info();
    checks.push({ id: 'z3', label: 'Z3', status: 'ok', detail: `${d.kind === 'wasm' ? 'WASM (z3-solver)' : 'system binary'} ${d.version}` });
  } catch (e) {
    checks.push({ id: 'z3', label: 'Z3', status: 'fail', detail: (e as Error).message, fix: 'pnpm add z3-solver   or   brew install z3' });
  }

  // Disk
  try {
    const s = await statfs(process.cwd());
    const gb = (Number(s.bavail) * Number(s.bsize)) / 1024 ** 3;
    checks.push({
      id: 'disk',
      label: 'Disk space',
      status: gb >= SETUP_FREE_GB ? 'ok' : 'warn',
      detail: `${gb.toFixed(1)} GB free (setup needs about ${SETUP_FREE_GB} GB if Lean and Mathlib are not yet installed)`,
      fix: gb >= SETUP_FREE_GB ? undefined : 'free disk space before `faithful setup`',
    });
  } catch {
    checks.push({ id: 'disk', label: 'Disk space', status: 'warn', detail: 'could not read' });
  }
  void envWithToolDirs;
  return { checks, z3 };
}

export function formatDoctor(checks: DoctorCheck[]): string {
  const mark = { ok: '✓', warn: '!', fail: '✗' } as const;
  const lines = checks.map((c) => `${mark[c.status]} ${c.label.padEnd(18)} ${c.detail}${c.fix ? `\n    fix: ${c.fix}` : ''}`);
  const failed = checks.filter((c) => c.status === 'fail').length;
  lines.push('', failed ? `${failed} check(s) failed. Tiers that need the failed tools are unavailable until fixed.` : 'All checks passed.');
  return lines.join('\n');
}
