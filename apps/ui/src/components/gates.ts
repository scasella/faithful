/**
 * Pure text for the gate chips (Funnel) and the panels that explain them. Everything is read from a StageResult as the
 * server recorded it: the status, the summary (verbatim, through stageSummaryText so a bare "Proved" never shows) and,
 * for the SMT stage, its typed detail. Nothing is inferred beyond what the summary says.
 *
 * The chips use their own display names ("Bounded Z3", "Lean proof"); lib/catch.ts STAGE_LABEL stays the short name used
 * in sentences ("rejected at the SMT stage").
 */
import type { SmtDetail, StageId, StageResult } from '@faithful/session';
import { isSmtDetail } from '@faithful/session';
import { stageSummaryText } from '../lib/tierText';

/** The order a candidate meets the gates: the benchmark runs before the Lean proof (a proof is only tried when faster). */
export const GATE_ORDER: StageId[] = ['compile', 'purity', 'differential', 'smt', 'benchmark', 'proof'];

export const GATE_LABEL: Record<StageId, string> = {
  compile: 'Compile',
  purity: 'Purity',
  differential: 'Differential',
  smt: 'Bounded Z3',
  benchmark: 'Benchmark',
  proof: 'Lean proof',
};

const STATUS_WORD: Record<StageResult['status'], string> = {
  pending: 'pending',
  running: 'running',
  pass: 'pass',
  fail: 'fail',
  skipped: 'skipped',
};

/**
 * The status word of a chip. The SMT stage says Z3's own answer (unsat, sat, …) when its detail records it; a failed
 * proof stage says "not proved" (the absence of a proof, never a demonstration that the candidate is wrong).
 * `decided`: the candidate was decided, so a stage with no result was never run.
 */
export function gateStatusWord(r: StageResult | null, decided: boolean): string {
  if (!r) return decided ? 'not run' : 'pending';
  if (r.stage === 'smt' && isSmtDetail(r.detail) && (r.status === 'pass' || r.status === 'fail')) return r.detail.result;
  if (r.stage === 'proof' && r.status === 'fail') return 'not proved';
  return STATUS_WORD[r.status];
}

/** Longest summary shown whole on a chip; a longer one is cut at its first clause (the full text is shown elsewhere). */
const CHIP_MAX = 140;

/**
 * The note on a chip: the server's summary, verbatim when short. A long one (the SMT encoding text runs to ~1,000
 * characters) is cut to its head before the first ": " ("Verified to k=6"), and the narrowed bound is added when the
 * summary says the claim was NARROWED.
 */
export function gateNote(r: StageResult): string {
  const full = stageSummaryText(r.summary).trim();
  if (full.length <= CHIP_MAX) return full;
  // A skipped stage's head ("no SMT check") would drop the reason: keep its words up to the limit instead.
  const cut = full.indexOf(': ');
  const head =
    r.status !== 'skipped' && cut > 0 && cut <= CHIP_MAX ? full.slice(0, cut) : `${full.slice(0, CHIP_MAX).replace(/\s+\S*$/, '')}…`;
  const n = narrowing(r.summary);
  return n ? `${head}, narrowed to integers in [${n.narrowed}]` : head;
}

export interface Narrowing {
  /** "-8, 8": the bound the claim was narrowed to. */
  narrowed: string;
  /** "-65536, 65536": the bound that was requested, when the summary states it. */
  requested: string | null;
  /** "[12]": an excluded input, when the summary gives one. */
  example: string | null;
  /** The iteration bound U the excluded inputs exceed, when stated. */
  iterations: string | null;
}

/** The SMT stage's coverage note, parsed from its summary (packages/smt equivalence.ts coverageNote). Null unless NARROWED. */
export function narrowing(summary: string): Narrowing | null {
  const m = /NARROWED to integers in \[(-?\d+), (-?\d+)\]/.exec(summary);
  if (!m) return null;
  const req = /requested bounds had every number an integer in \[(-?\d+), (-?\d+)\]/.exec(summary);
  const ex = /\(for example (\[[^\]]*\])\)/.exec(summary);
  const it = /needs more than (\d+) iterations/.exec(summary);
  return { narrowed: `${m[1]}, ${m[2]}`, requested: req ? `${req[1]}, ${req[2]}` : null, example: ex ? ex[1]! : null, iterations: it ? it[1]! : null };
}

/** The sentence explaining a narrowed SMT claim, built only from what the summary states. */
export function narrowingSentence(k: number | null, n: Narrowing): string {
  const label = k === null ? 'The bounded Z3 claim' : `Verified to k=${k}`;
  const parts = [`${label} here is narrowed to integers in [${n.narrowed}].`];
  if (n.requested) {
    const why = n.iterations ? ` that need more than ${n.iterations} loop iterations${n.example ? ` (for example ${n.example})` : ''}` : n.example ? ` (for example ${n.example})` : '';
    parts.push(`The requested bound was [${n.requested}], but inputs${why} were excluded, so the claim shrank to the bound Z3 fully covered.`);
  }
  parts.push('Nothing is claimed for the excluded inputs.');
  return parts.join(' ');
}

/** What Z3 searched, from the SMT stage's typed detail: null when the detail is not recorded. */
export function smtBounds(d: SmtDetail | null): Array<{ what: string; bound: string }> | null {
  if (!d || !d.bounds) return null;
  const b = d.bounds;
  return [
    { what: 'array length', bound: `≤ ${b.array}` },
    { what: 'string length', bound: `≤ ${b.string}` },
    { what: 'integers', bound: `[-${b.int}, ${b.int}]` },
  ];
}

/** "z3 wasm 5.2.0", when recorded. */
export function z3Text(d: SmtDetail | null): string | null {
  const z = d?.z3 as { kind?: unknown; version?: unknown } | undefined;
  return z && typeof z.version === 'string' ? `z3 ${typeof z.kind === 'string' ? `${z.kind} ` : ''}${z.version}` : null;
}
