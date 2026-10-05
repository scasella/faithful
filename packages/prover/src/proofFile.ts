/**
 * Composes the Lean file that is actually checked. The model supplies only `helpers` (lemmas/defs placed before the
 * theorem) and `proof` (the text after `:=`). The statement, the model and the spec are ours and are never editable
 * by the model. Defense in depth:
 *   1. `vetProofText` rejects text that could change meaning or add trust (axioms, sorry, macros, notation, open, ...).
 *   2. The theorem's elaborated type is fingerprinted with `#check @thm` and must equal the type elaborated from a
 *      `sorry`-proof of the same statement in a clean file.
 *   3. `#print axioms` must list only propext, Classical.choice, Quot.sound (else not Proved; native_decide's axioms
 *      downgrade to "Proved (trusting the compiler)").
 */
import { hashText, tierFromAxioms } from '@faithful/core';
import { checkLean, type LeanCheckResult, type LeanDiagnostic } from './lean.js';

export interface ProofTarget {
  /** Complete Lean text of the model (starts with its imports). From `Translation.lean.source`. */
  modelSource: string;
  /** The agreed spec: Lean text without imports (`def`s, optional propositions). */
  specSource: string;
  theoremName: string;
  /** Statement after `theorem <name> :`, e.g. `∀ (x : Int), Model.pre x = true → Model.original x = Spec.spec x`. */
  statement: string;
  /** Extra imports for the proof (the slim tactic set). Models/specs need none. */
  tacticImports: string[];
  /** Source of the `Faithful.Core` runtime library, shown to the model (read-only) so it can see what the model's helpers mean. */
  library?: string;
}

export interface ProofAttempt {
  /** Lemmas/defs placed before the theorem. */
  helpers: string;
  /** Text after `:=`: a term or `by ...` block. */
  proof: string;
}

export interface BuiltProof {
  source: string;
  /** 1-based line where the model's helpers start and where the theorem starts (diagnostics are mapped back to these). */
  helpersStartLine: number;
  theoremLine: number;
  proofStartLine: number;
}

const IMPORT_RE = /^import\s+\S+\s*$/;

function splitImports(src: string): { imports: string[]; body: string } {
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  const imports: string[] = [];
  let i = 0;
  for (; i < lines.length; i++) {
    const l = lines[i]!.trim();
    if (l === '' || l.startsWith('--')) continue;
    if (IMPORT_RE.test(l)) imports.push(l);
    else break;
  }
  return { imports, body: lines.slice(i).join('\n') };
}

export function stripLeanComments(text: string): string {
  // Block comments (nested) and line comments. Good enough for keyword vetting; string literals containing `--` are rare in proofs.
  let out = '';
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.startsWith('/-', i)) {
      depth++;
      i++;
      continue;
    }
    if (depth > 0 && text.startsWith('-/', i)) {
      depth--;
      i++;
      continue;
    }
    if (depth > 0) continue;
    if (text.startsWith('--', i)) {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
      continue;
    }
    out += text[i];
  }
  return out;
}

const FORBIDDEN: Array<{ re: RegExp; why: string }> = [
  { re: /\bsorry\b/, why: 'sorry is not a proof' },
  { re: /\badmit\b/, why: 'admit is not a proof' },
  { re: /\baxiom\b/, why: 'axiom declarations are not allowed' },
  { re: /\bopaque\b/, why: 'opaque declarations are not allowed' },
  { re: /\bunsafe\b/, why: 'unsafe is not allowed' },
  { re: /\bimplemented_by\b|\bextern\b|\bcsimp\b/, why: 'compiler attributes are not allowed' },
  { re: /\b(macro|macro_rules|syntax|elab|elab_rules|notation|infix|infixl|infixr|prefix|postfix|declare_syntax_cat|initialize|builtin_initialize)\b/, why: 'syntax extensions could change the meaning of the statement' },
  { re: /^\s*(open|export|namespace|section|end|variable|universe|import|mutual)\b/m, why: 'open/namespace/section/variable/import/mutual are not allowed in proof text' },
  { re: /^\s*#(eval|print|check|reduce|exit|synth|guard|guard_msgs|where|help|lint|simp)\b/m, why: 'commands starting with # are not allowed in proof text' },
  { re: /\bset_option\s+(?!maxHeartbeats\b|maxRecDepth\b|linter\.)/, why: 'only set_option maxHeartbeats / maxRecDepth / linter.* are allowed' },
  { re: /\bFaithful\.[A-Za-z_.]*\b\s*:=/, why: 'redefining Faithful runtime names is not allowed' },
  { re: /@\[\s*(?:local\s+|scoped\s+)?(?:instance|default_instance|reducible_instance)\b/, why: 'instance attributes are not allowed' },
  { re: /^\s*(?:local\s+|scoped\s+)?instance\b/m, why: 'instance declarations are not allowed' },
];

/** Reasons the proof text is refused before it is ever compiled. Empty when acceptable. */
export function vetProofText(a: ProofAttempt): string[] {
  const reasons: string[] = [];
  for (const [label, text] of [['helpers', a.helpers], ['proof', a.proof]] as const) {
    const t = stripLeanComments(text);
    for (const f of FORBIDDEN) if (f.re.test(t)) reasons.push(`${label}: ${f.why}`);
  }
  if (a.proof.trim() === '') reasons.push('proof: empty');
  return reasons;
}

/** The theorem file with a given proof (or `sorry` for the fingerprint run). */
export function buildProofFile(target: ProofTarget, attempt: ProofAttempt | 'sorry', opts: { fingerprint?: boolean } = {}): BuiltProof {
  const model = splitImports(target.modelSource);
  const spec = splitImports(target.specSource);
  const imports = [...new Set([...model.imports, ...spec.imports, ...target.tacticImports.map((m) => `import ${m}`)])];
  const parts: string[] = [];
  const lineOf = () => parts.join('\n').split('\n').length + (parts.length ? 1 : 0);
  parts.push(imports.join('\n'), '');
  parts.push('-- model (generated by the translator)', model.body.trimEnd(), '');
  parts.push('-- agreed spec', spec.body.trimEnd(), '');
  const helpers = attempt === 'sorry' ? '' : attempt.helpers.trim();
  const helpersStartLine = lineOf();
  if (helpers) parts.push('-- helpers (from the model)', helpers, '');
  const theoremLine = lineOf();
  const head = `theorem ${target.theoremName} : ${target.statement} :=`;
  const proofText = attempt === 'sorry' ? 'sorry' : attempt.proof.trim();
  const proofStartLine = theoremLine;
  parts.push(head + (proofText.includes('\n') ? '\n' : ' ') + proofText);
  if (opts.fingerprint !== false) parts.push('', `#check @${target.theoremName}`);
  return { source: parts.join('\n') + '\n', helpersStartLine, theoremLine, proofStartLine };
}

function fingerprintOf(diags: LeanDiagnostic[], thm: string): string | null {
  const d = diags.find((x) => x.severity === 'info' && x.message.startsWith(`${thm} :`) || x.message.startsWith(`@${thm} :`));
  return d ? d.message.replace(/\s+/g, ' ').trim() : null;
}

const fpCache = new Map<string, Promise<string | null>>();

/** Elaborated type of the theorem from a `sorry` proof; cached per target. */
export function statementFingerprint(target: ProofTarget, opts: { budgetMs: number; leanDir?: string }): Promise<string | null> {
  const key = hashText(JSON.stringify([target.modelSource, target.specSource, target.theoremName, target.statement, target.tacticImports]));
  let p = fpCache.get(key);
  if (!p) {
    p = checkLean({ source: buildProofFile(target, 'sorry').source, budgetMs: opts.budgetMs, leanDir: opts.leanDir }).then((r) =>
      r.diagnostics.some((d) => d.severity === 'error') ? null : fingerprintOf(r.diagnostics, target.theoremName),
    );
    fpCache.set(key, p);
  }
  return p;
}

export type ProofVerdict =
  | { status: 'proved'; tier: 'proved' | 'proved-trusting-compiler'; axioms: string[] }
  | { status: 'rejected'; reasons: string[] }
  | { status: 'failed'; reason: 'compile-error' | 'timeout' | 'statement-changed' | 'bad-axioms' | 'no-axiom-report'; axioms?: string[] };

export interface ProofCheck {
  verdict: ProofVerdict;
  built: BuiltProof | null;
  check: LeanCheckResult | null;
  /** Diagnostics for display: errors first, each with the goal state when Lean gave one. */
  diagnostics: LeanDiagnostic[];
  source: string | null;
  /** The attempt text that was checked (for display and recording). */
  attemptText?: ProofAttempt;
}

/** Check one attempt end to end. Never trusts the model: vet, compile, fingerprint, axioms. */
export async function checkProof(target: ProofTarget, attempt: ProofAttempt, opts: { budgetMs: number; leanDir?: string }): Promise<ProofCheck> {
  const reasons = vetProofText(attempt);
  if (reasons.length) return { verdict: { status: 'rejected', reasons }, built: null, check: null, diagnostics: [], source: null, attemptText: attempt };
  const built = buildProofFile(target, attempt);
  const [check, fp] = await Promise.all([
    checkLean({ source: built.source, theorems: [target.theoremName], budgetMs: opts.budgetMs, leanDir: opts.leanDir }),
    statementFingerprint(target, opts),
  ]);
  const diagnostics = [...check.diagnostics.filter((d) => d.severity === 'error'), ...check.diagnostics.filter((d) => d.severity === 'warning')];
  const base = { built, check, diagnostics, source: built.source, attemptText: attempt };
  if (check.timedOut) return { ...base, verdict: { status: 'failed', reason: 'timeout' } };
  if (!check.ok) return { ...base, verdict: { status: 'failed', reason: 'compile-error' } };
  const got = fingerprintOf(check.diagnostics, target.theoremName);
  if (fp === null || got === null || got !== fp) return { ...base, verdict: { status: 'failed', reason: 'statement-changed' } };
  const ax = check.axioms[target.theoremName];
  if (!ax) return { ...base, verdict: { status: 'failed', reason: 'no-axiom-report' } };
  const tier = tierFromAxioms(ax.axioms);
  if (!tier) return { ...base, verdict: { status: 'failed', reason: 'bad-axioms', axioms: ax.axioms } };
  return { ...base, verdict: { status: 'proved', tier, axioms: ax.axioms } };
}
