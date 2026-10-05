/**
 * The evidence line: one sentence per piece of evidence that exists, in a fixed order, e.g.
 *
 *   Proved against the agreed spec (Lean 4.34.0, Mathlib 5ed2965). Verified to k=6. 1,000 differential inputs.
 *   12 of 12 broken copies caught. 4.2× faster (95% CI 3.9–4.6) on the declared distribution.
 *
 * Rules enforced here (docs/DESIGN.md "Non-negotiables"):
 *  - Tier words come from @faithful/core (`TIER_LABEL`); versions come only from the `Stamp` (no version is typed in).
 *  - Wherever "Proved" appears, `provedSentence(N)` accompanies it, N = the differential inputs on which the model was
 *    checked against the TypeScript. No exported function returns a "Proved" text without that sentence:
 *    `buildEvidenceLine` returns the line followed by the sentence, `buildEvidenceBlock` returns both and their join.
 *    A proof without a differential count is an error, not a line.
 *  - Never "for all inputs"; no score, grade or percentage (the literal "95% CI" is the only percent sign).
 *    `lintEvidenceText` checks this and the builder runs it on everything it returns.
 *  - "faster" only when the two 95% intervals of median time do not overlap (benchmark verdict `faster`) AND the speed-up
 *    interval, as printed, lies above 1. Estimates and lower bounds round down, upper bounds up; a factor within 0.5 of 1
 *    gets two or more decimals, so "1.10× faster (95% CI 1.04–1.16)" never prints as "1.1× faster (95% CI 1.0–1.2)".
 */
import { TIER_LABEL, formatCount, provedSentence, type Stamp, type Tier } from '@faithful/core';
import type { Interval, Verdict } from '../benchmark/stats.js';

export interface EvidenceInput {
  /** Provenance of every figure in the line. The Lean version and Mathlib commit of a proof are read from here. */
  stamp: Stamp;
  /** Present only when Lean accepted the proof (tier from `tierFromAxioms`). */
  proof?: { tier: Extract<Tier, 'proved' | 'proved-trusting-compiler'> };
  /** Bounded verification to depth k. */
  bounded?: { k: number };
  /** Differential inputs on which the TypeScript and the Lean model agreed. */
  differential?: { inputs: number };
  /** From the mutation tester: k of m broken copies caught. */
  mutation?: { caught: number; total: number };
  /** From benchmark `compare`: speed-up of the candidate over the incumbent, its 95% CI and the verdict. */
  speed?: { ratio: Interval; verdict: Verdict };
}

export interface EvidenceBlock {
  /** The evidence line itself. */
  line: string;
  /** `provedSentence(N)` when the line says Proved, else null. */
  sentence: string | null;
  /** The line followed by the sentence (when there is one): the only form in which a Proved line leaves this module. */
  text: string;
  stamp: Stamp;
}

const PROVED_SENTENCE_RE =
  /Proved for the Lean model of this function\. The model is produced by a fixed translator \(docs\/TRANSLATOR\.md\) and checked against the TypeScript on [0-9][0-9,]* inputs\./g;

/** Problems with a user-facing evidence text; empty when it is acceptable. */
export function lintEvidenceText(text: string): string[] {
  const problems: string[] = [];
  const withoutCi = text.split('95% CI').join('');
  if (withoutCi.includes('%')) problems.push('contains a percent sign other than "95% CI"');
  if (/for\s+all\s+inputs/i.test(text)) problems.push('says "for all inputs"');
  if (/\b(score|scores|scored|grade|grades|graded|percent|percentage|rating|rated)\b/i.test(text)) {
    problems.push('contains a score, grade or percentage word');
  }
  const sentences = text.match(PROVED_SENTENCE_RE) ?? [];
  const rest = text.replace(PROVED_SENTENCE_RE, '');
  if (/Proved/.test(rest) && sentences.length === 0) problems.push('says Proved without provedSentence(N)');
  return problems;
}

function assertClean(text: string): string {
  const p = lintEvidenceText(text);
  if (p.length > 0) throw new Error(`evidence text rejected (${p.join('; ')}): ${text}`);
  return text;
}

function count(n: number, what: string): number {
  if (!Number.isSafeInteger(n) || n < 0) throw new RangeError(`evidence: ${what} must be a non-negative integer (got ${n})`);
  return n;
}

const EPS = 1e-9;
const MAX_DECIMALS = 6;

function positive(v: number): number {
  if (!Number.isFinite(v) || v <= 0) throw new RangeError(`evidence: speed-up ratio must be a positive finite number (got ${v})`);
  return v;
}
/** Rounded DOWN to d decimals: a point estimate or lower bound never prints larger than measured. */
function down(v: number, d: number): string {
  const f = 10 ** d;
  return (Math.floor(positive(v) * f + EPS) / f).toFixed(d);
}
/** Rounded UP to d decimals: an upper bound never prints smaller than measured. */
function up(v: number, d: number): string {
  const f = 10 ** d;
  return (Math.ceil(positive(v) * f - EPS) / f).toFixed(d);
}
/**
 * Decimals for a factor (est, interval lo–hi, all as printed: speed-up for "faster", slow-down for "slower"): one when
 * the factor is more than 0.5 away from 1, two when within 0.5, more until a claimed lower bound prints above 1.
 * null when the claim cannot be printed without a lower bound of 1 or below (the caller then makes no claim).
 */
function decimalsFor(est: number, lo: number, claim: boolean): number | null {
  let d = Math.abs(est - 1) <= 0.5 ? 2 : 1;
  if (!claim) return d;
  if (!(lo > 1)) return null;
  while (d <= MAX_DECIMALS && Number(down(lo, d)) <= 1) d++;
  return d <= MAX_DECIMALS ? d : null;
}

/** Lean version number from a `Stamp` (`lean --version` text such as "Lean (version 4.34.0, arm64-apple-darwin, ...)"). */
export function leanVersionOf(stamp: Stamp): string | null {
  const v = stamp.toolchain.lean.version;
  const m = v ? /(\d+\.\d+\.\d+(?:-rc\d+)?)/.exec(v) : null;
  return m ? m[1]! : null;
}

/** Abbreviated (7 hex) Mathlib commit from a `Stamp`. */
export function mathlibShortOf(stamp: Stamp): string | null {
  const c = stamp.toolchain.lean.mathlibCommit;
  return c && /^[0-9a-f]{7,40}$/i.test(c) ? c.slice(0, 7) : null;
}

function speedPiece(s: NonNullable<EvidenceInput['speed']>): string {
  const { ratio, verdict } = s;
  if (!(ratio.lo <= ratio.hi)) throw new RangeError('evidence: speed-up interval has lo > hi');
  positive(ratio.estimate);
  positive(ratio.lo);
  positive(ratio.hi);
  if (verdict === 'faster') {
    const d = decimalsFor(ratio.estimate, ratio.lo, true);
    if (d !== null) {
      return `${down(ratio.estimate, d)}× faster (95% CI ${down(ratio.lo, d)}–${up(ratio.hi, d)}) on the declared distribution.`;
    }
  }
  if (verdict === 'slower') {
    const est = 1 / ratio.estimate;
    const lo = 1 / ratio.hi;
    const hi = 1 / ratio.lo;
    const d = decimalsFor(est, lo, true);
    if (d !== null) return `${down(est, d)}× slower (95% CI ${down(lo, d)}–${up(hi, d)}) on the declared distribution.`;
  }
  // Not distinguished, or a verdict whose interval cannot be printed without contradicting it: no claim.
  const d = decimalsFor(ratio.estimate, ratio.lo, false)!;
  return `No speed difference distinguished on the declared distribution (speed-up 95% CI ${down(ratio.lo, d)}–${up(ratio.hi, d)}).`;
}

export function buildEvidenceBlock(input: EvidenceInput): EvidenceBlock {
  const pieces: string[] = [];
  let sentence: string | null = null;

  if (input.proof) {
    const tier = input.proof.tier;
    if (tier !== 'proved' && tier !== 'proved-trusting-compiler') throw new Error(`evidence: ${String(tier)} is not a proof tier`);
    const lean = leanVersionOf(input.stamp);
    const mathlib = mathlibShortOf(input.stamp);
    if (!lean || !mathlib) {
      throw new Error('evidence: a proof needs the Lean version and the Mathlib commit in the Stamp; neither may be typed in');
    }
    if (!input.differential) {
      throw new Error('evidence: "Proved" must carry provedSentence(N), N = differential inputs; no differential count was given');
    }
    pieces.push(`${TIER_LABEL[tier]} against the agreed spec (Lean ${lean}, Mathlib ${mathlib}).`);
    sentence = provedSentence(count(input.differential.inputs, 'differential inputs'));
  }
  if (input.bounded) {
    const k = input.bounded.k;
    if (!Number.isSafeInteger(k) || k < 1) throw new RangeError(`evidence: k must be a positive integer (got ${k})`);
    pieces.push(`${TIER_LABEL['verified-to-k']}=${k}.`);
  }
  if (input.differential) {
    const n = count(input.differential.inputs, 'differential inputs');
    pieces.push(`${formatCount(n)} differential ${n === 1 ? 'input' : 'inputs'}.`);
  }
  if (input.mutation) {
    const k = count(input.mutation.caught, 'caught');
    const m = count(input.mutation.total, 'total');
    if (k > m) throw new RangeError(`evidence: ${k} caught of ${m} broken copies is impossible`);
    pieces.push(`${formatCount(k)} of ${formatCount(m)} broken ${m === 1 ? 'copy' : 'copies'} caught.`);
  }
  if (input.speed) pieces.push(speedPiece(input.speed));

  const line = pieces.length > 0 ? pieces.join(' ') : `${TIER_LABEL['not-proved']}.`;
  const text = sentence ? `${line} ${sentence}` : line;
  assertClean(text);
  return { line, sentence, text, stamp: input.stamp };
}

/** The evidence line, followed by `provedSentence(N)` whenever the line says Proved. */
export function buildEvidenceLine(input: EvidenceInput): string {
  return buildEvidenceBlock(input).text;
}
