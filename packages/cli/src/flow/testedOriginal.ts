/**
 * What the Tested tier runs as "the original", and the preflight that decides whether it can run at all.
 *
 * The original is the EXTRACTED UNIT (`extractUnit`, packages/engine/src/sandbox/extract.ts; rules in docs/SECURITY.md
 * "Extracted units"): the function plus only the module-level declarations it uses, so an unrelated import or top-level
 * side effect elsewhere in its file does not block it. When extraction refuses (for example because dropping a
 * top-level statement could change what the function sees) the whole file is tried instead, which is exactly what the
 * Tested tier ran before extraction existed; a function that ran then still runs.
 *
 * `testedPreflight` is the one check shared by the server's `testedBlocker` (GET /api/tested/check), `startTestedOnly`,
 * and the Pick list triage: the same source the run loads, through the same calls the run makes before anything is
 * measured (signature, compile gate on the original, the real `Sandbox.load` in the 'js' value domain, then the original
 * on a first sample of generated inputs). Every failure here is deterministic: offering the Tested tier for it would
 * only end in a failure no retry can change.
 */
import { hashText } from '@faithful/core';
import {
  compileGate,
  extractUnit,
  generateSignatureInputs,
  inferSignature,
  prepareSource,
  runJs,
  showJsOutcome,
  type FunctionSignature,
  type IncludedDecl,
  type Sandbox,
} from '@faithful/engine';
import { testedExtractWords, testedLoadWords, testedNoInputsWords, type TestedScope } from '@faithful/session';

export interface TestedOriginal {
  /** What `Sandbox.load`, the differential, the mutation check and the benchmark receive as the original. */
  source: string;
  fnName: string;
  scope: TestedScope;
  /** Declarations the extracted unit includes besides the function (empty for the whole file). */
  included: IncludedDecl[];
  notes: string[];
  /** Disclosures that qualify the Tested claim (extract.ts rule 6); empty for the whole file. */
  caveats: string[];
  /** Unit line -> original file line (extracted only). */
  lineMap?: number[];
}

/**
 * The original for a given scope (deterministic in the file text): the extracted unit for `'extracted'`, the file for
 * `'file'`. Throws if `'extracted'` was recorded but the file no longer extracts (the file changed under the session).
 */
export function testedOriginalFor(fileText: string, fnName: string, scope: TestedScope): TestedOriginal {
  if (scope === 'file') return { source: fileText, fnName, scope, included: [], notes: ['the whole file was loaded'], caveats: [] };
  const ex = extractUnit(fileText, fnName);
  if (!ex.ok) throw new Error(testedExtractWords(fnName, ex));
  return { source: ex.unit, fnName, scope, included: ex.included, notes: ex.notes, caveats: ex.caveats, lineMap: ex.lineMap };
}

/** The names of the included declarations, in file order (what `tested.started.included` records). */
export function includedNames(o: TestedOriginal): string[] {
  return o.included.map((d) => d.name);
}

export function unitHash(o: TestedOriginal): string {
  return hashText(o.source);
}

/** How many generated inputs the preflight runs the original on. */
export const PREFLIGHT_SAMPLE = 50;
/** Seed of the preflight sample: the first candidate's differential uses 7001 (tested.ts `7000 + id`). */
const PREFLIGHT_SEED = 7001;

export type TestedPreflight = { ok: true; original: TestedOriginal; sig: FunctionSignature } | { ok: false; reason: string };

/** The checks for ONE candidate original; null when it passes, else the plain reason. */
async function check(o: TestedOriginal, sb: Sandbox, sample: boolean): Promise<{ reason: string } | { sig: FunctionSignature }> {
  const fn = o.fnName;
  // A whole file that cannot even be prepared for the sandbox (value imports, re-exports, ...) is refused here, before
  // the compile gate, which costs seconds on a large file and blocks the thread while it runs. The verdict and the
  // words are unchanged: `Sandbox.load` refuses the same source with the same problem.
  if (o.scope === 'file') {
    const prep = prepareSource(o.source);
    if (!prep.ok) return { reason: testedLoadWords(fn, prep.error, o.scope) };
  }
  const sig = inferSignature(o.source, fn);
  if (!sig.ok) return { reason: `inputs cannot be generated from the signature of ${fn}: ${sig.reason}` };
  // let timers (the triage cap, SSE keep-alives) run before the synchronous compile gate
  await new Promise<void>((r) => setImmediate(r));
  // the run's compile gate compiles every candidate next to this original; an error on the original's side rejects all
  const cg = compileGate({ candidate: o.source, fnName: fn });
  const err = cg.diagnostics.find((d) => d.category === 'error');
  if (err) {
    // positions are in the unit; report the line of the user's file
    const line = o.lineMap?.[err.line - 1] ?? err.line;
    return { reason: testedLoadWords(fn, `line ${line}, column ${err.column}: ${err.message}`, o.scope) };
  }
  const id = `preflight:${fn}:${Math.random().toString(36).slice(2)}`;
  try {
    const loaded = await sb.load(id, o.source, fn, { values: 'js' });
    if (!loaded.ok) return { reason: testedLoadWords(fn, loaded.error, o.scope) };
  } finally {
    await sb.unload(id).catch(() => undefined);
  }
  if (sample) {
    const gen = generateSignatureInputs(sig.sig, { n: PREFLIGHT_SAMPLE, seed: PREFLIGHT_SEED, specials: false });
    if (gen.inputs.length > 0) {
      const r = await runJs(sb, { source: o.source, fnName: fn }, gen.inputs, 100);
      if (r.loadError) return { reason: testedLoadWords(fn, r.loadError, o.scope) };
      const usable = r.outcomes.filter((oc) => oc.tag === 'ok' || oc.tag === 'throw').length;
      if (usable === 0) return { reason: testedNoInputsWords(fn, gen.inputs.length, r.outcomes[0] ? showJsOutcome(r.outcomes[0]) : null) };
    }
  }
  return { sig: sig.sig };
}

/**
 * Can the Tested tier run `fnName` of `fileText`, and on which original? Extraction first; the whole file when
 * extraction refuses (except a refusal that holds for the whole file too, `sameForWholeFile`: an overloaded target). When both fail the reason is the extraction's (it is about the function, not the file).
 * `sample: false` skips running the original on generated inputs (cheaper; the run itself still checks).
 */
export async function testedPreflight(fileText: string, fnName: string, sb: Sandbox, opts: { sample?: boolean } = {}): Promise<TestedPreflight> {
  const sample = opts.sample ?? true;
  const ex = extractUnit(fileText, fnName);
  if (ex.ok) {
    const o = testedOriginalFor(fileText, fnName, 'extracted');
    const c = await check(o, sb, sample);
    return 'reason' in c ? { ok: false, reason: c.reason } : { ok: true, original: o, sig: c.sig };
  }
  if (ex.sameForWholeFile) return { ok: false, reason: testedExtractWords(fnName, ex) };
  const whole = testedOriginalFor(fileText, fnName, 'file');
  const c = await check(whole, sb, sample);
  if ('sig' in c) return { ok: true, original: whole, sig: c.sig };
  return { ok: false, reason: testedExtractWords(fnName, ex) };
}
