/**
 * `faithful verify .faithful/<fn>`: re-check a delivered result without trusting it. Recomputes hashes, re-runs Lean on the
 * proof file (axioms included), re-runs the differential test (and the SMT check when available), and prints the evidence
 * line again (rebuilt from these checks; it is not compared with a recorded one).
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { captureToolchain, faithfulLibraryHash, resolveLeanDir, hashText, stampFrom, tierFromAxioms } from '@faithful/core';
import { translate } from '@faithful/translate';
import { Sandbox, buildEvidenceBlock, generateInputs, tsVsLean, tsVsTs } from '@faithful/engine';
import { checkLean, evalBatch } from '@faithful/prover';
import type { Provenance } from '@faithful/session';
import type { SmtChecker } from './optimize.js';
import { verifyTestedOnly } from './tested.js';

export interface VerifyCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface VerifyReport {
  ok: boolean;
  checks: VerifyCheck[];
  evidence: string | null;
}

export async function verifyDirectory(dir: string, opts: { smt?: SmtChecker | null; leanDir?: string; log?: (s: string) => void } = {}): Promise<VerifyReport> {
  const log = opts.log ?? (() => {});
  const checks: VerifyCheck[] = [];
  const add = (name: string, ok: boolean, detail: string) => {
    checks.push({ name, ok, detail });
    log(`${ok ? '✓' : '✗'} ${name}: ${detail}`);
  };
  const fnGuess = dir.replace(/\/+$/, '').split('/').pop()!;
  const prov = JSON.parse(await readFile(join(dir, `${fnGuess}.provenance.json`), 'utf8')) as Provenance;
  const fn = prov.fn;

  // 1. hashes
  add('original source hash', hashText(prov.originalSource) === prov.hashes.originalSource, 'recorded function text matches its hash');
  add('optimized source hash', hashText(prov.optimizedSource) === prov.hashes.optimizedSource, 'recorded optimized text matches its hash');
  const patch = await readFile(join(dir, 'patch.diff'), 'utf8').catch(() => '');
  const patchRecorded = patch.startsWith('# no optimized') ? '' : patch;
  add('patch hash', hashText(patchRecorded) === prov.hashes.patch, 'patch.diff matches its recorded hash');
  if (prov.testedOnly) {
    // a function the translator refused: there is no model to re-translate, no Lean file and no SMT claim (tested.ts)
    const sbT = await Sandbox.open();
    try {
      const r = await verifyTestedOnly(prov, add, log, sbT);
      return { ok: checks.every((c) => c.ok), checks, evidence: r.evidence };
    } finally {
      await sbT.close();
    }
  }
  const t = translate(prov.originalFileSource ?? prov.originalSource, fn);
  if (!t.ok) {
    add('translation', false, `the original no longer translates: ${t.refusal.reason}`);
    return { ok: false, checks, evidence: null };
  }
  add('model hash', t.lean.hash === prov.hashes.model, 're-translating the recorded original yields the recorded Lean model');

  // 2. Lean
  let leanTiers: Array<'proved' | 'proved-trusting-compiler'> = [];
  let modelAgreements = 0;
  let modelDisagreements = 0;
  if (prov.hashes.leanFile) {
    const leanText = await readFile(join(dir, `${fn}.lean`), 'utf8');
    add('lean file hash', hashText(leanText) === prov.hashes.leanFile, `${fn}.lean matches its recorded hash`);
    const theorems = [...leanText.matchAll(/^#print axioms (\S+)/gm)].map((m) => m[1]!);
    const curLib = await faithfulLibraryHash(opts.leanDir ?? resolveLeanDir() ?? '').catch(() => undefined);
    const libDiffers = !!prov.faithfulLibraryHash && !!curLib && prov.faithfulLibraryHash !== curLib;
    const libUnknown = !prov.faithfulLibraryHash;
    if (libDiffers) add('Faithful library version', true, `NOTE: this delivery was checked against a different version of the Faithful Lean library (recorded ${prov.faithfulLibraryHash!.slice(7, 19)}, current ${curLib!.slice(7, 19)}). The proofs are re-checked below against the CURRENT library; if that fails, the cause may be the library change and not the proof.`);
    else if (libUnknown) add('Faithful library version', true, 'NOTE: this delivery does not record which version of the Faithful Lean library it was checked against; the proofs are re-checked against the current library.');
    const r = await checkLean({ source: leanText, budgetMs: 600_000, leanDir: opts.leanDir });
    add('lean compiles', r.ok, r.ok ? `Lean ${r.leanVersion.match(/version ([\d.]+)/)?.[1] ?? ''} accepted the file in ${(r.ms / 1000).toFixed(1)} s` : (r.diagnostics.find((d) => d.severity === 'error')?.message ?? 'failed').slice(0, 200));
    for (const th of theorems) {
      const a = r.axioms[th];
      const tier = a ? tierFromAxioms(a.axioms) : null;
      add(`axioms of ${th}`, !!tier, a ? `[${a.axioms.join(', ')}]${tier ? ` → ${tier}` : ' → not a proof'}` : 'no axiom report');
      if (tier) leanTiers.push(tier);
    }
    for (const c of prov.claims.filter((c) => c.theorem)) {
      const a = r.axioms[c.theorem!];
      const tier = a ? tierFromAxioms(a.axioms) : null;
      add(`claim ${c.kind}`, tier === c.tier, `recorded tier ${c.tier}, re-checked ${tier ?? 'not proved'}`);
    }
  }

  // 3. differential: original vs optimized, regenerated inputs from the recorded seed
  const sb = await Sandbox.open();
  try {
    const dc = prov.claims.find((c) => c.kind === 'candidate-vs-original-differential');
    if (prov.optimizedSource !== prov.originalSource) {
      const gen = generateInputs({ params: t.params, preconditions: [...t.preconditions, ...prov.carveOuts] }, { n: dc?.inputs ?? 1000, seed: dc?.seed ?? 1 });
      const rep = await tsVsTs(t, { source: prov.optimizedSource, fnName: fn }, gen.inputs, { sandbox: sb });
      const c0 = rep.candidates[0]!;
      add('differential', c0.disagreements.length === 0 && !c0.loadError, `${c0.compared} inputs compared, ${c0.disagreements.length} differences`);
    }
    // 4. model-vs-TypeScript check (the N behind "Proved")
    const rep2 = await tsVsLean(t, { n: 300, seed: 99 }, { lean: { evalBatch: (p, e, o) => evalBatch(p, e, { ...o, leanDir: opts.leanDir }) }, sandbox: sb });
    modelAgreements = rep2.agreements;
    modelDisagreements = rep2.disagreements.length;
    add('model vs TypeScript', rep2.disagreements.length === 0, `${rep2.agreements} inputs agree, ${rep2.disagreements.length} disagreements (original's model)`);
  } finally {
    await sb.close();
  }

  // 5. SMT
  const sc = prov.claims.find((c) => c.kind === 'candidate-vs-original-smt' && c.k);
  if (sc && opts.smt && prov.optimizedSource !== prov.originalSource) {
    const r = await opts.smt.check(t, prov.originalFileSource ?? prov.originalSource, prov.optimizedSource, fn, { budgetMs: 120_000 });
    add('smt', r.status === 'verified', `${r.status}${r.k ? ` at k=${r.k}` : ''}: ${r.note}`);
  } else if (sc) {
    add('smt', false, 'the SMT checker is not available in this build; the recorded Verified-to-k claim was NOT re-checked');
  }

  const stamp = stampFrom(await captureToolchain());
  const ev = leanTiers.length && modelDisagreements === 0 && modelAgreements > 0
    ? buildEvidenceBlock({ stamp, proof: { tier: leanTiers.includes('proved-trusting-compiler') ? 'proved-trusting-compiler' : 'proved' }, differential: { inputs: modelAgreements } } as never).text
    : null;
  return { ok: checks.every((c) => c.ok), checks, evidence: ev };
}
