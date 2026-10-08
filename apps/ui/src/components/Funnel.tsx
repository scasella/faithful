/**
 * The candidate's gates as a grid of chips, one per stage in the order a candidate meets them: compile, purity,
 * differential, bounded Z3, benchmark, Lean proof. Each chip has its status word and the stage summary the server wrote
 * (cut to its first clause when long; see gates.ts), with its time.
 */
import type { StageResult } from '@faithful/session';
import { msText } from '../lib/format';
import { stageSummaryText } from '../lib/tierText';
import { GATE_LABEL, GATE_ORDER, gateNote, gateStatusWord } from './gates';
import { Num } from './Provenance';

/** `decided`: the candidate was decided, so a stage with no result was never run (not "pending"). */
export function Funnel({ stages, label = 'Checks', decided = false }: { stages: StageResult[]; label?: string; decided?: boolean }) {
  return (
    <ol class="funnel" aria-label={label}>
      {GATE_ORDER.map((id) => {
        const r = stages.find((s) => s.stage === id) ?? null;
        const status = r?.status ?? (decided ? 'not-run' : 'pending');
        const word = gateStatusWord(r, decided);
        const note = r && r.status !== 'pending' ? gateNote(r) : '';
        return (
          <li key={id} class={`gate gate-${id} ${status}`}>
            <span class="gate-head">
              <span class="st">{GATE_LABEL[id]}</span>
              <span class="gate-word">
                <span class="sr-only">: </span>
                {word}
              </span>
            </span>
            {note && (
              <span class="gate-note">
                <Num what={`${GATE_LABEL[id]} stage, as the server recorded it: ${stageSummaryText(r!.summary)}`}>{note}</Num>
              </span>
            )}
            {r && r.status !== 'pending' && r.status !== 'skipped' && (
              <span class="ms">
                <Num what={`${GATE_LABEL[id]} stage: ${stageSummaryText(r.summary)}`}>{msText(r.ms)}</Num>
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
