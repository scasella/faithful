/**
 * The proof loop: ask Codex for a proof, check it ourselves, feed structured diagnostics (with goal states) back on
 * retry, stop on success or when the attempt/wall-clock budget runs out. A failed proof is reported as a failed proof.
 */
import { formatCount } from '@faithful/core';
import { CodexClient, type CodexCall } from './codex.js';
import { checkLean, type LeanDiagnostic } from './lean.js';
import { checkProof, buildProofFile, type BuiltProof, type ProofAttempt, type ProofCheck, type ProofTarget } from './proofFile.js';

export const PROOF_SCHEMA = {
  type: 'object',
  properties: {
    helpers: { type: 'string', description: 'Lean lemmas/defs placed before the theorem. Empty string if none.' },
    proof: { type: 'string', description: 'Exactly the text after `:=` of the theorem: a term or a `by` block.' },
    reasoning: { type: 'string', description: 'Two or three sentences: the proof idea.' },
  },
  required: ['helpers', 'proof', 'reasoning'],
  additionalProperties: false,
} as const;

export interface ReferenceProof {
  /** Why it is offered, e.g. "proof that the original meets the spec". */
  description: string;
  statement: string;
  helpers: string;
  proof: string;
}

export interface ProveOptions {
  maxAttempts: number;
  /** Wall-clock for the whole loop, ms. */
  budgetMs: number;
  /** Per-attempt Lean wall-clock, ms. */
  checkBudgetMs: number;
  reference?: ReferenceProof;
  leanDir?: string;
  signal?: AbortSignal;
  onEvent?: (e: ProveEvent) => void;
  /**
   * Reasoning effort per attempt: attempt n uses `effort[min(n, effort.length) - 1]` (the last entry repeats).
   * Default: `proofEffortPolicy()`.
   */
  effort?: string[];
  /**
   * Include the proof guide (model shape, tactic patterns), the induction principles Lean generates for the model's and
   * the spec's recursive functions, and diagnostics located in the attempt's own text. Default: `proofGuideDefault()`.
   */
  guide?: boolean;
}

/** Effort for attempt `n` (1-based) under a policy list. */
export function effortFor(policy: readonly string[], n: number): string | undefined {
  if (!policy.length) return undefined;
  return policy[Math.min(n, policy.length) - 1];
}

const EFFORTS = new Set(['minimal', 'low', 'medium', 'high', 'xhigh']);

/** Parse `low,medium,high` into a policy list; null when malformed. */
export function parseEffortPolicy(text: string): string[] | null {
  const parts = text.split(',').map((x) => x.trim()).filter(Boolean);
  if (!parts.length || parts.some((x) => !EFFORTS.has(x))) return null;
  return parts;
}

/**
 * The default proof-attempt effort policy: `high` on every attempt. Chosen on the TUNE set (docs/PROOFS.md): low proved
 * 2-3 of 13, medium 5, low->medium->high 4, high 5-7.
 */
export const DEFAULT_PROOF_EFFORT: readonly string[] = ['high'];

/**
 * The effort policy for proof attempts: `FAITHFUL_PROOF_EFFORT` (comma list, last entry repeats) if set; else
 * `FAITHFUL_EFFORT` for every attempt if set (so `FAITHFUL_EFFORT=low` also makes proofs low); else DEFAULT_PROOF_EFFORT.
 */
export function proofEffortPolicy(env: NodeJS.ProcessEnv = process.env): string[] {
  const p = env.FAITHFUL_PROOF_EFFORT ? parseEffortPolicy(env.FAITHFUL_PROOF_EFFORT) : null;
  if (p) return p;
  if (env.FAITHFUL_EFFORT) return [env.FAITHFUL_EFFORT];
  return [...DEFAULT_PROOF_EFFORT];
}

/** Whether the proof guide is on: yes unless `FAITHFUL_PROOF_GUIDE=0`. */
export function proofGuideDefault(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.FAITHFUL_PROOF_GUIDE !== '0';
}

export type ProveEvent =
  | { type: 'attempt-start'; n: number }
  | { type: 'codex-done'; n: number; call: CodexCall }
  | { type: 'checked'; n: number; check: ProofCheck; ms: number };

/**
 * The proof guide shown to the model when `guide` is on. Every tactic pattern in it was compiled against Lean 4.34.0 +
 * the pinned Mathlib on models emitted by the translator (docs/PROOFS.md, "The proof prompt").
 */
export const PROOF_GUIDE = String.raw`HOW THE MODEL IS SHAPED, AND WHAT WORKS IN LEAN 4.34 (read before writing the proof):
- \`Model.f\` is the translated function. Each loop is a separate recursive function \`Model.f_loopN\` that takes the loop's
  state as arguments and returns the final state (a tuple, read with \`.1\`, \`.2\`, ...); \`Model.f\` calls it once. Loops and
  recursive functions use well-founded recursion (\`termination_by\`), so:
  * \`rw [Model.f_loopN]\` unfolds ONE step (only the occurrences with those exact arguments). \`unfold Model.f_loopN\` unfolds
    every occurrence, including the one in the recursive call's result if it appears on both sides.
  * NEVER \`simp [Model.f_loopN]\` or \`simp_all [Model.f_loopN]\` on a recursive function: it rewrites forever ("maximum
    recursion depth has been reached"). For the non-recursive \`Model.f\`, \`simp only [Model.f]\` / \`unfold Model.f\` is fine.
- The \`_chk\`, \`_rangeOk\`, \`_pre\` functions only define the precondition. You usually do not need the hypothesis
  \`Model.f_pre .. = true\` at all; do not unfold \`_chk\` loops unless a bound is really needed (they are recursive too).
  A no-throw hypothesis \`(match Model.f .. with | .ok _ => true | .error _ => false) = true\` can also usually be ignored.
- Prove one helper lemma per loop, stated for ARBITRARY loop state with the invariant as an equation, then instantiate it
  at the initial state. Typical shape:
    theorem loop_eq (n : Int) : ∀ (acc i : Int), 1 ≤ i → i ≤ n + 1 →
        (Model.f_loop1 n acc i).1 = acc + Spec.g n.toNat - Spec.g (i - 1).toNat := by
      intro acc i
      fun_induction Model.f_loop1 n acc i with
      | case1 acc i h acc_1 i_1 ih =>   -- loop condition true
        intro h1 h2
        rw [ih (by omega) (by omega)]
        ...
      | case2 acc i h =>                 -- loop condition false: the loop returned its state
        intro h1 h2
        ...
  \`fun_induction\` binds, per case, exactly the names in the induction principle listed below (parameters that never change
  in the recursive call are NOT re-bound), then the branch hypothesis, then one name per \`let\` of the loop body (these
  are let-variables: \`simp only [acc_1, i_1]\` or \`omega\` sees through them), then the induction hypothesis. Count them from
  the principle; a wrong count gives "Too many variable names provided". Alternative: induction on a Nat measure
  (\`induction k generalizing acc i\` with \`k = (n - i).toNat\`) or \`Nat.strong_induction_on\`
  (\`induction m using Nat.strong_induction_on with | _ m ih => ...\`). There is no \`Int.inductionOn\`.
- If the spec's helper has an accumulator (\`aux n acc\`), first prove the accumulator lemma \`aux n acc = acc + aux n 0\`
  (or the analogous form) by induction; the loop lemma needs it.
- Except: \`if c then throw "m" else ...\` in the model and \`.error "m"\` in the spec are definitionally equal, so after
  \`simp only [Model.f, Spec.spec]\` and \`split\`, the throwing branch usually closes by \`rfl\`.
- Integers: \`omega\` proves linear goals over Int and Nat, including casts \`↑n\`, \`Int.toNat\`, \`Int.natAbs\`, \`min\`, \`max\`,
  and \`/\`, \`%\` by numerals; it does NOT know \`Int.fdiv\`/\`Int.tmod\`. Rewrite them first with
  \`Int.fdiv_eq_ediv_of_nonneg a (hb : 0 ≤ b) : a.fdiv b = a / b\` and \`Int.tmod_eq_emod_of_nonneg (ha : 0 ≤ a) : a.tmod b = a % b\`.
  To move between Int and Nat: \`obtain ⟨k, rfl⟩ : ∃ k : Nat, n = (k : Int) := ⟨n.toNat, by omega⟩\`, \`Int.toNat_of_nonneg\`,
  \`Int.toNat_natCast\`, \`push_cast\`. \`Faithful.iabs x\` is \`(x.natAbs : Int)\` (\`unfold Faithful.iabs; omega\`). Note
  \`simp\` turns \`↑x.natAbs\` into \`|x|\`, which omega does not read; keep \`natAbs\` (use \`simp only\`) when omega must finish.
- Use \`rw [ih ...]\` / \`rw [lemma args]\` with explicit arguments when the term must match exactly; \`simp [h]\` / \`simp_all\`
  / \`split\` / \`by_cases h : c <;> simp [h]\` for case splits on \`if\`; \`decide\` for closed Boolean facts; \`rfl\` for
  definitional equalities; \`linarith\`, \`nlinarith\`, \`ring\`, \`norm_num\`, \`positivity\` are available. Name lemmas you are
  sure exist (a misspelled name is an "Unknown constant" error).
- Lists: \`List.foldl_cons\`, \`List.foldl_nil\`, \`List.foldl_append\`, \`List.map_cons\`, \`List.reverse_cons\`, \`List.length_cons\`,
  \`List.take_add_one\`, \`List.range_succ\`, \`List.getElem_cons_succ\`; induct on the list with \`induction xs generalizing acc\`.
- If the library below includes \`Faithful.Simp\`, its @[simp] lemmas are active in plain \`simp\`: \`pure\`/\`throw\` become
  \`Except.ok\`/\`Except.error\`, \`Except.ok a = Except.ok b\` becomes \`a = b\`, \`Int.fdiv a b\` becomes \`a / b\` when \`0 ≤ b\`,
  \`Int.tmod a b\` becomes \`a % b\` when \`simp\` can prove \`0 ≤ a\`, \`Faithful.getD xs ↑n\` becomes \`xs.getD n default\`,
  \`Faithful.includes xs x = true\` becomes \`x ∈ xs\`, \`Faithful.inRange x = true\` becomes the two bounds; non-simp lemmas there
  (slice_of_nonneg, sliceFrom_of_nonneg, getD_of_nonneg, charAt_of_lt, foldl_add_eq, iabs_eq, ...) can be cited by name.
- NEVER write \`sorry\`: an attempt containing it is rejected without any Lean feedback. If you cannot finish, still submit
  your best complete attempt: Lean then reports the exact goal state where it fails, and you see it on the next attempt.
- Helper lemmas go in "helpers" (they may be \`theorem\`s and \`def\`s); give every helper a unique name.`;

export interface ProofAttemptRecord {
  n: number;
  /** Codex call: its `prompt` is "What the model saw". */
  call: CodexCall;
  attempt: ProofAttempt | null;
  check: ProofCheck | null;
  /** Wall-clock of this attempt (model + Lean), ms. */
  ms: number;
}

export type ProofResultTier = 'proved' | 'proved-trusting-compiler' | 'not-proved';

export interface ProofRecord {
  theorem: string;
  statement: string;
  result: ProofResultTier;
  attempts: ProofAttemptRecord[];
  /** Wall-clock of the loop, ms. */
  ms: number;
  /** The accepted proof, when proved. */
  accepted: { attempt: ProofAttempt; source: string; axioms: string[] } | null;
  /** Last failing diagnostics, kept so a failed proof can be shown with its goal state. */
  lastDiagnostics: LeanDiagnostic[];
  stoppedBy: 'proved' | 'attempts' | 'time' | 'codex-error' | 'aborted';
}

export function formatDiagnostics(diags: LeanDiagnostic[], max = 6, locate?: (line: number) => string | null): string {
  return diags
    .filter((d) => d.severity === 'error')
    .slice(0, max)
    .map((d) => {
      const where = locate?.(d.line);
      const msg = locate && d.message.length > 3000 ? d.message.slice(0, 3000) + '\n... (message truncated)' : d.message;
      return `error at line ${d.line}, column ${d.column}${where ? ` (${where})` : ''}:\n${msg}`;
    })
    .join('\n\n');
}

/** Map a line of the checked file back to the attempt's own text: "your proof, line 3: `simp [h]`". */
export function locateInAttempt(line: number, built: BuiltProof | null, attempt: ProofAttempt | null): string | null {
  if (!built || !attempt) return null;
  const helpers = attempt.helpers.trim();
  const proof = attempt.proof.trim();
  const quote = (t: string) => '`' + (t.trim().length > 160 ? t.trim().slice(0, 160) + '...' : t.trim()) + '`';
  if (helpers) {
    const k = line - built.helpersStartLine;
    const hl = helpers.split('\n');
    if (k >= 1 && k <= hl.length) return `your helpers, line ${k}: ${quote(hl[k - 1]!)}`;
  }
  const pl = proof.split('\n');
  const multi = proof.includes('\n');
  const k = multi ? line - built.theoremLine : line === built.theoremLine ? 1 : 0;
  if (k >= 1 && k <= pl.length) return `your proof, line ${k}: ${quote(pl[k - 1]!)}`;
  if (line === built.theoremLine) return 'the theorem statement line';
  return null;
}

export interface ProofPromptOptions {
  /** Include PROOF_GUIDE and locate diagnostics in the attempt text. */
  guide?: boolean;
  /** Induction principles of the recursive functions (from `inductionPrinciples`). */
  facts?: string;
}

const NON_LOOP = /_(chk|rangeOk|pre|asciiOk)$/;

/**
 * `#check @F.induct` for every recursive function of the model and the spec (the precondition twins excepted), compiled once.
 * The model cannot run Lean, and `fun_induction` case binders must be counted from these; they are facts, not hints.
 */
export async function inductionPrinciples(target: ProofTarget, opts: { budgetMs: number; leanDir?: string }): Promise<string> {
  const names: string[] = [];
  const collect = (src: string, ns: string) => {
    for (const m of src.matchAll(/^\s*(?:theorem|def)\s+([A-Za-z_][\w.]*)/gm)) {
      const n = m[1]!.startsWith(ns + '.') ? m[1]! : `${ns}.${m[1]}`;
      if (!NON_LOOP.test(n) && !names.includes(n)) names.push(n);
    }
  };
  collect(target.modelSource.slice(target.modelSource.indexOf('namespace Model')), 'Model');
  collect(target.specSource, 'Spec');
  if (!names.length) return '';
  const base = buildProofFile(target, 'sorry', { fingerprint: false }).source;
  const first = base.split('\n').length + 1;
  const source = base + '\n' + names.map((n) => `#check @${n}.induct`).join('\n') + '\n';
  let r;
  try {
    r = await checkLean({ source, budgetMs: opts.budgetMs, leanDir: opts.leanDir });
  } catch {
    return '';
  }
  const out: string[] = [];
  for (const d of r.diagnostics) {
    if (d.severity !== 'info') continue;
    const idx = d.line - first;
    if (idx < 0 || idx >= names.length) continue;
    out.push(d.message.length > 2500 ? d.message.slice(0, 2500) + ' ...' : d.message.trim());
  }
  return out.join('\n\n');
}

export function buildProofPrompt(target: ProofTarget, history: ProofAttemptRecord[], reference?: ReferenceProof, popts: ProofPromptOptions = {}): string {
  const shown = buildProofFile(target, 'sorry', { fingerprint: false }).source.replace(/:=\s*sorry\s*$/m, ':=\n  <YOUR PROOF GOES HERE>');
  const lib = target.library?.trim();
  const out: string[] = [
    'You are writing a Lean 4 proof. Lean 4.34.0, Mathlib (only the tactic modules imported below are available). A checker will compile your answer;',
    'you cannot run Lean, so write carefully and prefer robust tactics (simp, omega, decide, induction, cases, split, unfold, rfl, List lemmas).',
    '',
    'THE FILE (the model and the spec are fixed; do not restate them):',
    '```lean',
    shown.trim(),
    '```',
    ...(lib ? ['', 'THE RUNTIME LIBRARY the model uses (Faithful.Core; read-only, already imported; its definitions are what `Faithful.*` names in the model mean):', '```lean', lib, '```'] : []),
    ...(popts.guide ? ['', PROOF_GUIDE] : []),
    ...(popts.guide && popts.facts ? ['', 'INDUCTION PRINCIPLES Lean generated for the recursive functions above (`fun_induction F args` / `induction ... using F.induct` use these; the case binders follow them exactly):', '```lean', popts.facts, '```'] : []),
    '',
    `TASK: prove \`${target.theoremName}\`. Return JSON with:`,
    '- "helpers": optional Lean lemmas or defs placed BEFORE the theorem (empty string if none). They may not use sorry, axiom, notation, macro, open, namespace, instance or #commands.',
    '- "proof": exactly the text after `:=` (a term, or a `by` block).',
    '- "reasoning": two or three sentences on the proof idea.',
    'Do not use `sorry`. `native_decide` is accepted but downgrades the claim to "proved, trusting the compiler"; prefer `decide`, `omega`, `simp`, or an induction.',
    popts.guide
      ? 'The hypothesis `Model.<f>_pre ... = true` bundles the input bounds and the range conditions (`Model.<f>_rangeOk` runs the checked twin `_chk`); most proofs do not need it.'
      : 'The hypothesis `Model.pre ... = true` bundles the input bounds and the range conditions; `simp [Model.pre]` unfolds it.',
  ];
  if (reference) {
    out.push('', `A REFERENCE PROOF that may be adaptable (${reference.description}); its statement was \`${reference.statement}\`:`, '```lean');
    if (reference.helpers.trim()) out.push(reference.helpers.trim(), '');
    out.push(reference.proof.trim(), '```');
  }
  const failed = history.filter((h) => h.check && h.check.verdict.status !== 'proved');
  if (failed.length) {
    out.push('', 'PREVIOUS ATTEMPTS (most recent last). Fix the reported errors; do not repeat an approach that failed the same way.');
    for (const h of failed.slice(-3)) {
      const v = h.check!.verdict;
      out.push(`--- attempt ${h.n} ---`, '```lean');
      if (h.attempt?.helpers.trim()) out.push(h.attempt.helpers.trim(), '');
      out.push(h.attempt?.proof.trim() ?? '', '```');
      if (v.status === 'rejected') out.push('Rejected before compiling: ' + v.reasons.join('; '));
      else if (v.status === 'failed') {
        out.push(`Result: ${v.reason}${v.axioms ? ` (axioms: ${v.axioms.join(', ')})` : ''}`);
        const d = formatDiagnostics(h.check!.diagnostics, popts.guide ? 4 : 6, popts.guide ? (line) => locateInAttempt(line, h.check!.built, h.attempt) : undefined);
        if (d) out.push('Lean diagnostics (with goal states):', d);
      }
    }
  }
  return out.join('\n');
}

/** Run the loop. `codex` is shared so that call counts and serialization span the whole session. */
export async function proveTheorem(codex: CodexClient, target: ProofTarget, opts: ProveOptions): Promise<ProofRecord> {
  const t0 = performance.now();
  const attempts: ProofAttemptRecord[] = [];
  let stoppedBy: ProofRecord['stoppedBy'] = 'attempts';
  let accepted: ProofRecord['accepted'] = null;
  let result: ProofResultTier = 'not-proved';
  const effort = opts.effort ?? proofEffortPolicy();
  const guide = opts.guide ?? proofGuideDefault();
  const facts = guide ? await inductionPrinciples(target, { budgetMs: Math.min(60_000, opts.checkBudgetMs), leanDir: opts.leanDir }) : '';
  for (let n = 1; n <= opts.maxAttempts; n++) {
    if (opts.signal?.aborted) { stoppedBy = 'aborted'; break; }
    const left = opts.budgetMs - (performance.now() - t0);
    if (left <= 5_000) { stoppedBy = 'time'; break; }
    opts.onEvent?.({ type: 'attempt-start', n });
    const a0 = performance.now();
    const prompt = buildProofPrompt(target, attempts, opts.reference, { guide, facts });
    const call = await codex.ask({ purpose: 'proof-attempt', prompt, schema: PROOF_SCHEMA, timeoutMs: Math.min(left, 600_000), signal: opts.signal, effort: effortFor(effort, n) });
    opts.onEvent?.({ type: 'codex-done', n, call });
    if (call.error) {
      attempts.push({ n, call, attempt: null, check: null, ms: performance.now() - a0 });
      // a call cut off because the loop's own wall-clock ran out is the time budget, not a Codex failure
      stoppedBy = call.error.code === 'aborted' ? 'aborted' : call.error.code === 'timeout' && left < 600_000 ? 'time' : 'codex-error';
      break;
    }
    const o = call.output as { helpers?: unknown; proof?: unknown };
    const attempt: ProofAttempt = { helpers: typeof o.helpers === 'string' ? o.helpers : '', proof: typeof o.proof === 'string' ? o.proof : '' };
    const check = await checkProof(target, attempt, { budgetMs: Math.max(5_000, Math.min(opts.checkBudgetMs, opts.budgetMs - (performance.now() - t0))), leanDir: opts.leanDir });
    opts.onEvent?.({ type: 'checked', n, check, ms: performance.now() - a0 });
    attempts.push({ n, call, attempt, check, ms: performance.now() - a0 });
    if (check.verdict.status === 'proved') {
      result = check.verdict.tier;
      accepted = { attempt, source: check.source!, axioms: check.verdict.axioms };
      stoppedBy = 'proved';
      break;
    }
  }
  const last = attempts.at(-1);
  return {
    theorem: target.theoremName,
    statement: target.statement,
    result,
    attempts,
    ms: performance.now() - t0,
    accepted,
    lastDiagnostics: last?.check?.diagnostics ?? [],
    stoppedBy,
  };
}

/** "Not proved (3 attempts, 4.2 minutes)": the exact wording for a failed proof. */
export function failureLine(r: ProofRecord): string {
  const mins = r.ms / 60_000;
  const n = r.attempts.length;
  return `Not proved (${formatCount(n)} attempt${n === 1 ? '' : 's'}, ${mins < 0.1 ? '<0.1' : mins.toFixed(1)} minute${mins === 1 ? '' : 's'})`;
}
