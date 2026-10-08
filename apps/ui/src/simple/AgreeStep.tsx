/**
 * Step 3, Agree. What happens next is decided by agreeGate (screens/agree/gate.ts), never re-derived here:
 *   no proposal        "Propose a spec"
 *   unruled            ONE disagreement at a time: the input, what the spec says, what your function returns, and three
 *                      answers (the spec is wrong / carve these inputs out / my function is wrong, I'll fix it)
 *   revise / rerun / propose / reopen   the gate's reason in one sentence and the one action that resolves it
 *   ok                 AGREE_LEAD with the complete list the full screen's confirmation shows, and one "Agree" button:
 *                      this screen is that confirmation (same content, nothing hidden), so there is no second modal.
 * The coverage lines (carve-outs exclude X of Y, spec faults not compared, the warning at half or more) are the ones the
 * full Agree screen shows, from coverageView.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Challenge, SessionState, SpecProposal } from '@faithful/session';
import { useApp } from '../app/AppContext';
import type { CarveOption } from '../actions';
import { carveOutsOf } from '../components/CarveOutBand';
import { Code } from '../components/Code';
import { Preconditions, preconditionView } from '../components/Preconditions';
import { OutcomeView } from '../components/ValueView';
import { paramNames } from '../lib/facts';
import { inputText } from '../lib/format';
import { AGREE_LEAD } from '../screens/agree/AgreeScreen';
import { agreeGate, agreeView, canRevise, carveRuling, coverageView, fixOriginal, isSpecFault, recordedExamples, rulingWords, specWrong, type AgreeView } from '../screens/agree/gate';
import { proposeBlocker } from '../screens/translate/TranslateScreen';
import { Actions, Details, H1_ID, SButton, StepHead } from './parts';

export function AgreeStep({ onPickAnother }: { onPickAnother(): void }) {
  const { store, adapter } = useApp();
  const s = store.state.value;
  const v = agreeView(s);
  const gate = agreeGate(s, v);
  const running = s.job.running !== null;

  if (!v.proposal) {
    const blocker = proposeBlocker(s);
    return (
      <section class="s-step">
        <StepHead lead="The model writes down what the function should compute. Faithful then searches for inputs where that spec and your function disagree, and you decide who is right.">
          Agree on what <code>{s.fn}</code> should do
        </StepHead>
        <Actions>
          <SButton primary disabled={blocker !== null} why={blocker ?? undefined} run={() => adapter.proposeSpec()}>
            Propose a spec
          </SButton>
        </Actions>
        <Details summary="Preconditions">
          <Preconditions view={preconditionView(s)} compact />
        </Details>
      </section>
    );
  }

  if (!gate.ok && gate.next === 'rule') {
    const open = v.challenges.filter((c) => v.unruled.includes(c.id));
    return <Disagreement key={open[0]!.id} s={s} v={v} c={open[0]!} index={v.challenges.length - open.length + 1} total={v.challenges.length} />;
  }

  if (gate.ok) return <Confirm s={s} v={v} p={v.proposal} specHash={gate.specHash} />;

  // One sentence (the gate's reason) and the one action that resolves it.
  const p = v.proposal;
  const next = gate.next;
  const title =
    next === 'revise' ? 'Revise the spec' : next === 'reopen' ? 'Fix your function first' : next === 'propose' ? 'This spec cannot be agreed' : s.agreement ? 'Agreed' : 'Check the spec again';
  return (
    <section class="s-step">
      <StepHead lead={gate.reason}>{title}</StepHead>
      <Actions>
        {next === 'revise' && (
          <SButton primary disabled={!canRevise(s, v)} run={() => adapter.reviseSpec()}>
            Revise the spec
          </SButton>
        )}
        {next === 'propose' && (
          <SButton primary run={() => adapter.proposeSpec()}>
            Ask for a new spec
          </SButton>
        )}
        {next === 'rerun' && !running && (
          <SButton primary disabled={!v.specHash} run={() => adapter.rerunChallenge()}>
            Run the challenge again
          </SButton>
        )}
        {next === 'reopen' && (
          <SButton primary local run={onPickAnother}>
            Pick the function again
          </SButton>
        )}
      </Actions>
      <Coverage s={s} v={v} />
      <SpecDetails p={p} />
    </section>
  );
}

function Disagreement({ s, v, c, index, total }: { s: SessionState; v: AgreeView; c: Challenge; index: number; total: number }) {
  const { adapter } = useApp();
  const [carving, setCarving] = useState(false);
  const names = paramNames(s);
  return (
    <section class="s-step">
      <StepHead lead={<>The spec says: {v.proposal!.english}</>}>Who is right on this input?</StepHead>
      <p class="s-count">
        Disagreement {index} of {total}
      </p>
      <dl class="s-cx">
        <div>
          <dt>Input</dt>
          <dd class="val">{inputText(c.input, names)}</dd>
        </div>
        <div>
          <dt>The spec says</dt>
          <dd>
            <OutcomeView o={c.spec} />
          </dd>
        </div>
        <div>
          <dt>Your function returns</dt>
          <dd>
            <OutcomeView o={c.original} />
          </dd>
        </div>
      </dl>
      {isSpecFault(c) && (
        <p class="s-body">
          Lean produced no value for the spec on this input: an evaluation fault of the spec, not evidence that your function is wrong.
        </p>
      )}
      {carving ? (
        <CarveMenu
          s={s}
          c={c}
          onBack={() => {
            setCarving(false);
            // "Back" disappears with the menu: return focus to the question
            requestAnimationFrame(() => document.getElementById(H1_ID)?.focus({ preventScroll: true }));
          }}
        />
      ) : (
        <Actions column note="A carve-out removes a class of inputs from every claim and is shown next to every label from now on.">
          <SButton run={() => adapter.rule(c.id, specWrong())}>The spec is wrong</SButton>
          <SButton local run={() => setCarving(true)}>
            Carve these inputs out
          </SButton>
          <SButton run={() => adapter.rule(c.id, fixOriginal())}>My function is wrong — I'll fix it</SButton>
        </Actions>
      )}
      <Coverage s={s} v={v} />
      <SpecDetails p={v.proposal!} />
    </section>
  );
}

/** The full view's CarvePicker lists the first nine (keys 1–9); so does this menu, and it says so. */
const CARVE_SHOWN = 9;

function CarveMenu({ s, c, onBack }: { s: SessionState; c: Challenge; onBack(): void }) {
  const { adapter } = useApp();
  const [options, setOptions] = useState<CarveOption[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // Opening the menu removes the button that had focus: move focus to the menu's question.
  const lead = useRef<HTMLParagraphElement>(null);
  useEffect(() => lead.current?.focus({ preventScroll: true }), []);
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
  return (
    <div class="s-carve-menu">
      <p class="s-body s-focus" ref={lead} tabIndex={-1}>Which inputs should be left out of every claim? These classes contain {inputText(c.input, paramNames(s))}.</p>
      {!options && !err && (
        <p class="s-note" role="status">
          Asking the server which classes it can carve out…
        </p>
      )}
      {err && (
        <p class="s-err" role="alert">
          {err}
        </p>
      )}
      {options && options.length > 0 && (
        <ul class="s-options">
          {options.slice(0, CARVE_SHOWN).map((o) => (
            <li key={`${o.cls.kind}:${o.cls.param}`}>
              <SButton run={() => adapter.rule(c.id, carveRuling(o.cls))}>Exclude {o.excluded}</SButton>
            </li>
          ))}
        </ul>
      )}
      {options && options.length > CARVE_SHOWN && (
        <p class="s-note">
          The server offered {options.length} classes; the first {CARVE_SHOWN === 9 ? 'nine' : CARVE_SHOWN} are listed (the full view lists the same ones).
        </p>
      )}
      <Actions note="The server writes the conditions for the class you pick; recording it re-runs the challenge.">
        <SButton local run={onBack}>
          Back
        </SButton>
      </Actions>
    </div>
  );
}

/** The confirmation, inline: everything the full screen's dialog lists, then one button. */
function Confirm({ s, v, p, specHash }: { s: SessionState; v: AgreeView; p: SpecProposal; specHash: string }) {
  const { adapter } = useApp();
  const names = paramNames(s);
  const byId = new Map(recordedExamples(v).map((e) => [e.c.id, e.c]));
  const rulings = s.rulings.filter((r) => r.specHash === specHash);
  const carves = carveOutsOf(s);
  return (
    <section class="s-step">
      <StepHead lead={AGREE_LEAD}>Agree to this spec?</StepHead>
      <div class="s-list-block">
        <h2 class="s-h2">The spec</h2>
        <p>{p.english}</p>
        {p.lines.length > 0 && (
          <ol class="s-lines">
            {p.lines.map((l, i) => (
              <li key={i}>{l.english}</li>
            ))}
          </ol>
        )}
      </div>
      <div class="s-list-block">
        <h2 class="s-h2">Preconditions</h2>
        <Preconditions view={preconditionView(s)} compact />
        {s.throwChoice && <p class="s-note">Throws: {s.throwChoice === 'precondition' ? 'treated as a precondition.' : 'modelled as a spec case.'}</p>}
      </div>
      <div class="s-list-block">
        <h2 class="s-h2">Your rulings</h2>
        {rulings.length ? (
          <ul class="s-plain">
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
      </div>
      <div class="s-list-block">
        <h2 class="s-h2">Carve-outs</h2>
        {carves.length ? (
          <ul class="s-carve-items">
            {carves.map((c) => (
              <li key={c.id}>{c.words}</li>
            ))}
          </ul>
        ) : (
          <p>None.</p>
        )}
      </div>
      <Coverage s={s} v={v} />
      <p class="s-note s-hash">
        Everything proved afterwards is proved against the agreement hash computed over exactly these items when you agree. The spec in it has hash{' '}
        <code>{specHash}</code>. Changing any of them invalidates the proofs and the incumbent.
      </p>
      <Actions>
        <SButton primary run={() => adapter.agree()}>
          Agree
        </SButton>
      </Actions>
      <SpecDetails p={p} />
    </section>
  );
}

/** The coverage lines of the full Agree screen (coverageView), shown whenever they say something. */
function Coverage({ s, v }: { s: SessionState; v: AgreeView }) {
  const carves = carveOutsOf(s);
  const cov = coverageView(v.lastRun, carves.length);
  if (!cov.carvedLine && !cov.specFaultLine) return null;
  return (
    <div class={`s-coverage${cov.minority ? ' warn' : ''}`}>
      {cov.carvedLine && <p>{cov.carvedLine}</p>}
      {cov.minority && (
        <p role="note">
          <b>The carve-outs exclude at least half of the generated inputs:</b> any proof will cover at most half of what the challenge generated, and every label
          shown later is limited by them.
        </p>
      )}
      {cov.specFaultLine && <p>{cov.specFaultLine} They are not counted as disagreements.</p>}
    </div>
  );
}

function SpecDetails({ p }: { p: SpecProposal }) {
  return (
    <Details summary="Show the Lean">
      <Code text={p.lean} lang="lean" label="The spec in Lean" />
      {!p.validation.ok && (
        <>
          <p>The server did not accept this spec. Its validation errors, verbatim:</p>
          <pre class="s-pre" tabIndex={0}>
            {p.validation.errors.join('\n')}
          </pre>
        </>
      )}
    </Details>
  );
}
