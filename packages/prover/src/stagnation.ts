/**
 * Stagnation stop for the proof loop. Defined BEFORE any experiment uses it (docs/PROOFS.md); the hard attempt/time cap stays as a
 * backstop. The loop stops and reports "Not proved (N attempts, M minutes)" when:
 *   (i)  the model has emitted `sorry` (or another vetted-out cheat) or a statement-changing proof TWICE (cumulative), or
 *   (ii) the same primary diagnostic (class + goal state) repeats for 3 CONSECUTIVE attempts: no new goal progress.
 * It never changes what is accepted: vetting, the statement fingerprint and the axiom policy are untouched.
 *
 * Diagnostic classes (first Lean error of an attempt, by message):
 *   unsolved-goals   "unsolved goals"
 *   no-progress      "simp made no progress" / "made no progress"
 *   type-mismatch    "Type mismatch" / "type mismatch"
 *   unknown-ident    "unknown identifier" / "unknown constant"
 *   omega            "omega could not prove"
 *   rewrite          "rewrite failed" / "Did not find an occurrence"
 *   recursion-depth  "maximum recursion depth"
 *   elaboration      "failed to synthesize" / "function expected" / "application type mismatch"
 *   timeout          the check hit its wall-clock budget
 *   rejected         vetting refused the text before compiling
 *   other            anything else
 */
import type { LeanDiagnostic } from './lean.js';
import type { ProofCheck } from './proofFile.js';

export type DiagClass =
  | 'unsolved-goals' | 'no-progress' | 'type-mismatch' | 'unknown-ident' | 'omega' | 'rewrite'
  | 'recursion-depth' | 'elaboration' | 'timeout' | 'rejected' | 'other';

export function diagnosticClass(message: string): DiagClass {
  const m = message;
  if (/unsolved goals/i.test(m)) return 'unsolved-goals';
  if (/made no progress/i.test(m)) return 'no-progress';
  if (/omega could not prove/i.test(m)) return 'omega';
  if (/maximum recursion depth/i.test(m)) return 'recursion-depth';
  if (/rewrite.*failed|did not find an occurrence/i.test(m)) return 'rewrite';
  if (/unknown (identifier|constant)/i.test(m)) return 'unknown-ident';
  if (/application type mismatch|failed to synthesize|function expected/i.test(m)) return 'elaboration';
  if (/type mismatch/i.test(m)) return 'type-mismatch';
  return 'other';
}

const norm = (s: string): string => s.replace(/\s+/g, ' ').replace(/✝\d*/g, '').trim();

/** The key of an attempt: class + the primary goal state (or the message without positions when there is no goal). */
export function attemptKey(check: ProofCheck | null): string {
  if (!check) return 'no-check';
  const v = check.verdict;
  if (v.status === 'rejected') return 'rejected';
  if (v.status === 'proved') return 'proved';
  if (v.status === 'failed' && v.reason === 'timeout') return 'timeout';
  if (v.status === 'failed' && v.reason === 'statement-changed') return 'statement-changed';
  const d: LeanDiagnostic | undefined = check.diagnostics.find((x) => x.severity === 'error');
  if (!d) return `${v.status === 'failed' ? v.reason : 'none'}`;
  const cls = diagnosticClass(d.message);
  const basis = d.goal ?? d.message.split('\n').slice(0, 3).join(' ').replace(/\d+/g, '#');
  return `${cls}|${norm(basis).slice(0, 600)}`;
}

export function isCheat(check: ProofCheck | null): boolean {
  if (!check) return false;
  const v = check.verdict;
  if (v.status === 'rejected') return v.reasons.some((r) => /sorry|admit|axiom/i.test(r));
  if (v.status === 'failed') return v.reason === 'statement-changed' || v.reason === 'bad-axioms';
  return false;
}

export class StagnationTracker {
  private cheats = 0;
  private keys: string[] = [];

  /** Record an attempt; returns a plain-words reason when the loop should stop, else null. */
  observe(check: ProofCheck | null): string | null {
    if (isCheat(check)) this.cheats++;
    this.keys.push(attemptKey(check));
    if (this.cheats >= 2) return 'the model emitted sorry or a statement-changing proof twice';
    const n = this.keys.length;
    if (n >= 3) {
      const [a, b, c] = this.keys.slice(-3) as [string, string, string];
      if (a === b && b === c && a !== 'rejected' && a !== 'no-check') {
        return `the same diagnostic (${a.split('|')[0]}) with the same goal state repeated for 3 consecutive attempts`;
      }
    }
    return null;
  }
}
