/**
 * SessionRuntime: the one object that runs the workflow for one function. It owns the event log (event-sourced; see
 * @faithful/session), persists it under `.faithful/<fn>/`, and exposes the operations the CLI and the UI call. Every model
 * call is recorded verbatim; every claim is derived from a checked result, never from the model's say-so.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import ts from 'typescript';
import { FaithfulStore, captureToolchain, hashText, resolveConfig, resolveLeanDir, stampFrom, type Z3Info } from '@faithful/core';
import { translate, type Precondition, type Translation } from '@faithful/translate';
import { Sandbox, tsVsLean } from '@faithful/engine';
import {
  CodexClient,
  SPEC_SCHEMA,
  buildSpecPrompt,
  buildSpecRevisionPrompt,
  evalBatch,
  failureLine,
  parseSpecDraft,
  proveTheorem,
  validateSpec,
  type CodexCall,
  type ProofCheck,
  type SpecDraft,
} from '@faithful/prover';
import {
  type Agreement,
  type CallRecord,
  type ChallengeRun,
  type ProofAttemptView,
  type ProofView,
  type SessionEvent,
  type SessionState,
  type SpecProposal,
  type StampedEvent,
  initialState,
  reduce,
  replay,
} from '@faithful/session';
import { agreementHash } from '@faithful/session/node';
import { challengeSearch } from './challenge.js';
import { carveOptions, makeCarveOut, type CarveClass } from './carveout.js';
import { noThrowPrecondition, originalMeetsSpec } from './theorem.js';

export type Listener = (e: StampedEvent) => void;

export interface RuntimeOptions {
  repoRoot: string;
  codex?: CodexClient;
  sandbox?: Sandbox;
  leanDir?: string;
  z3?: Z3Info | null;
}

export type RulingInput =
  | { challengeId: string; ruling: 'spec-wrong'; note?: string }
  | { challengeId: string; ruling: 'function-wrong'; then: 'fix-original'; note?: string }
  | { challengeId: string; ruling: 'function-wrong'; then: 'carve-out'; carve: CarveClass; note?: string };

export function extractJsDoc(fileSource: string, fn: string): string | null {
  const sf = ts.createSourceFile('x.ts', fileSource, ts.ScriptTarget.ES2022, true);
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && st.name?.text === fn) {
      const docs = ts.getJSDocCommentsAndTags(st).filter(ts.isJSDoc);
      if (!docs.length) return null;
      return docs.map((d) => d.getText(sf)).join('\n');
    }
  }
  return null;
}

function attemptView(n: number, callId: number | null, check: ProofCheck, ms: number): ProofAttemptView {
  const v = check.verdict;
  return {
    n,
    callId,
    helpers: check.attemptText?.helpers ?? '',
    proof: check.attemptText?.proof ?? '',
    verdict: v.status === 'proved' ? v.tier : v.status === 'rejected' ? 'rejected' : 'failed',
    failureReason: v.status === 'failed' ? v.reason : v.status === 'rejected' ? v.reasons.join('; ') : undefined,
    diagnostics: check.diagnostics.filter((d) => d.severity === 'error').map((d) => ({ line: d.line, column: d.column, message: d.message, goal: d.goal })),
    ms,
  };
}

export class SessionRuntime {
  readonly opts: RuntimeOptions;
  readonly store: FaithfulStore;
  readonly codex: CodexClient;
  private sandbox: Sandbox | null;
  private readonly ownSandbox: boolean;
  events: StampedEvent[] = [];
  state: SessionState = initialState();
  private listeners = new Set<Listener>();
  private t0 = Date.now();
  private callSeq = 0;

  constructor(opts: RuntimeOptions) {
    this.opts = opts;
    this.store = new FaithfulStore(opts.repoRoot);
    this.codex = opts.codex ?? new CodexClient(resolveConfig());
    this.sandbox = opts.sandbox ?? null;
    this.ownSandbox = !opts.sandbox;
  }

  // ───────────── events ─────────────

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  async emit(event: SessionEvent): Promise<void> {
    const stamped: StampedEvent = { seq: (this.events.at(-1)?.seq ?? 0) + 1, t: Date.now() - this.t0, event };
    this.events.push(stamped);
    this.state = reduce(this.state, event);
    for (const l of this.listeners) l(stamped);
    if (this.state.fn) {
      // serialize writes so concurrent emits never interleave their atomic renames
      this.writing = this.writing.then(() => this.persist());
      await this.writing;
    }
  }
  private writing: Promise<void> = Promise.resolve();

  private async persist(): Promise<void> {
    const fn = this.state.fn;
    let from = 0;
    for (let i = this.events.length - 1; i >= 0; i--) if (this.events[i]!.event.kind === 'session.started') { from = i; break; }
    await this.store.writeText(fn, 'events.jsonl', this.events.slice(from).map((e) => JSON.stringify(e)).join('\n') + '\n');
    await this.store.writeJson(fn, 'session.json', this.state);
  }

  /** Resume from `.faithful/<fn>/events.jsonl`. */
  async resume(fn: string): Promise<boolean> {
    const text = await this.store.readText(fn, 'events.jsonl');
    if (!text) return false;
    this.events = text.split('\n').filter(Boolean).map((l) => JSON.parse(l) as StampedEvent);
    this.state = replay(this.events);
    this.t0 = Date.now() - (this.events.at(-1)?.t ?? 0);
    this.callSeq = this.state.calls.length;
    return true;
  }

  async getSandbox(): Promise<Sandbox> {
    if (!this.sandbox) this.sandbox = await Sandbox.open();
    return this.sandbox;
  }

  async close(): Promise<void> {
    if (this.ownSandbox && this.sandbox) await this.sandbox.close();
    this.sandbox = null;
  }

  private lean() {
    const leanDir = this.opts.leanDir;
    return { evalBatch: (prelude: string, exprs: string[], o: { budgetMs: number }) => evalBatch(prelude, exprs, { ...o, leanDir }) };
  }

  // ───────────── select + translate ─────────────

  async openFunction(file: string, fn: string): Promise<void> {
    const abs = resolve(this.opts.repoRoot, file);
    const rel = relative(resolve(this.opts.repoRoot), abs);
    if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('the file must be inside the repository');
    const source = await readFile(abs, 'utf8');
    await this.start(file, fn, source);
  }

  async pasteFunction(source: string, fn: string): Promise<void> {
    await this.start('', fn, source);
  }

  private async start(file: string, fn: string, fileSource: string): Promise<void> {
    // the event log is continuous for the life of the process (unique seq); persistence slices from the last session.started
    this.state = initialState();
    this.t0 = Date.now();
    const tc = await captureToolchain({ z3: this.opts.z3 ?? null });
    this.fileSource = fileSource;
    await this.emit({ kind: 'session.started', fn, file, source: fileSource, sourceHash: hashText(fileSource), toolchain: tc });
    const r = translate(fileSource, fn);
    await this.emit({ kind: 'translate.done', result: r.ok ? { ok: true, value: r } : { ok: false, refusal: r.refusal } });
  }
  private fileSource = '';
  get fileText(): string {
    return this.fileSource || this.state.source;
  }
  /** Optional bounded-SMT checker (set by the CLI once packages/smt is wired). */
  smt: import('./optimize.js').SmtChecker | null = null;

  get translation(): Translation | null {
    return this.state.translation?.ok ? this.state.translation.value : null;
  }

  private need(): Translation {
    const t = this.translation;
    if (!t) throw new Error('this function was refused by the translator; only the Tested tier is available');
    return t;
  }

  async chooseThrow(choice: 'precondition' | 'spec-case'): Promise<void> {
    await this.emit({ kind: 'throw.choice', choice });
  }

  // ───────────── spec agreement ─────────────

  async recordCall(call: CodexCall): Promise<number> {
    const id = ++this.callSeq;
    const rec: CallRecord = {
      id,
      purpose: call.purpose as CallRecord['purpose'],
      prompt: call.prompt,
      response: call.rawOutput,
      model: call.model,
      effort: call.effort,
      ms: call.ms,
      inputTokens: call.usage?.inputTokens ?? null,
      outputTokens: call.usage?.outputTokens ?? null,
      error: call.error ? `${call.error.code}: ${call.error.message}` : null,
      startedAt: call.startedAt,
    };
    await this.emit({ kind: 'call.recorded', call: rec });
    return id;
  }

  private specInputs() {
    const t = this.need();
    return { typescript: t.source.text, jsdoc: extractJsDoc(this.fileSource || this.state.source, t.fnName), translation: t };
  }

  /** Does this function throw literal messages? Then the user must choose before the spec is proposed. */
  needsThrowChoice(): boolean {
    const t = this.translation;
    return !!t && t.canThrow && this.state.throwChoice === null;
  }

  currentProposal(): SpecProposal | null {
    return this.state.proposals.at(-1) ?? null;
  }

  async proposeSpec(): Promise<SpecProposal> {
    const inp = this.specInputs();
    if (this.needsThrowChoice()) throw new Error('choose first: treat the throw as a precondition, or model it as a spec case');
    const call = await this.codex.ask({ purpose: 'spec-proposal', prompt: buildSpecPrompt(inp), schema: SPEC_SCHEMA });
    return this.finishProposal(call, 'proposal');
  }

  /** Revision after "the spec is wrong" rulings on the current spec. */
  async reviseSpec(): Promise<SpecProposal> {
    const inp = this.specInputs();
    const cur = this.currentProposal();
    if (!cur) throw new Error('no spec to revise');
    const specHash = cur.validation.ok ? cur.validation.hash : '';
    const wrong = this.state.rulings.filter((r) => r.specHash === specHash && r.ruling === 'spec-wrong');
    const runs = this.state.challengeRuns.filter((r) => r.specHash === specHash);
    const items = wrong.flatMap((r) => {
      const d = runs.flatMap((x) => x.disagreements).find((c) => c.id === r.challengeId);
      return d ? [{ input: d.input, spec: d.spec, original: d.original, note: r.note }] : [];
    });
    if (!items.length) throw new Error('no "the spec is wrong" rulings to revise from');
    const prev: SpecDraft = { lean: cur.lean, lines: cur.lines, properties: cur.properties, english: cur.english };
    const call = await this.codex.ask({ purpose: 'spec-revision', prompt: buildSpecRevisionPrompt(inp, prev, items), schema: SPEC_SCHEMA });
    return this.finishProposal(call, 'revision');
  }

  private async finishProposal(call: CodexCall, kind: SpecProposal['kind']): Promise<SpecProposal> {
    const callId = await this.recordCall(call);
    const id = this.state.proposals.length + 1;
    let draft: SpecDraft | string = call.error ? `the model call failed: ${call.error.message}` : parseSpecDraft(call.output);
    let proposal: SpecProposal;
    if (typeof draft === 'string') {
      proposal = { id, kind, lean: '', lines: [], properties: [], english: '', callId, validation: { ok: false, errors: [draft] } };
    } else {
      const v = await validateSpec(this.need(), draft, { leanDir: this.opts.leanDir });
      proposal = { id, kind, lean: draft.lean, lines: draft.lines, properties: draft.properties, english: draft.english, callId, validation: v.ok ? { ok: true, hash: v.hash } : { ok: false, errors: v.errors } };
    }
    await this.emit({ kind: 'spec.proposed', proposal });
    if (proposal.validation.ok) await this.rerunChallenge();
    return proposal;
  }

  /** Preconditions the theorem and the search run under: translator's + no-throw (if chosen) + carve-outs. */
  effectivePreconditions(): { search: Precondition[]; carveOuts: Precondition[]; theoremExtra: Precondition[] } {
    const t = this.need();
    const nt = t.canThrow && this.state.throwChoice === 'precondition' ? [noThrowPrecondition(t)] : [];
    return { search: t.preconditions, carveOuts: this.state.carveOuts, theoremExtra: [...nt, ...this.state.carveOuts] };
  }

  async rerunChallenge(n = 400): Promise<ChallengeRun> {
    const t = this.need();
    const cur = this.currentProposal();
    if (!cur || !cur.validation.ok) throw new Error('no valid spec to search against');
    const eff = this.effectivePreconditions();
    const sandbox = await this.getSandbox();
    const res = await challengeSearch(
      t,
      cur.lean,
      { n, seed: 20260101 + this.state.challengeRuns.length, throwChoice: this.state.throwChoice, carveOuts: eff.carveOuts },
      { lean: this.lean(), sandbox },
    );
    const run: ChallengeRun = { id: this.state.challengeRuns.length + 1, specHash: cur.validation.hash, ...res.run };
    await this.emit({ kind: 'challenge.run', run });
    return run;
  }

  /** Deterministic menu of carve-out classes for a disagreement. */
  carveOptionsFor(challengeId: string) {
    const t = this.need();
    const d = this.state.challengeRuns.flatMap((r) => r.disagreements).find((c) => c.id === challengeId);
    if (!d) throw new Error('unknown challenge');
    return carveOptions(t, d.input);
  }

  async rule(input: RulingInput): Promise<void> {
    const t = this.need();
    const cur = this.currentProposal();
    if (!cur || !cur.validation.ok) throw new Error('no valid spec');
    const specHash = cur.validation.hash;
    const d = this.state.challengeRuns.flatMap((r) => r.disagreements).find((c) => c.id === input.challengeId);
    if (!d) throw new Error('unknown challenge');
    if (input.ruling === 'spec-wrong') {
      await this.emit({ kind: 'ruling.made', ruling: { challengeId: input.challengeId, specHash, ruling: 'spec-wrong', note: input.note } });
      return;
    }
    if (input.then === 'fix-original') {
      await this.emit({ kind: 'ruling.made', ruling: { challengeId: input.challengeId, specHash, ruling: 'function-wrong', then: 'fix-original', note: input.note } });
      return;
    }
    const carveOut = makeCarveOut(t, d.input, input.carve);
    await this.emit({ kind: 'ruling.made', ruling: { challengeId: input.challengeId, specHash, ruling: 'function-wrong', then: 'carve-out', carveOut, note: input.note } });
    await this.rerunChallenge();
  }

  /** Why Agree is not available yet, or null when it is. Nothing proceeds with a disagreement outstanding. */
  agreeBlocker(): string | null {
    const cur = this.currentProposal();
    if (!cur) return 'There is no spec yet.';
    if (!cur.validation.ok) return 'The current spec did not compile against the model.';
    if (this.needsThrowChoice()) return 'Choose how to treat the throw first.';
    const run = this.state.challengeRuns.at(-1);
    if (!run || run.specHash !== cur.validation.hash) return 'The challenge search has not run on this spec.';
    const ids = run.carveOutIds ?? [];
    const have = this.state.carveOuts.map((c) => c.id);
    if (JSON.stringify(ids) !== JSON.stringify(have)) return 'The challenge search has not run with the current carve-outs.';
    const open = run.totalDisagreements ?? run.disagreements.length;
    if (open > 0) {
      const fixOrig = this.state.rulings.some((r) => r.specHash === run.specHash && r.ruling === 'function-wrong' && r.then === 'fix-original');
      return fixOrig
        ? `${open} disagreement${open === 1 ? '' : 's'} remain; you ruled that your function is wrong: fix it and open it again, or carve the class out.`
        : `${open} disagreement${open === 1 ? '' : 's'} between the spec and the original remain; rule on each (revise the spec, fix your function, or carve the class out).`;
    }
    return null;
  }

  async agree(): Promise<Agreement> {
    const blocker = this.agreeBlocker();
    if (blocker) throw new Error(blocker);
    const t = this.need();
    const cur = this.currentProposal()!;
    const eff = this.effectivePreconditions();
    const base = {
      specLean: cur.lean,
      preconditions: [...t.preconditions, ...(t.canThrow && this.state.throwChoice === 'precondition' ? [noThrowPrecondition(t)] : [])],
      carveOuts: eff.carveOuts,
      rulings: this.state.rulings,
      throwChoice: this.state.throwChoice,
    };
    const agreement: Agreement = {
      ...base,
      specHash: (cur.validation as { hash: string }).hash,
      english: cur.english,
      hash: agreementHash(base),
      at: new Date().toISOString(),
    };
    await this.emit({ kind: 'spec.agreed', agreement });
    return agreement;
  }

  private libCache: string | undefined;
  /** The runtime library shown (read-only) to the prover: Faithful.Core, then Faithful.Simp (imported by Faithful.Tactics). */
  async librarySource(): Promise<string | undefined> {
    if (this.libCache !== undefined) return this.libCache;
    const dir = this.opts.leanDir ?? resolveLeanDir();
    try {
      const core = dir ? await readFile(join(dir, 'Faithful', 'Core.lean'), 'utf8') : '';
      const simp = dir ? await readFile(join(dir, 'Faithful', 'Simp.lean'), 'utf8').catch(() => '') : '';
      this.libCache = simp ? `${core.trimEnd()}\n\n-- ===== Faithful.Simp (imported by Faithful.Tactics) =====\n${simp}` : core;
    } catch {
      this.libCache = '';
    }
    return this.libCache || undefined;
  }

  /** Imports of proof files: the slim tactic set, which includes Faithful.Simp. */
  proofImports(): string[] {
    return ['Faithful.Tactics'];
  }

  /** Compare a Lean model with its TypeScript on N inputs (the N that accompanies every "Proved"). Records the result. */
  async checkModel(subject: 'original' | 'candidate', t: Translation, candidateId: number | null, n = 1000): Promise<{ inputs: number; disagreements: number }> {
    const sandbox = await this.getSandbox();
    const seed = 424242;
    const rep = await tsVsLean(t, { n, seed }, { lean: this.lean(), sandbox });
    const check = { subject, candidateId, inputs: rep.agreements, disagreements: rep.disagreements.length, seed, ms: rep.tsMs + rep.leanMs };
    await this.emit({ kind: 'model.checked', check });
    return { inputs: check.inputs, disagreements: check.disagreements };
  }

  // ───────────── prove the original ─────────────

  async proveOriginal(budget: { maxAttempts: number; minutes: number }): Promise<ProofView> {
    const t = this.need();
    const ag = this.state.agreement;
    if (!ag) throw new Error('agree to a spec first');
    const eff = this.effectivePreconditions();
    const stmt = originalMeetsSpec(t, eff.theoremExtra);
    const theoremId = stmt.theoremName;
    const view: ProofView = { theoremId, statement: stmt.statement, statementWords: stmt.words, pinnedTo: ag.hash, attempts: [], result: 'running', accepted: null, ms: 0, budget: { maxAttempts: budget.maxAttempts, minutes: budget.minutes } };
    await this.emit({ kind: 'proof.started', proof: view });
    const target = { modelSource: t.lean.source, specSource: ag.specLean, theoremName: stmt.theoremName, statement: stmt.statement, tacticImports: this.proofImports(), library: await this.librarySource() };
    const callIds = new Map<number, number>();
    const pending: Promise<void>[] = [];
    const rec = await proveTheorem(this.codex, target, {
      maxAttempts: budget.maxAttempts,
      budgetMs: budget.minutes * 60_000,
      checkBudgetMs: 180_000,
      leanDir: this.opts.leanDir,
      onEvent: (e) => {
        // emitted live so the UI shows each attempt as it finishes
        if (e.type === 'codex-done') pending.push(this.recordCall(e.call).then((id) => void callIds.set(e.n, id)));
        if (e.type === 'checked') {
          pending.push(
            Promise.all(pending.slice()).then(() =>
              this.emit({ kind: 'proof.attempt', theoremId, attempt: attemptView(e.n, callIds.get(e.n) ?? null, e.check, e.ms) }),
            ),
          );
        }
      },
    });
    await Promise.all(pending);
    await this.emit({
      kind: 'proof.done',
      theoremId,
      result: rec.result,
      accepted: rec.accepted ? { helpers: rec.accepted.attempt.helpers, proof: rec.accepted.attempt.proof, source: rec.accepted.source, axioms: rec.accepted.axioms } : null,
      ms: rec.ms,
      failureLine: rec.result === 'not-proved' ? failureLine(rec) : undefined,
      stoppedBy: rec.stoppedBy,
    });
    if (rec.result !== 'not-proved') await this.checkModel('original', t, null); // the N behind the Proved sentence
    return this.state.proofs.find((p) => p.theoremId === theoremId)!;
  }
}

export { stampFrom, mkdir, writeFile, dirname, join, FaithfulStore };
