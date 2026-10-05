/**
 * Select · Translate · Agree · Prove original · Optimize · Deliver. The session's current stage is highlighted; the
 * current and completed stages are reachable (click, or ←/→ and [ ]); future stages are not.
 */
import { STAGES, stageIndex } from '../store';
import type { StageName } from '@faithful/session';
import { KeyHint } from '../components/KeyHint';

export interface StepperProps {
  current: StageName;
  shown: StageName;
  onGo(s: StageName): void;
  /** Stages this session never passes through (a refused function on the Tested-only path: Agree, Prove). */
  skipped?: StageName[];
}

export function Stepper({ current, shown, onGo, skipped = [] }: StepperProps) {
  const ci = stageIndex(current);
  return (
    <nav class="stepper" aria-label="Stages">
      <ol>
        {STAGES.map((s, i) => {
          const off = skipped.includes(s.id);
          const state = off ? 'skipped' : i < ci ? 'done' : i === ci ? 'current' : 'future';
          const viewing = s.id === shown && s.id !== current;
          return (
            <li key={s.id} class={`${state}${viewing ? ' viewing' : ''}`}>
              <button
                type="button"
                disabled={i > ci || off}
                aria-current={s.id === current ? 'step' : undefined}
                aria-pressed={s.id === shown}
                onClick={() => onGo(s.id)}
                title={off ? `${s.label}: not part of this session (no spec or proof exists for a refused function)` : i > ci ? `${s.label}: not reached yet` : s.label}
              >
                <span class="n">{i + 1}</span>
                {s.label}
                <span class="sr-only">{state === 'skipped' ? ' (not part of this session)' : state === 'done' ? ' (completed)' : state === 'current' ? ' (current)' : ' (not reached)'}</span>
              </button>
            </li>
          );
        })}
      </ol>
      <p class="stepper-hint">
        <KeyHint keys={['←', '[']} /> previous · <KeyHint keys={['→', ']']} /> next · <KeyHint keys="?" /> keys
      </p>
    </nav>
  );
}
