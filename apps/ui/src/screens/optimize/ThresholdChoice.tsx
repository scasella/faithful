/**
 * The threshold choice, made up front. The Optimize stage becomes reachable only once optimization has started, so this
 * renders at the end of the Prove screen (and on Optimize if it is shown before a start). Keys 1/2 pick the kind, `o`
 * starts. Time budget is the default. Asymptotic is shown disabled: the server does not implement it in this build.
 */
import { useReducer } from 'preact/hooks';
import type { Threshold } from '@faithful/session';
import { useApp } from '../../app/AppContext';
import { ActionButton } from '../../components/ActionButton';
import { KeyHint } from '../../components/KeyHint';
import { useKeys } from '../../lib/keys';
import { DEFAULT_DRAFT, THRESHOLD_KINDS, draftReducer, parseThreshold } from './threshold';
import './optimize.css';

export interface ThresholdChoiceProps {
  originalProved: boolean;
  /** Tested-only path (Translate screen of a refused function): start with this instead of `startOptimize`. */
  start?: (t: Threshold) => Promise<void>;
  heading?: string;
  startLabel?: string;
  startKey?: string;
  disabled?: boolean;
}

export function ThresholdChoice({ originalProved, start, heading, startLabel, startKey = 'o', disabled = false }: ThresholdChoiceProps) {
  const { adapter } = useApp();
  const [d, dispatch] = useReducer(draftReducer, DEFAULT_DRAFT);
  const parsed = parseThreshold(d);
  useKeys(Object.fromEntries(THRESHOLD_KINDS.filter((k) => k.available).map((k) => [k.key, () => dispatch({ type: 'kind', kind: k.kind })])));
  const field = (f: 'minutes' | 'target') => (e: Event) => dispatch({ type: 'field', field: f, value: (e.currentTarget as HTMLInputElement).value });

  return (
    <section class="stack op-threshold" aria-labelledby="threshold-title">
      <h3 id="threshold-title">{heading ?? 'Next: when should optimizing stop?'}</h3>
      {!originalProved && !start && (
        <p class="muted">
          The original is not proved against the agreed spec. Candidates are still checked; a candidate can only reach the proof tier through the direct theorem
          that it equals the original.
        </p>
      )}
      <fieldset class="fx-choices">
        <legend class="sr-only">Threshold</legend>
        {THRESHOLD_KINDS.map((k) => (
          <label key={k.kind} class={`fx-choice${d.kind === k.kind ? ' on' : ''}${k.available ? '' : ' off'}`}>
            <input
              type="radio"
              name="threshold-kind"
              value={k.kind}
              checked={d.kind === k.kind}
              disabled={!k.available}
              aria-keyshortcuts={k.available ? k.key : undefined}
              onChange={() => dispatch({ type: 'kind', kind: k.kind })}
            />
            <span class="fx-choice-body">
              <span class="fx-choice-title">
                {k.title}
                {k.kind === 'time-budget' && <span class="muted"> · default</span>}
                {k.available ? (
                  <>
                    {' '}
                    <KeyHint keys={k.key} />
                  </>
                ) : (
                  <span class="muted"> · unavailable</span>
                )}
              </span>
              <span class="fx-choice-words">{k.words}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <div class="fx-fields">
        {d.kind === 'time-budget' && (
          <label class="fx-field">
            <span>Minutes</span>
            <input type="number" inputMode="decimal" min="1" step="1" value={d.minutes} onInput={field('minutes')} />
          </label>
        )}
        {d.kind === 'speedup' && (
          <>
            <label class="fx-field">
              <span>Target (times faster than the original)</span>
              <input type="number" inputMode="decimal" min="1.1" step="0.1" value={d.target} onInput={field('target')} />
            </label>
            <p class="muted fx-small fx-wide">
              Measured on the declared distribution: the server calibrates it from your original when optimizing starts, and the Optimize screen shows it
              with the baseline.
            </p>
          </>
        )}
      </div>
      <p class="err-inline" role="status" aria-live="polite">
        {parsed.ok ? '' : parsed.error}
      </p>
      <div class="row">
        <ActionButton
          primary
          keyName={startKey}
          disabled={!parsed.ok || disabled}
          run={() => (parsed.ok ? (start ? start(parsed.threshold) : adapter.startOptimize(parsed.threshold)) : undefined)}
        >
          {startLabel ?? 'Start optimizing'}
        </ActionButton>
        <span class="muted fx-small">Tab moves between fields; keys are ignored while you type.</span>
      </div>
    </section>
  );
}
