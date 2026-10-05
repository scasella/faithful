/** `faithful optimize <file> --fn <name>`: the whole workflow headlessly, asking the user on a TTY at the three decision points. */
import { createInterface } from 'node:readline/promises';
import { resolve } from 'node:path';
import { createApi } from './api.js';
import { Optimizer, deliver } from './flow/index.js';
import { openZ3 } from '@faithful/smt';

export interface OptimizeCmdOptions {
  file: string;
  fn: string;
  repo: string;
  minutes: number;
  yes: boolean;
  proofAttempts: number;
  proofMinutes: number;
  log: (s: string) => void;
}

const AGREE_TEXT =
  'You are agreeing to this spec, these preconditions, these rulings and these carve-outs. Everything proved afterwards is proved against this hash. Changing any of them invalidates the proofs and the incumbent.';

export async function runOptimize(o: OptimizeCmdOptions): Promise<number> {
  const { log } = o;
  const api = await createApi(resolve(o.repo));
  const rt = api.runtime;
  const rl = process.stdin.isTTY ? createInterface({ input: process.stdin, output: process.stdout }) : null;
  const ask = async (q: string): Promise<string> => (rl ? (await rl.question(q)).trim().toLowerCase() : '');
  rt.subscribe((e) => {
    const ev = e.event;
    if (ev.kind === 'stage.result') log(`  candidate ${ev.candidateId} · ${ev.result.stage}: ${ev.result.status} (${Math.round(ev.result.ms)} ms) ${ev.result.summary}`);
    else if (ev.kind === 'candidate.decided') log(`  candidate ${ev.candidateId}: ${ev.outcome}${ev.tier ? ` [${ev.tier}]` : ''}${ev.rejection ? ` — ${ev.rejection.reason}` : ''}`);
    else if (ev.kind === 'proof.attempt') log(`  proof attempt ${ev.attempt.n}: ${ev.attempt.verdict}${ev.attempt.failureReason ? ` (${ev.attempt.failureReason})` : ''}`);
    else if (ev.kind === 'job.failed') log(`  FAILED ${ev.job}: ${ev.message}`);
  });
  try {
    log(`Translating ${o.fn} in ${o.file}…`);
    await rt.openFunction(o.file, o.fn);
    const tr = rt.state.translation;
    if (!tr || !tr.ok) {
      log(`Refused by the translator (${tr && !tr.ok ? tr.refusal.code : '?'}): ${tr && !tr.ok ? tr.refusal.reason : ''}`);
      log(tr && !tr.ok ? `  at line ${tr.refusal.span.line}, column ${tr.refusal.span.column}` : '');
      log('Only the Tested tier is available for this function (differential testing plus the mutation check); no proof or SMT claim can be made.');
      return 3;
    }
    for (const p of tr.value.preconditions) log(`  precondition: ${p.words}`);
    if (rt.needsThrowChoice()) {
      log(`This function throws ${tr.value.throwSites.map((s) => JSON.stringify(s.message)).join(', ')}.`);
      const a = o.yes ? 'p' : await ask('Treat the throw as a precondition [p] or model it as a spec case [s]? ');
      await rt.chooseThrow(a === 's' ? 'spec-case' : 'precondition');
    }
    log('Asking the model for a spec…');
    await rt.proposeSpec();
    for (let guard = 0; guard < 8; guard++) {
      const prop = rt.currentProposal()!;
      if (!prop.validation.ok) {
        log(`The spec did not compile: ${prop.validation.errors.join('; ')}. Asking again…`);
        await rt.proposeSpec();
        continue;
      }
      log(`\nSpec:\n${prop.lean}\n${prop.english}\n`);
      const blocker = rt.agreeBlocker();
      if (!blocker) break;
      const run = rt.state.challengeRuns.at(-1);
      const d = run?.disagreements[0];
      if (!d) {
        log(blocker);
        return 4;
      }
      log(`${blocker}\nDisagreement: input ${JSON.stringify(d.input)}: spec says ${JSON.stringify(d.spec)}, the original returns ${JSON.stringify(d.original)}.`);
      if (!rl) {
        log('Run interactively to rule on disagreements.');
        return 4;
      }
      const r = await ask('Who is wrong? [s]pec / [f]unction (carve the class out) / [q]uit: ');
      if (r === 'q' || r === '') return 4;
      if (r === 's') {
        await rt.rule({ challengeId: d.id, ruling: 'spec-wrong' });
        await rt.reviseSpec();
      } else {
        const opts = rt.carveOptionsFor(d.id);
        opts.forEach((c, i) => log(`  ${i + 1}. exclude ${c.excluded}`));
        const k = Number(await ask('Which class to carve out (number, 0 = I will fix my function instead)? '));
        if (!k || !opts[k - 1]) {
          await rt.rule({ challengeId: d.id, ruling: 'function-wrong', then: 'fix-original' });
          log('Fix your function and run again.');
          return 4;
        }
        await rt.rule({ challengeId: d.id, ruling: 'function-wrong', then: 'carve-out', carve: opts[k - 1]!.cls });
      }
    }
    if (rt.agreeBlocker()) {
      log(rt.agreeBlocker()!);
      return 4;
    }
    log(AGREE_TEXT);
    const yn = o.yes ? 'y' : await ask('Agree? [y/N] ');
    if (yn !== 'y') return 5;
    const ag = await rt.agree();
    log(`Agreed. hash ${ag.hash}`);

    log('Proving the original meets the spec…');
    const pv = await rt.proveOriginal({ maxAttempts: o.proofAttempts, minutes: o.proofMinutes });
    log(pv.result === 'not-proved' ? (pv.failureLine ?? 'Not proved') : `${pv.result === 'proved' ? 'Proved' : 'Proved (trusting the compiler)'} (${pv.attempts.length} attempt${pv.attempts.length === 1 ? '' : 's'})`);

    log(`Optimizing for ${o.minutes} minutes…`);
    const opt = new Optimizer(rt, { threshold: { kind: 'time-budget', minutes: o.minutes } });
    const why = await opt.run();
    log(`Stopped: ${why}.`);
    for (const c of rt.state.optimize.candidates.filter((x) => x.outcome === 'faster-not-proved')) {
      log(`Candidate ${c.id} is faster but NOT proved (tier ${c.tier}).`);
      if (c.tier === 'verified-to-k' && !o.yes) {
        const a = await ask(`Accept candidate ${c.id} at the Verified-to-k tier (delivery will mark it as not proved)? [y/N] `);
        if (a === 'y') await opt.acceptFasterNotProved(c.id);
      }
    }
    const d = await deliver(rt);
    log(`\nWrote ${d.files.join(', ')} to ${d.dir}`);
    log(d.evidence);
    log('Your source file was not modified. To apply: git apply ' + `${d.dir}/patch.diff`);
    return 0;
  } finally {
    rl?.close();
    await api.close();
  }
}

