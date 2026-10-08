/**
 * "Check it in your browser": the first stages of the candidate funnel, run live on this page against the recorded
 * original (src/live/funnel.ts). Everything shown here is labelled "ran in your browser just now" with its timing.
 * The live machinery (TypeScript compiler, translator, sandbox, Z3) is loaded on first use.
 */
import { useState } from 'preact/hooks';
import { Code } from '@ui/components/Code';
import { OutcomeView, ValueView } from '@ui/components/ValueView';
import { msText } from '@ui/lib/format';
import type { LiveRun, LiveStage } from '../live/funnel';
import { EXAMPLES } from './examples';
import type { LiveInputs } from './recording';

type Source = {
  key: string;
  id: number;
  title: string;
  origin: 'recorded' | 'hand-written' | 'yours';
  note: string;
  source: string;
  recordedSmt?: { summary: string; date: string; z3: string };
};

const STAGE_NAME: Record<LiveStage['stage'], string> = {
  translate: 'Translate (original)',
  compile: 'Compile',
  purity: 'Purity',
  differential: 'Differential',
  smt: 'SMT (Z3)',
};
const GLYPH: Record<LiveStage['status'], string> = { running: '…', pass: '✓', fail: '✕', skipped: '–', unavailable: '–' };
const WORD: Record<LiveStage['status'], string> = { running: 'running', pass: 'passed', fail: 'failed', skipped: 'no verdict', unavailable: 'not available here' };

function shortBrowser(ua: string): string {
  const m = /(Firefox|Edg|Chrome|Version)\/(\d+)/.exec(ua);
  if (!m) return 'this browser';
  const name = m[1] === 'Version' ? 'Safari' : m[1] === 'Edg' ? 'Edge' : m[1]!;
  return `${name} ${m[2]}`;
}

export function RunView({ run, params }: { run: LiveRun; params: string[] }) {
  const cx = run.counterexample;
  const running = run.stages.some((s) => s.status === 'running');
  return (
    <div class="live-run" data-testid="live-run" data-state={running ? 'running' : run.rejection ? 'rejected' : run.passed ? 'passed' : 'stopped'}>
      <p class="live-label">
        <span class="badge live">ran in your browser just now</span> {new Date(run.at).toLocaleString()} · {shortBrowser(run.userAgent)} · total {msText(run.totalMs)}
      </p>
      <ol class="live-stages">
        {run.stages.map((s) => (
          <li key={s.stage} class={s.status} data-stage={s.stage} data-status={s.status}>
            <span class="st">
              <span aria-hidden="true">{GLYPH[s.status]} </span>
              {STAGE_NAME[s.stage]}
              <span class="sr-only">: {WORD[s.status]}</span>
            </span>
            <span class="ms">{s.status === 'running' ? 'running…' : s.status === 'unavailable' ? 'not run' : msText(s.ms)}</span>
            <span class="sum">{s.summary}</span>
            {s.facts && s.facts.length > 0 && (
              <ul class="facts">
                {s.facts.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ol>
      {cx && (
        <div class="catch live-catch" role="group" aria-label="Counterexample found just now" data-testid="live-counterexample">
          <p class="catch-kicker">Caught in your browser · {cx.source === 'smt' ? 'Z3 found this input' : 'a generated input'}</p>
          <h4>The candidate differs from the original</h4>
          <div class="catch-cx">
            <div>
              <p class="label">Input</p>
              <p class="v">
                {cx.input.map((v, i) => (
                  <span key={i}>
                    {i > 0 && ', '}
                    {params[i] && <span class="val">{params[i]} = </span>}
                    <ValueView v={v} />
                  </span>
                ))}
              </p>
            </div>
            <div class="orig">
              <p class="label">Original returns</p>
              <p class="v">
                <OutcomeView o={cx.original} />
              </p>
            </div>
            <div class="cand">
              <p class="label">Candidate returns</p>
              <p class="v">
                <OutcomeView o={cx.candidate} />
              </p>
            </div>
          </div>
        </div>
      )}
      {!cx && run.rejection && (
        <p class="err-inline" role="status">
          Rejected at {run.rejection.stage}: {run.rejection.reason}
        </p>
      )}
      {!running && !run.rejection && !run.passed && (
        <p class="muted" role="status">
          No check rejected this candidate, but not every check gave a verdict (see above). The Lean proof and the benchmark do not run here.
        </p>
      )}
      {run.passed && (
        <p class="muted" role="status">
          Passed every check that runs here. The tool would go on to a Lean proof against the agreed spec and a benchmark;
          neither runs in a browser, so this candidate has not been proved or timed here.
        </p>
      )}
    </div>
  );
}

function CandidateRow({ li, c }: { li: LiveInputs; c: Source }) {
  const [run, setRun] = useState<LiveRun | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState(c.source);
  const params = li.translation?.params.map((p) => p.name) ?? [];
  const go = async () => {
    setBusy(true);
    setErr(null);
    setRun(null);
    try {
      const { runFunnel } = await import('../live/funnel');
      const r = await runFunnel(li, c.origin === 'yours' ? text : c.source, { id: c.id, onUpdate: setRun, recordedSmt: c.recordedSmt });
      setRun(r);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <article class="live-cand" data-testid={`live-cand-${c.key}`}>
      <h3>{c.title}</h3>
      <p class="muted">
        <span class={`badge ${c.origin}`}>{c.origin === 'recorded' ? 'from the recording' : c.origin === 'hand-written' ? 'hand-written for this page' : 'your edit'}</span> {c.note}
      </p>
      {c.origin === 'yours' ? (
        <textarea class="live-edit" aria-label="Your candidate (TypeScript)" spellcheck={false} value={text} rows={Math.min(24, text.split('\n').length + 1)} onInput={(e) => setText((e.target as HTMLTextAreaElement).value)} />
      ) : (
        <details>
          <summary>Candidate source</summary>
          <Code text={c.source} lang="ts" label={`Source of ${c.title}`} />
        </details>
      )}
      <p>
        <button type="button" class="btn primary" disabled={busy} onClick={go} data-testid={`run-${c.key}`}>
          {busy ? 'Running…' : run ? 'Run again' : 'Run the checks in your browser'}
        </button>
      </p>
      {err && (
        <p class="err-inline" role="alert">
          {err}
        </p>
      )}
      {run && <RunView run={run} params={params} />}
    </article>
  );
}

export function LivePanel({ li }: { li: LiveInputs }) {
  if (!li.translation) {
    return (
      <section id="live" class="panel" aria-labelledby="live-h">
        <h2 id="live-h">Check it in your browser</h2>
        <p class="muted">This recording has no successful translation, so there is no model to compare candidates against.</p>
      </section>
    );
  }
  const recorded: Source[] = li.candidates.map((c) => ({
    key: `rec-${c.id}`,
    id: c.id,
    title: `Candidate ${c.id} (round ${c.round})`,
    origin: 'recorded',
    note: `Proposed by the model in the recorded session; recorded outcome: ${c.outcome}${c.rejection ? `, rejected at ${c.rejection.stage}` : ''} (replayed). Same input seed as the recording.`,
    source: c.source,
    recordedSmt: (() => {
      const st = c.stages.find((x) => x.stage === 'smt');
      return st ? { summary: st.summary, date: li.recordedAt.slice(0, 10), z3: li.z3 } : undefined;
    })(),
  }));
  const examples: Source[] = (EXAMPLES[li.fnName] ?? []).map((x, i) => ({ key: x.key, id: 101 + i, title: x.title, origin: 'hand-written', note: `Not from the recording and not written by a model; ${x.intent}.`, source: x.source }));
  const yours: Source = {
    key: 'yours',
    id: 199,
    title: 'Your own candidate',
    origin: 'yours',
    note: 'Starts as the original; edit it and run the same checks.',
    source: li.translation.plainTs ?? li.translation.source.text,
  };
  return (
    <section id="live" class="panel" aria-labelledby="live-h" data-testid="live-panel">
      <h2 id="live-h">Check it in your browser</h2>
      <p>
        These checks run on this page, now, against the recorded original: the translator, the strict TypeScript compile gate,
        the purity sandbox (a Web Worker with the tool’s purity mask), the differential test on inputs generated under the
        agreed preconditions, and, when this browser allows it, Z3 compiled to WebAssembly. The Lean proof and the benchmark
        do not run here.
      </p>
      {recorded.length === 0 && <p class="muted">This recording has no optimization candidates (it stops after the proof stage).</p>}
      {[...recorded, ...examples, yours].map((c) => (
        <CandidateRow key={c.key} li={li} c={c} />
      ))}
    </section>
  );
}
