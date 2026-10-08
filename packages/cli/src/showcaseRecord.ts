/**
 * `faithful showcase-record <file> --fn <name> --name <slug> [--out <dir>]`: run a REAL full session (real Codex, Lean, Z3,
 * sandbox) with the autopilot as the user, and write a recording the static showcase replays: <slug>.json (schema 1) and
 * <slug>.lean. The recording is the session's own event log, unmodified. The user's decisions are made by the autopilot policy,
 * and the recording's notes say so.
 */
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { openZ3 } from '@faithful/smt';
import { SessionRuntime, runAutopilot } from './flow/index.js';
import { smtChecker } from './smtChecker.js';

export interface RecordOptions {
  file: string;
  fn: string;
  name: string;
  out: string;
  minutes: number;
  proofAttempts: number;
  proofMinutes: number;
  log: (s: string) => void;
}

export async function runShowcaseRecord(o: RecordOptions): Promise<number> {
  const repo = mkdtempSync(join(tmpdir(), 'faithful-record-'));
  mkdirSync(join(repo, 'src'));
  copyFileSync(resolve(o.file), join(repo, 'src/x.ts'));
  let z3 = null;
  try {
    z3 = await openZ3();
  } catch {
    /* recorded without SMT: the stage says so */
  }
  const rt = new SessionRuntime({ repoRoot: repo, z3: z3?.info() ?? null });
  if (z3) rt.smt = smtChecker(z3);
  o.log(`recording ${o.fn} (real session; this takes minutes)…`);
  const { result } = await runAutopilot({ file: 'src/x.ts', fn: o.fn, repoRoot: repo, minutes: o.minutes, proofAttempts: o.proofAttempts, proofMinutes: o.proofMinutes, runtime: rt, log: o.log });
  let from = 0;
  for (let i = rt.events.length - 1; i >= 0; i--) if (rt.events[i]!.event.kind === 'session.started') { from = i; break; }
  const events = rt.events.slice(from);
  const start = events[0]!.event;
  if (start.kind !== 'session.started') throw new Error('the recording does not start with session.started');
  const policy = result.policy;
  const rec = {
    schema: 1,
    fn: o.fn,
    stampedEvents: events,
    source: start.source,
    toolchain: start.toolchain,
    recordedAt: start.toolchain.capturedAt,
    notes:
      `A real session recorded by \`faithful showcase-record\` on ${start.toolchain.capturedAt.slice(0, 10)} (model ${rt.codex.model}). ` +
      `The user's decisions were made by the scripted autopilot policy, not a person: throw sites as ${policy.throwChoice}; ` +
      `at a disagreement, up to ${policy.maxRevisions} "the spec is wrong" revisions, then the first carve-out class (blocked instead if the carve-outs exclude at least half of the generated inputs); Agree once none remain; ` +
      `faster-but-not-proved candidates are ${policy.acceptVerified ? '' : 'never '}accepted. ` +
      `Result: ${result.bestTier}${result.bestSpeedup ? `, ${result.bestSpeedup.ratio.toFixed(1)}× vs the original (95% CI ${result.bestSpeedup.lo.toFixed(1)}–${result.bestSpeedup.hi.toFixed(1)})` : ''}; ` +
      `${result.candidates.length} candidate(s); ${result.codex.calls} Codex calls; ${(result.wallMs / 60000).toFixed(1)} minutes.`,
  };
  mkdirSync(o.out, { recursive: true });
  writeFileSync(join(o.out, `${o.name}.json`), JSON.stringify(rec));
  const lean = join(repo, '.faithful', o.fn, `${o.fn}.lean`);
  if (existsSync(lean)) copyFileSync(lean, join(o.out, `${o.name}.lean`));
  writeFileSync(join(o.out, `${o.name}.result.json`), JSON.stringify(result, null, 2));
  o.log(`wrote ${join(o.out, o.name)}.json (${events.length} events); result: ${result.bestTier}${result.error ? `; ERROR ${result.error}` : ''}`);
  await rt.close();
  return result.error ? 1 : 0;
}
