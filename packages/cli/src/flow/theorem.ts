/** Builds the exact Lean statements the prover is asked to prove. The model never writes or edits these. */
import type { Precondition, Translation } from '@faithful/translate';

export interface Statement {
  theoremName: string;
  /** Lean text after `theorem <name> :`. */
  statement: string;
  /** Plain words. */
  words: string;
}

function binders(t: Translation): string {
  const names = t.lean.paramNames ?? t.params.map((p) => p.name);
  return t.lean.paramTypes.map((ty, i) => `(${names[i]} : ${ty})`).join(' ');
}

function callArgs(t: Translation): string {
  return (t.lean.paramNames ?? t.params.map((p) => p.name)).join(' ');
}

/** `no-throw` precondition for functions that can throw when the user chose to treat the throw as a precondition. */
export function noThrowPrecondition(t: Translation): Precondition {
  const call = `${t.lean.names.original} ${callArgs(t)}`.trim();
  return {
    id: 'no-throw',
    kind: 'no-throw',
    words: `The function does not throw on valid inputs (the ${t.throwSites.length === 1 ? 'throw' : 'throws'} ${t.throwSites.map((s) => JSON.stringify(s.message)).join(', ')} ${t.throwSites.length === 1 ? 'is' : 'are'} excluded by this precondition).`,
    lean: `(match ${call} with | .ok _ => true | .error _ => false)`,
  };
}

/** `∀ args, pre args → carve-outs → original args = spec args`. */
export function originalMeetsSpec(t: Translation, extra: Precondition[]): Statement {
  const call = callArgs(t);
  const hyps = [`${t.lean.names.pre} ${call}`.trim(), ...extra.map((p) => p.lean)].map((h) => `${h} = true`);
  const stmt = `∀ ${binders(t)}, ${hyps.join(' → ')} → ${t.lean.names.original} ${call} = Spec.spec ${call}`.replace(/\s+/g, ' ');
  return {
    theoremName: 'original_meets_spec',
    statement: stmt,
    words: 'For every input that satisfies the preconditions' + (extra.length ? ' and the stated carve-outs/choices' : '') + ', the original returns exactly what the agreed spec says.',
  };
}
