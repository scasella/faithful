/** The candidate funnel: compile, purity, differential, smt, proof, benchmark, each with its status and time. */
import { STAGE_ORDER, type StageResult } from '@faithful/session';
import { STAGE_LABEL } from '../lib/catch';
import { msText } from '../lib/format';
import { stageSummaryText } from '../lib/tierText';
import { Num } from './Provenance';

const STATUS_WORD: Record<StageResult['status'], string> = {
  pending: 'pending',
  running: 'running',
  pass: 'passed',
  fail: 'failed',
  skipped: 'skipped',
};
const GLYPH: Record<StageResult['status'], string> = { pending: '·', running: '…', pass: '✓', fail: '✕', skipped: '–' };

/** `decided`: the candidate was decided, so a stage with no result was never run (not "pending"). */
export function Funnel({ stages, label = 'Checks', decided = false }: { stages: StageResult[]; label?: string; decided?: boolean }) {
  return (
    <ol class="funnel" aria-label={label}>
      {STAGE_ORDER.map((id) => {
        const r = stages.find((s) => s.stage === id);
        const status = r?.status ?? 'pending';
        const word = !r && decided ? 'not run' : STATUS_WORD[status];
        return (
          <li key={id} class={status} title={r ? stageSummaryText(r.summary) : undefined}>
            <span class="st">
              <span aria-hidden="true">{GLYPH[status]} </span>
              {STAGE_LABEL[id]}
              <span class="sr-only">: {word}</span>
            </span>
            <span class="ms">
              {r && r.status !== 'pending' && r.status !== 'skipped' ? (
                <Num what={`${STAGE_LABEL[id]} stage: ${stageSummaryText(r.summary)}`}>{msText(r.ms)}</Num>
              ) : (
                word
              )}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
