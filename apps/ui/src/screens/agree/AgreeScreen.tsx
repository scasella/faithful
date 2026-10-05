/**
 * Agree: the challenge list is the center. Each disagreement between the proposed spec and the user's function is a
 * row (input, spec answer, original answer) to rule by keyboard:
 *   s  the spec is wrong (then revise it, v)
 *   f  my function is wrong, then  x  I will fix it (stops here)   or   c  carve a class of inputs out, picked by
 *      number (1-9) from the server's menu for that input (the server writes the conditions; nobody types one)
 *   j / k  move between unruled challenges     Esc  back one step
 * Carve-outs sit in a band at the top once recorded, permanently. "Agree" (a) stays disabled and says exactly why until
 * every challenge is ruled; it opens the only modal in the UI, which lists the consequences in plain words.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import { blockingJob } from '../../components/ActionButton';
import type { Challenge, SessionState, SpecProposal } from '@faithful/session';
import { formatCount } from '@faithful/core/tiers';
import { useApp } from '../../app/AppContext';
import { ActionButton } from '../../components/ActionButton';
import { CarveOutBand, carveOutsOf } from '../../components/CarveOutBand';
import type { CarveOption } from '../../actions';
import { Code } from '../../components/Code';
import { KeyHint } from '../../components/KeyHint';
import { ModelSaw } from '../../components/ModelSaw';
import { Preconditions, preconditionView } from '../../components/Preconditions';
import { Num } from '../../components/Provenance';
import { OutcomeView } from '../../components/ValueView';
import { callById, paramNames } from '../../lib/facts';
import { inputText, msText } from '../../lib/format';
import { useKeys } from '../../lib/keys';
import { act } from '../../store';
import {
  agreeGate,
  agreeView,
  canRevise,
  carveRuling,
  fixOriginal,
  leanSpan,
  recordedExamples,
  rulingShort,
  rulingWords,
  specWrong,
  type AgreeView,
  type RulingStep,
} from './gate';
import './agree.css';

export const AGREE_LEAD = 'You are agreeing to this spec, these preconditions, these rulings and these carve-outs.';

export function AgreeScreen() {
  const { store, adapter } = useApp();
  const s = store.state.value;
  const v = agreeView(s);
  const gate = agreeGate(s, v);
  const dlg = useRef<HTMLDialogElement>(null);
  const [dlgOpen, setDlgOpen] = useState(false);

  const [picked, setPicked] = useState<string | null>(null);
  const [flow, setFlow] = useState<{ id: string | null; step: RulingStep }>({ id: null, step: 'idle' });
  const active = picked && v.unruled.includes(picked) ? picked : (v.unruled[0] ?? null);
  const step: RulingStep = flow.id === active ? flow.step : 'idle';
  const setStep = (st: RulingStep) => setFlow({ id: active, step: st });

  const moveActive = (d: 1 | -1) => {
    if (!v.unruled.length) return;
    const i = active ? v.unruled.indexOf(active) : -1;
    setPicked(v.unruled[(i + d + v.unruled.length) % v.unruled.length]!);
  };
  useKeys({
    j: v.unruled.length > 1 ? () => moveActive(1) : undefined,
    k: v.unruled.length > 1 ? () => moveActive(-1) : undefined,
    Escape: step !== 'idle' && !store.helpOpen.value ? () => setStep(step === 'carve-out' ? 'function-wrong' : 'idle') : undefined,
  });

  const names = paramNames(s);

  return (
    <div class="stack-l ag">
      <CarveOutBand state={s} />

      {s.agreement && (
        <section class="ag-agreed" aria-labelledby="ag-agreed-h">
          <p class="label" id="ag-agreed-h">
            Agreed
          </p>
          <p class="ag-hashline">
            Agreement hash <code class="ag-hash">{s.agreement.hash}</code>
          </p>
          <p class="muted">
            Agreed at {s.agreement.at}. Everything proved afterwards is proved against this hash. Changing the spec, the preconditions, the rulings or the
            carve-outs invalidates those proofs and the incumbent.
          </p>
        </section>
      )}

      {v.proposal ? (
        <p class="ag-says">
          <span class="label">The spec says</span>
          <span class="ag-says-text">{v.proposal.english}</span>
        </p>
      ) : (
        <p class="muted">No spec has been proposed yet.</p>
      )}

      <section class="ag-challenges stack" aria-labelledby="ag-ch-h">
        <div class="ag-ch-head">
          <h3 id="ag-ch-h">Challenges</h3>
          {v.unruled.length > 1 && (
            <span class="ag-keys">
              <KeyHint keys={['j', 'k']} /> next / previous unruled
            </span>
          )}
        </div>
        <RunLine v={v} />
        {v.challenges.length > 0 && (
          <ol class="ag-ch-list">
            {v.challenges.map((c) => (
              <ChallengeRow
                key={c.id}
                c={c}
                names={names}
                v={v}
                active={c.id === active}
                step={c.id === active ? step : 'idle'}
                setStep={setStep}
                onPick={() => setPicked(c.id)}
                state={s}
              />
            ))}
          </ol>
        )}
      </section>

      {s.agreement ? null : (
        <section class="ag-bar" aria-label="Agree">
          <div class="row">
            <ActionButton
              primary={gate.ok}
              local
              keyName="a"
              disabled={!gate.ok || dlgOpen}
              run={() => {
                dlg.current?.showModal();
                setDlgOpen(true);
              }}
            >
              Agree…
            </ActionButton>
            {v.proposal && !v.specHash ? (
              <ActionButton primary keyName="n" disabled={dlgOpen} run={() => adapter.proposeSpec()}>
                Ask for a new spec
              </ActionButton>
            ) : (
              <ActionButton primary={!gate.ok && gate.next === 'revise'} keyName="v" disabled={!canRevise(s, v) || dlgOpen} run={() => adapter.reviseSpec()}>
                Revise spec
              </ActionButton>
            )}
            <ActionButton primary={!gate.ok && gate.next === 'rerun'} keyName="r" disabled={!v.specHash || dlgOpen} run={() => adapter.rerunChallenge()}>
              Re-run challenge
            </ActionButton>
          </div>
          {!gate.ok && (
            <p class="ag-why" role="status">
              {gate.reason}
            </p>
          )}
        </section>
      )}

      {v.proposal && <SpecAndExamples s={s} v={v} p={v.proposal} />}

      {s.proposals.length > 1 && (
        <details class="ag-history">
          <summary>Earlier proposals ({s.proposals.length - 1})</summary>
          <ol class="ag-hist-list">
            {s.proposals.slice(0, -1).map((p) => (
              <li key={p.id} class="stack">
                <p>
                  <span class="label">{p.kind === 'revision' ? 'Revision' : 'Proposal'}</span> {p.english}
                </p>
                <Code text={p.lean} lang="lean" label={`Spec proposal ${p.id} in Lean`} />
                {!p.validation.ok && <ValidationErrors errors={p.validation.errors} />}
                <ModelSaw call={callById(s, p.callId)} what={`spec proposal ${p.id}`} />
              </li>
            ))}
          </ol>
        </details>
      )}

      {s.invalidations.length > 0 && (
        <section class="ag-inval stack" aria-labelledby="ag-inval-h">
          <h3 id="ag-inval-h">Invalidated agreements</h3>
          <ol class="ag-inval-list">
            {s.invalidations.map((x, i) => (
              <li key={i}>
                <p>{x.reason}</p>
                <p class="muted">
                  {x.at} · was <code class="ag-hash">{x.previousHash || 'unknown hash'}</code>. Proofs and the incumbent pinned to it are history, not current
                  claims.
                </p>
              </li>
            ))}
          </ol>
        </section>
      )}

      {v.proposal && v.specHash && !s.agreement && <AgreeDialog dlg={dlg} onClose={() => setDlgOpen(false)} s={s} v={v} p={v.proposal} specHash={v.specHash} />}
    </div>
  );
}

function RunLine({ v }: { v: AgreeView }) {
  if (!v.proposal) return null;
  if (!v.specHash) return <p class="muted">The challenge cannot run: the latest spec did not type-check.</p>;
  const r = v.lastRun;
  if (!r) return <p class="muted">The challenge has not run against this spec yet.</p>;
  const what = `Challenge run ${r.id} against spec ${v.specHash}, seed ${r.seed}`;
  const filtered = r.inputsTried - r.inputsCompared;
  const tried = <Num what={`${what}: inputs generated before precondition filtering`}>{formatCount(r.inputsTried)}</Num>;
  return (
    <p class="ag-run">
      Run {r.id}: <Num what={`${what}: inputs that met the preconditions and were run on both the spec and your function`}>{formatCount(r.inputsCompared)}</Num> inputs
      compared between the spec and your function{' '}
      {filtered > 0 ? (
        <>
          ({tried} generated; the other <Num what={`${what}: generated inputs that did not meet the preconditions`}>{formatCount(filtered)}</Num> did not meet
          the preconditions)
        </>
      ) : (
        <>(every one of the {tried} generated inputs met the preconditions)</>
      )}
      , in <Num what={`${what}: wall-clock time`}>{msText(r.ms)}</Num>.{' '}
      {r.disagreements.length === 0 ? (
        <b>No disagreement.</b>
      ) : (
        <b>
          They disagree on <Num what={`${what}: inputs where the spec and your function gave different outcomes`}>{formatCount(r.disagreements.length)}</Num>{' '}
          {r.disagreements.length === 1 ? 'input' : 'inputs'}.
        </b>
      )}
    </p>
  );
}

const ORIGIN_WORDS: Record<Challenge['origin'], string> = {
  boundary: 'edge case the translator knows',
  random: 'random input',
};

function ChallengeRow(props: {
  c: Challenge;
  names: string[] | null;
  v: AgreeView;
  active: boolean;
  step: RulingStep;
  setStep(s: RulingStep): void;
  onPick(): void;
  state: SessionState;
}) {
  const { c, names, v, active, step, setStep, onPick, state } = props;
  const r = v.ruled.get(c.id);
  return (
    <li class={`ag-ch${active ? ' on' : ''}${r ? ' ruled' : ''}`} onClick={r || active ? undefined : onPick} aria-current={active ? 'true' : undefined}>
      <div class="ag-cells">
        <div>
          <p class="label">Input</p>
          <span class="val ag-big">{inputText(c.input, names)}</span>
          <span class="ag-origin">{ORIGIN_WORDS[c.origin]}</span>
        </div>
        <div>
          <p class="label">The spec</p>
          <span class="ag-big">
            <OutcomeView o={c.spec} />
          </span>
        </div>
        <div>
          <p class="label">Your function</p>
          <span class="ag-big">
            <OutcomeView o={c.original} />
          </span>
        </div>
      </div>
      {r ? (
        <p class="ag-ruling">
          <span class="label">Ruled</span> {rulingWords(r)}
          {r.note ? <span class="muted"> Note: {r.note}</span> : null}
        </p>
      ) : active ? (
        <RulingControls c={c} step={step} setStep={setStep} state={state} />
      ) : (
        <p class="muted ag-later">
          <button type="button" class="linklike" onClick={onPick}>
            Rule this one
          </button>{' '}
          (or <KeyHint keys={['j', 'k']} />)
        </p>
      )}
    </li>
  );
}

function RulingControls({ c, step, setStep, state }: { c: Challenge; step: RulingStep; setStep(s: RulingStep): void; state: SessionState }) {
  const { adapter } = useApp();
  if (step === 'idle') {
    return (
      <div key="idle" class="ag-rule">
        <p class="ag-q">Who is right on this input?</p>
        <div class="row">
          <ActionButton key="s" keyName="s" run={() => adapter.rule(c.id, specWrong())}>
            The spec is wrong
          </ActionButton>
          <ActionButton key="f" keyName="f" run={() => setStep('function-wrong')}>
            My function is wrong
          </ActionButton>
        </div>
      </div>
    );
  }
  if (step === 'function-wrong') {
    return (
      <div key="fw" class="ag-rule">
        <p class="ag-q">Your function is wrong on this input. Fix it, or carve this class of inputs out of every claim?</p>
        <div class="row">
          <ActionButton key="x" keyName="x" run={() => adapter.rule(c.id, fixOriginal())}>
            I will fix my function
          </ActionButton>
          <ActionButton key="c" keyName="c" run={() => setStep('carve-out')}>
            Carve these inputs out
          </ActionButton>
          <BackButton onBack={() => setStep('idle')} />
        </div>
        <p class="ag-fine">Fixing stops this session: you edit your file and open the function again. A carve-out is shown on every screen, permanently.</p>
      </div>
    );
  }
  return <CarvePicker key="carve" c={c} state={state} onBack={() => setStep('function-wrong')} />;
}

function BackButton({ onBack }: { onBack(): void }) {
  return (
    <button type="button" class="btn" onClick={onBack} aria-keyshortcuts="Escape">
      Back <KeyHint keys="Esc" />
    </button>
  );
}

function CarvePicker({ c, state, onBack }: { c: Challenge; state: SessionState; onBack(): void }) {
  const { adapter } = useApp();
  const [options, setOptions] = useState<CarveOption[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const names = paramNames(state);
  useEffect(() => {
    let live = true;
    adapter.carveOptions(c.id).then(
      (o) => live && setOptions(o),
      (e: Error) => live && setErr(e.message || String(e)),
    );
    return () => {
      live = false;
    };
  }, [adapter, c.id]);
  const shown = (options ?? []).slice(0, 9);
  return (
    <div class="ag-rule stack">
      <p class="ag-q">
        Which inputs should be carved out of every claim? These are the classes that contain {inputText(c.input, names)}; pick one by its number.
      </p>
      {!options && !err && (
        <p class="muted" role="status">
          Asking the server which classes it can carve out…
        </p>
      )}
      {err && (
        <p class="err-inline" role="alert">
          {err}
        </p>
      )}
      {shown.length > 0 && (
        <ol class="ag-carve-menu">
          {shown.map((o, i) => (
            <li key={`${o.cls.kind}:${o.cls.param}`}>
              <ActionButton keyName={String(i + 1)} run={() => adapter.rule(c.id, carveRuling(o.cls))}>
                Exclude {o.excluded}
              </ActionButton>
            </li>
          ))}
        </ol>
      )}
      {options && options.length > shown.length && (
        <p class="muted">The server offered {options.length} classes; the first nine are listed (keys 1–9).</p>
      )}
      <div class="row">
        <BackButton onBack={onBack} />
      </div>
      <p class="ag-fine">
        The server writes the Lean and TypeScript conditions for the class you pick; neither you nor the model writes them. Recording a carve-out re-runs the
        challenge. A carve-out cannot be removed silently: changing it invalidates the agreement.
      </p>
    </div>
  );
}

function ValidationErrors({ errors }: { errors: string[] }) {
  return (
    <div class="ag-invalid">
      <p>The server did not accept this spec. Its validation errors, verbatim:</p>
      <pre tabIndex={0}>{errors.join('\n')}</pre>
    </div>
  );
}

function SpecAndExamples({ s, v, p }: { s: SessionState; v: AgreeView; p: SpecProposal }) {
  const [hover, setHover] = useState<number | null>(null);
  const spans = p.lines.map((l) => leanSpan(p.lean, l.lean));
  const names = paramNames(s);
  const examples = recordedExamples(v);
  const r = v.lastRun;
  const agreedOn = r ? r.inputsCompared - r.disagreements.length : null;
  return (
    <div class="ag-cols">
      <section class="ag-spec stack" aria-labelledby="ag-spec-h">
        <h3 id="ag-spec-h">{p.kind === 'revision' ? 'The spec (revised)' : 'The spec'}</h3>
        <ol class="ag-lines" aria-label="The spec, line by line">
          {p.lines.map((l, i) => (
            <li
              key={i}
              tabIndex={0}
              class={hover === i ? 'on' : undefined}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
            >
              <span>{l.english}</span>
              {spans[i] === null && <code class="ag-line-lean">{l.lean}</code>}
            </li>
          ))}
        </ol>
        <p class="ag-fine">Hover or focus a line to mark its Lean below.</p>
        <Code text={p.lean} lang="lean" mark={hover !== null ? spans[hover] : null} label="The spec in Lean" />
        <h3 class="ag-sub">Preconditions</h3>
        <p class="ag-fine">The spec is agreed only for inputs that meet these. They are the sentences the Translate screen showed.</p>
        <Preconditions view={preconditionView(s)} />
        {p.properties.length > 0 && (
          <details class="ag-props">
            <summary>Properties the spec states ({p.properties.length})</summary>
            <ul>
              {p.properties.map((x) => (
                <li key={x.name}>
                  <p>{x.english}</p>
                  <code>{x.lean}</code>
                </li>
              ))}
            </ul>
          </details>
        )}
        <p class="ag-fine">
          The server refuses a spec that merely calls the Lean model of your function (it would agree with the function by construction): the spec must state
          on its own what the function should compute. When it refuses a spec, its validation errors are shown here verbatim.
        </p>
        {!p.validation.ok && <ValidationErrors errors={p.validation.errors} />}
        <ModelSaw call={callById(s, p.callId)} what={`${p.kind === 'revision' ? 'spec revision' : 'spec proposal'} ${p.id}`} />
      </section>

      <section class="ag-examples stack" aria-labelledby="ag-ex-h">
        <h3 id="ag-ex-h">Examples</h3>
        <p class="ag-fine">Every input on which the spec and your function were seen to differ, across all challenge runs against this spec.</p>
        {examples.length ? (
          <table class="ag-table">
            <thead>
              <tr>
                <th scope="col">Run</th>
                <th scope="col">Input</th>
                <th scope="col">The spec</th>
                <th scope="col">Your function</th>
                <th scope="col">Ruling</th>
              </tr>
            </thead>
            <tbody>
              {examples.map(({ c, runId }) => {
                const ru = v.ruled.get(c.id);
                return (
                  <tr key={c.id}>
                    <td data-label="Run">{runId}</td>
                    <td data-label="Input">
                      <span class="val">{inputText(c.input, names)}</span>
                    </td>
                    <td data-label="The spec">
                      <OutcomeView o={c.spec} />
                    </td>
                    <td data-label="Your function">
                      <OutcomeView o={c.original} />
                    </td>
                    <td data-label="Ruling">{ru ? rulingShort(ru) : <span class="muted">not ruled</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <p class="muted">No disagreement has been recorded against this spec.</p>
        )}
        {r && agreedOn !== null && agreedOn > 0 && (
          <p class="ag-fine">
            In run{' '}
            {r.id}, the latest, {r.disagreements.length === 0 ? 'all ' : 'the other '}
            <Num what={`Challenge run ${r.id}: inputs compared minus inputs that disagreed`}>{formatCount(agreedOn)}</Num> compared inputs agreed. Inputs that
            agreed are not recorded, so they are not listed.
          </p>
        )}
      </section>
    </div>
  );
}

function AgreeDialog({
  dlg,
  onClose,
  s,
  v,
  p,
  specHash,
}: {
  dlg: { current: HTMLDialogElement | null };
  onClose(): void;
  s: SessionState; v: AgreeView; p: SpecProposal; specHash: string }) {
  const { store, adapter } = useApp();
  const names = paramNames(s);
  const byId = new Map(recordedExamples(v).map((e) => [e.c.id, e.c]));
  const rulings = s.rulings.filter((r) => r.specHash === specHash);
  const carves = carveOutsOf(s);
  return (
    <dialog
      ref={dlg}
      onClose={onClose}
      // The page's single-key bindings stay outside the modal: keys pressed in it never reach the window listeners.
      onKeyDown={(e) => e.stopPropagation()}
      class="confirm ag-dialog" aria-labelledby="ag-dlg-title" aria-describedby="ag-dlg-lead">
      <h2 id="ag-dlg-title">Agree to this spec?</h2>
      <p id="ag-dlg-lead" class="ag-dlg-lead">
        {AGREE_LEAD}
      </p>
      <div class="ag-dlg-body">
        <h3>The spec</h3>
        <p>{p.english}</p>
        {p.lines.length > 0 && (
          <ol class="ag-dlg-lines">
            {p.lines.map((l, i) => (
              <li key={i}>{l.english}</li>
            ))}
          </ol>
        )}
        <h3>Preconditions</h3>
        <Preconditions view={preconditionView(s)} compact />
        {s.throwChoice && (
          <p>Throws: {s.throwChoice === 'precondition' ? 'treated as a precondition.' : 'modelled as a spec case.'}</p>
        )}
        <h3>Rulings</h3>
        {rulings.length ? (
          <ul>
            {rulings.map((r) => {
              const c = byId.get(r.challengeId);
              return (
                <li key={r.challengeId}>
                  {c ? <span class="val">{inputText(c.input, names)}</span> : <code>{r.challengeId}</code>}: {rulingWords(r, true)}
                </li>
              );
            })}
          </ul>
        ) : (
          <p>None: the challenge found no disagreement.</p>
        )}
        <h3>Carve-outs</h3>
        {carves.length ? (
          <ul>
            {carves.map((c) => (
              <li key={c.id}>{c.words}</li>
            ))}
          </ul>
        ) : (
          <p>None.</p>
        )}
        <p class="ag-dlg-hash">
          Everything proved afterwards is proved against the agreement hash computed over exactly these items when you agree. The spec in it has hash{' '}
          <code class="ag-hash">{specHash}</code>. Changing any of them invalidates the proofs and the incumbent.
        </p>
      </div>
      <form method="dialog" class="row ag-dlg-actions">
        <button class="btn" value="cancel">
          Cancel <KeyHint keys="Esc" />
        </button>
        <button
          class="btn primary"
          value="agree"
          autofocus
          disabled={adapter.readOnly || blockingJob(store) !== null}
          title={adapter.readOnly ? 'Replay: nothing runs, actions are disabled' : blockingJob(store) !== null ? 'Waiting: another job is running' : undefined}
          onClick={() => void act(store, () => adapter.agree())}
        >
          Agree <KeyHint keys="Enter" />
        </button>
      </form>
    </dialog>
  );
}
