/**
 * Step 2, Translate. Usually automatic: one progress line. Two cases ask the person something:
 *   refused  the translator's reason, verbatim, and "Continue on the Tested tier only" or "Pick another function"; when the
 *            server's preflight says the Tested tier can never run it (its file imports another module, say), that reason
 *            in one sentence and only "Pick another function";
 *   throws   how a throw should count (a precondition, or a spec case), in plain words.
 */
import type { SessionState } from '@faithful/session';
import type { Refusal, Translation } from '@faithful/translate';
import { TIER_LABEL } from '@faithful/core/tiers';
import { useApp } from '../app/AppContext';
import { Code } from '../components/Code';
import { InlineText } from '../components/InlineText';
import { DEFAULT_DRAFT, parseThreshold, thresholdWords } from '../screens/optimize/threshold';
import { REFUSAL_TITLE, lineExcerpt } from '../screens/translate/refusal';
import { THROW_CHOICE_WORDS, testedBlocker } from '../screens/translate/TranslateScreen';
import { useTestedBlock } from '../screens/translate/testedCheck';
import { Actions, Details, SButton, StepHead } from './parts';

/** The threshold a Simple-view start uses: the full screens' default (time budget, 10 minutes). */
export function defaultThreshold() {
  const p = parseThreshold(DEFAULT_DRAFT);
  if (!p.ok) throw new Error('the default threshold does not parse');
  return p.threshold;
}

export function TranslateStep({ onPickAnother }: { onPickAnother(): void }) {
  const { store } = useApp();
  const s = store.state.value;
  const t = s.translation;
  if (!t) {
    const failed = s.job.lastError?.job === 'open' && !s.job.running;
    return (
      <section class="s-step">
        <StepHead lead="The translator is deterministic code; no model is called.">Translating {s.fn ? <code>{s.fn}</code> : 'the function'}…</StepHead>
        <Actions>
          {failed && (
            <SButton local run={onPickAnother}>
              Pick another function
            </SButton>
          )}
        </Actions>
      </section>
    );
  }
  return t.ok ? <ThrowChoice s={s} v={t.value} /> : <Refused s={s} r={t.refusal} onPickAnother={onPickAnother} />;
}

function Refused({ s, r, onPickAnother }: { s: SessionState; r: Refusal; onPickAnother(): void }) {
  const { adapter } = useApp();
  const blocker = testedBlocker(s);
  const never = useTestedBlock(!s.tested, s);
  const th = defaultThreshold();
  if (never) {
    return (
      <section class="s-step">
        <StepHead lead={<InlineText text={never} />}>This function can't be proved or tested</StepHead>
        <Actions>
          <SButton primary local run={onPickAnother}>
            Pick another function
          </SButton>
        </Actions>
        <Details>
          <p>Why the translator refused it: <InlineText text={r.reason} /></p>
          <p>
            {REFUSAL_TITLE[r.code]} · refusal code <code>{r.code}</code> · line {r.span.line}, column {r.span.column}
          </p>
          <Code text={s.source} lang="ts" mark={r.span} label={`Source of ${s.fn}, refused part marked`} />
        </Details>
      </section>
    );
  }
  return (
    <section class="s-step">
      <StepHead lead={<InlineText text={r.reason} />}>This function can't be proved, only tested</StepHead>
      <p class="s-body">
        Faithful can still look for a faster version and check each one against your original on generated inputs. The strongest label it can give is{' '}
        <b>{TIER_LABEL.tested}</b>.
      </p>
      <Actions note={thresholdWords(th)}>
        <SButton primary disabled={blocker !== null} why={blocker ?? undefined} run={() => adapter.startTestedOnly(th, { specials: false })}>
          Continue on the {TIER_LABEL.tested} tier only
        </SButton>
        <SButton local run={onPickAnother}>
          Pick another function
        </SButton>
      </Actions>
      <Details>
        <p>
          {REFUSAL_TITLE[r.code]} · refusal code <code>{r.code}</code> · line {r.span.line}, column {r.span.column}
        </p>
        <Code text={s.source} lang="ts" mark={r.span} label={`Source of ${s.fn}, refused part marked`} />
        <p>
          No Lean model exists for it, so no spec, proof or SMT check is possible. Candidates are compared with your original on inputs generated from its
          parameter types, and those inputs must catch broken copies of it. NaN, Infinity and -0 are not generated from this view; the full view offers them.
        </p>
      </Details>
    </section>
  );
}

function ThrowChoice({ s, v }: { s: SessionState; v: Translation }) {
  const { adapter } = useApp();
  return (
    <section class="s-step">
      <StepHead lead={`${v.fnName} can throw. How should a throw count?`}>When it throws</StepHead>
      <div class="s-choices">
        {(['precondition', 'spec-case'] as const).map((c) => (
          <div key={c} class="s-choice">
            <p>{THROW_CHOICE_WORDS[c]}</p>
            <SButton primary={c === 'precondition'} run={() => adapter.chooseThrow(c)}>
              {c === 'precondition' ? 'Treat as a precondition' : 'Model as a spec case'}
            </SButton>
          </div>
        ))}
      </div>
      <Actions />
      <Details>
        {v.throwSites.map((site, i) => {
          const ex = lineExcerpt(v.source.text, site.span);
          return (
            <div key={i} class="s-stack">
              <p>
                Throws <code>{JSON.stringify(site.message)}</code> at line {site.span.line}, column {site.span.column}
              </p>
              <Code text={ex.text} lang="ts" mark={ex.mark} from={ex.from} label={`Throw site ${i + 1}`} />
            </div>
          );
        })}
        {s.translation?.ok && <Code text={s.translation.value.lean.source} lang="lean" label="Lean model" />}
      </Details>
    </section>
  );
}
