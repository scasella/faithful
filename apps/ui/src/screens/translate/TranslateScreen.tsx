/**
 * Translate: what the deterministic translator made of the function.
 *   translated: preconditions in plain words (the same list the Agree screen shows), translator notes, the throw sites
 *               with the choice "precondition" vs "spec case", and the Lean model (collapsed).
 *   refused:    the translator's reason, the refusal code, the exact source span marked, what still runs, and the offer
 *               to optimize with the Tested tier only (threshold, opt-in special values, key 't'); when the server's
 *               preflight says the Tested tier can never run it (its file imports another module, say), that reason and
 *               only the way back to choosing another function.
 * Keys: 'p' / 'c' throw choice, 'n' propose a spec; refused: '1' / '2' threshold kind, 'i' special values, 't' start.
 */
import { useState } from 'preact/hooks';
import type { SessionState } from '@faithful/session';
import type { Refusal, Translation } from '@faithful/translate';
import { TIER_LABEL } from '@faithful/core/tiers';
import { useApp } from '../../app/AppContext';
import { Code } from '../../components/Code';
import { InlineText } from '../../components/InlineText';
import { ActionButton } from '../../components/ActionButton';
import { Preconditions, preconditionView } from '../../components/Preconditions';
import { KeyHint } from '../../components/KeyHint';
import { useKeys } from '../../lib/keys';
import { ThresholdChoice } from '../optimize/ThresholdChoice';
import { REFUSAL_TITLE, lineExcerpt, tyWords } from './refusal';
import { testedLoadFailed, useTestedBlock } from './testedCheck';
import './translate.css';

export function TranslateScreen() {
  const { store } = useApp();
  const s = store.state.value;
  const t = s.translation;
  if (!t) {
    return s.fn ? (
      <p class="muted" role="status">
        Translating <code>{s.fn}</code>. The translator is deterministic code; no model is called.
      </p>
    ) : (
      <p class="muted">Choose a function first.</p>
    );
  }
  return t.ok ? <Translated s={s} v={t.value} /> : <Refused s={s} r={t.refusal} />;
}

/** Why "Propose a spec" is unavailable, or null when it is available. */
export function proposeBlocker(s: SessionState): string | null {
  const t = s.translation;
  if (!t || !t.ok) return 'There is no Lean model to write a spec against.';
  if (s.proposals.length) return 'A spec has already been proposed. It is on the Agree screen.';
  if (t.value.canThrow && s.throwChoice === null) return 'Choose how to treat the throw first (p or c).';
  return null;
}

export const THROW_CHOICE_WORDS = {
  precondition:
    'Treat as a precondition: inputs on which the function throws are excluded. Every claim then covers only inputs where it returns normally, and "does not throw" is added to the preconditions.',
  'spec-case':
    'Model as a spec case: the spec must say which inputs throw and with which message. A throw is then compared like a return value: same inputs, same message.',
} as const;

function Translated({ s, v }: { s: SessionState; v: Translation }) {
  const { adapter } = useApp();
  const blocker = proposeBlocker(s);
  const model = s.toolchain?.codex.model;
  const choiceLocked = s.proposals.length > 0 || s.agreement !== null;

  return (
    <div class="stack-l tr">
      <section class="stack">
        <p class="tr-lead">
          <code>{v.fnName}</code> is inside the verifiable subset. The translator, which is deterministic code, produced a Lean model of it. No model call
          was involved.
        </p>
        <p class="tr-sig">
          <code>
            {v.fnName}({v.params.map((p) => `${p.name}: ${tyWords(p.ty)}`).join(', ')}) → {tyWords(v.ret)}
            {v.canThrow ? ' or a throw' : ''}
          </code>
        </p>
      </section>

      <section class="stack" aria-labelledby="tr-pre">
        <h3 id="tr-pre">Preconditions</h3>
        <p class="muted">Every claim about this function covers only inputs that meet these. The Agree screen shows the same list.</p>
        <Preconditions view={preconditionView(s)} />
      </section>

      {v.canThrow && (
        <section class="stack" aria-labelledby="tr-throw">
          <h3 id="tr-throw">This function can throw</h3>
          <ul class="tr-sites">
            {v.throwSites.map((site, i) => {
              const ex = lineExcerpt(v.source.text, site.span);
              return (
                <li key={i} class="stack">
                  <p>
                    Throws <code>{JSON.stringify(site.message)}</code>{' '}
                    <span class="muted">
                      at line {site.span.line}, column {site.span.column}
                    </span>
                  </p>
                  <Code text={ex.text} lang="ts" mark={ex.mark} from={ex.from} label={`Throw site ${i + 1}`} />
                </li>
              );
            })}
          </ul>
          <div class="tr-choices" role="group" aria-label="How to treat the throw">
            {(['precondition', 'spec-case'] as const).map((c) => (
              <div key={c} class={`tr-choice${s.throwChoice === c ? ' on' : ''}`}>
                <p>{THROW_CHOICE_WORDS[c]}</p>
                {s.throwChoice === c ? (
                  <p class="tr-chosen">Chosen.</p>
                ) : (
                  <ActionButton keyName={c === 'precondition' ? 'p' : 'c'} disabled={choiceLocked} run={() => adapter.chooseThrow(c)}>
                    {c === 'precondition' ? 'Treat as a precondition' : 'Model as a spec case'}
                  </ActionButton>
                )}
              </div>
            ))}
          </div>
          {choiceLocked && <p class="muted">The choice was recorded before the spec was proposed and is part of what is agreed.</p>}
        </section>
      )}

      <section class="stack" aria-labelledby="tr-notes">
        <h3 id="tr-notes">Translator notes</h3>
        {v.notes.length ? (
          <ul class="tr-notes">
            {v.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        ) : (
          <p class="muted">The translator recorded no documented semantic gaps for this function.</p>
        )}
      </section>

      <details class="tr-model">
        <summary>
          Lean model <span class="muted">· {v.lean.names.original}</span>
        </summary>
        <div class="stack">
          <p class="muted">
            Produced by the fixed translator (docs/TRANSLATOR.md). Model hash <code class="tr-hash">{v.lean.hash}</code>
          </p>
          <Code text={v.lean.source} lang="lean" label="Lean model" />
        </div>
      </details>

      <section class="stack tr-next">
        <div class="row">
          <ActionButton primary keyName="n" disabled={blocker !== null} run={() => adapter.proposeSpec()}>
            Propose a spec
          </ActionButton>
        </div>
        {blocker ? (
          <p class="tr-why">{blocker}</p>
        ) : (
          <p class="muted">
            This asks {model ?? 'the model'} to write a spec of what the function is meant to compute. The prompt is shown verbatim under the proposal.
          </p>
        )}
      </section>
    </div>
  );
}

function Refused({ s, r }: { s: SessionState; r: Refusal }) {
  const failed = s.job.lastError?.job === 'tested' && !s.job.running;
  const preflight = useTestedBlock(!s.tested || failed, s);
  // never: the Tested tier cannot run this function at all (the preflight says so, or a run failed loading the original)
  const never = (s.tested && failed ? testedLoadFailed(s) : null) ?? preflight;
  return (
    <div class="stack-l tr">
      <section class="stack">
        <p class="label">Outside the verifiable subset</p>
        <h3 class="tr-refused-title">{REFUSAL_TITLE[r.code]}</h3>
        <p class="tr-reason">
          <InlineText text={r.reason} />
        </p>
        <p class="muted">
          Refusal code <code>{r.code}</code> · line {r.span.line}, column {r.span.column}
        </p>
      </section>
      <Code
        text={s.source}
        lang="ts"
        mark={r.span}
        label={`Source of ${s.fn}, refused part marked`}
        caption={`Marked: the exact part the translator refused (line ${r.span.line}, column ${r.span.column}).`}
      />
      <section class="tr-still panel quiet stack">
        <h3>What still runs</h3>
        {never ? (
          <p>Nothing here: the {TIER_LABEL.tested} tier runs a function in an isolated sandbox, and this one cannot run there (below).</p>
        ) : (
          <p>
            The {TIER_LABEL.tested} tier: differential testing of a candidate against your original on generated inputs, and mutation testing (broken
            copies the inputs must catch).
          </p>
        )}
        <p>
          The proof tier is not available for this function. There is no Lean model of it, so no spec can be agreed against a model and nothing can be
          checked by Lean or Z3. No claim stronger than {TIER_LABEL.tested} will be made.
        </p>
        <p class="muted">A refusal is a finding, not a failure. The subset is not widened to admit a function.</p>
      </section>
      <TestedStart s={s} never={never} />
    </div>
  );
}

/** Words for the opt-in special values (NaN, Infinity, -Infinity, -0) of the Tested-only generator. */
export const SPECIALS_WORDS =
  'Also generate NaN, Infinity, -Infinity and -0 as inputs. Leave this off if your function is never called with them: a candidate that differs only there would still be rejected.';

/** Why "Optimize with the Tested tier only" is unavailable, or null. */
export function testedBlocker(s: SessionState): string | null {
  const t = s.translation;
  if (!t || t.ok) return 'This function has a Lean model; the Tested-only path is for refused functions.';
  if (s.tested) return 'Optimizing on the Tested tier only has started. The Optimize screen shows it once the original is benchmarked.';
  if (s.job.running) return `Another job is running (${s.job.running}).`;
  return null;
}

/** The offer to continue a refused function on the Tested tier only. */
function TestedStart({ s, never }: { s: SessionState; never: string | null }) {
  const { adapter, store } = useApp();
  const [specials, setSpecials] = useState(false);
  const blocker = testedBlocker(s);
  useKeys({ i: !s.tested && !never && (() => setSpecials((v) => !v)) });
  if (never) {
    return (
      <section class="stack tr-tested panel" aria-labelledby="tr-tested-title">
        <h3 id="tr-tested-title">The {TIER_LABEL.tested} tier cannot run this function</h3>
        <p class="tr-why">
          <InlineText text={never} />
        </p>
        <div>
          <ActionButton primary local keyName="f" run={() => store.go('select')}>
            Choose another function
          </ActionButton>
        </div>
      </section>
    );
  }
  return (
    <section class="stack tr-tested panel" aria-labelledby="tr-tested-title">
      <ThresholdChoice
        originalProved
        heading={`Optimize with the ${TIER_LABEL.tested} tier only`}
        startLabel={`Optimize with the ${TIER_LABEL.tested} tier only`}
        startKey="t"
        disabled={blocker !== null}
        start={(threshold) => adapter.startTestedOnly(threshold, { specials })}
      />
      <span id="tr-tested-title" class="sr-only">
        Optimize with the {TIER_LABEL.tested} tier only
      </span>
      <p>
        There is no spec to agree to and nothing to prove. Each candidate the model proposes is checked against your original itself: it must compile with the
        same signature, pass the purity check, return exactly what your original returns (or throw the same message) on inputs generated from the parameter
        types, integers and non-integer numbers alike, and those inputs must catch broken copies of your original. A candidate is kept only if it is also
        measurably faster. The highest tier any candidate can reach is {TIER_LABEL.tested}.
      </p>
      <label class="tr-specials">
        <input type="checkbox" checked={specials} disabled={!!s.tested} aria-keyshortcuts="i" onChange={(e) => setSpecials((e.currentTarget as HTMLInputElement).checked)} />{' '}
        {SPECIALS_WORDS} <KeyHint keys="i" />
      </label>
      {s.tested ? (
        <p class="tr-chosen">
          Started on the {TIER_LABEL.tested} tier only. Inputs are generated from <code>{s.tested.signature}</code>
          {s.tested.specials ? ', including NaN, Infinity, -Infinity and -0' : ''}.
        </p>
      ) : (
        blocker && <p class="tr-why">{blocker}</p>
      )}
    </section>
  );
}
