/**
 * The Simple view's steps, pure. The session's stages do not map one to one onto the steps a person sees:
 *   - a translated function with nothing to decide goes straight to Agree (whose first action is "Propose a spec");
 *   - a finished proof of the original moves on to Faster (which shows the proof's label above its one button);
 *   - a stopped optimization is the Result.
 * Two local overrides come from the page, not the session: `picking` (the person asked to pick another function and no
 * new session has started yet) and `continueUnproved` (after "Not proved", the person chose to continue without it).
 */
import type { SessionState, StampedEvent } from '@faithful/session';
import { agreeGate, agreeView } from '../screens/agree/gate';
import { isProvedResult, originalProof } from '../screens/prove/proveModel';

export type StepId = 'pick' | 'translate' | 'agree' | 'prove' | 'faster' | 'result';

export const STEP_LABEL: Record<StepId, string> = {
  pick: 'Pick',
  translate: 'Translate',
  agree: 'Agree',
  prove: 'Prove',
  faster: 'Faster',
  result: 'Result',
};

export interface LocalFlow {
  picking?: boolean;
  continueUnproved?: boolean;
}

export function simpleStep(s: SessionState, o: LocalFlow = {}): StepId {
  if (o.picking) return 'pick';
  switch (s.stage) {
    case 'select':
      return s.fn ? 'translate' : 'pick';
    case 'translate': {
      const t = s.translation;
      if (!t) return 'translate';
      if (!t.ok) return s.tested ? 'faster' : 'translate';
      if (t.value.canThrow && s.throwChoice === null) return 'translate';
      return 'agree';
    }
    case 'agree':
      return 'agree';
    case 'prove': {
      const p = originalProof(s);
      if (!p || p.result === 'running') return 'prove';
      if (isProvedResult(p.result)) return 'faster';
      return o.continueUnproved ? 'faster' : 'prove';
    }
    case 'optimize':
      return s.optimize.stoppedBy === null ? 'faster' : 'result';
    case 'deliver':
      return 'result';
  }
}

/** The steps this session passes through: a refused function on the Tested-only path has no Agree and no Prove. */
export function stepList(s: SessionState): StepId[] {
  return s.tested || (s.translation && !s.translation.ok) ? ['pick', 'translate', 'faster', 'result'] : ['pick', 'translate', 'agree', 'prove', 'faster', 'result'];
}

/** "Step 3 of 6 · Agree". While picking another function the old session's step count says nothing: "Step 1 · Pick". */
export function progressText(s: SessionState, step: StepId, picking = false): string {
  if (picking) return `Step 1 · ${STEP_LABEL.pick}`;
  const list = stepList(s);
  const i = list.indexOf(step);
  return `Step ${i + 1} of ${list.length} · ${STEP_LABEL[step]}`;
}

/**
 * Where "Pick another function" was pressed: the length of the event list then, and its last event (by identity). The
 * store replaces the whole list on a reset (a reconnect that finds a restarted server), so a list whose element at
 * `from - 1` is no longer `last` is a different list, and the index means nothing in it any more.
 */
export interface PickMark {
  from: number;
  last: StampedEvent | undefined;
}

export function pickMark(events: readonly StampedEvent[]): PickMark {
  return { from: events.length, last: events[events.length - 1] };
}

/**
 * True while a pick the person asked for has not produced a new session yet (no `session.started` after the mark).
 * After a reset of the event list the page shows whatever session the server has, so picking ends there too.
 */
export function stillPicking(mark: PickMark | null, events: readonly StampedEvent[]): boolean {
  if (mark === null) return false;
  if (events.length < mark.from || (mark.from > 0 && events[mark.from - 1] !== mark.last)) return false;
  for (let i = mark.from; i < events.length; i++) if (events[i]!.event.kind === 'session.started') return false;
  return true;
}

/**
 * Which screen is showing, finer than the step: a change of it replaces the buttons (and the one that had focus), so
 * the shell moves focus to the new heading. Within Agree: propose / one disagreement / the gate's next action /
 * confirm; within Prove: start / running / not proved; within Faster: start / running / failed; Result: before and
 * after delivery.
 */
export function screenId(s: SessionState, step: StepId): string {
  switch (step) {
    case 'translate': {
      const t = s.translation;
      return `translate:${!t ? 'pending' : t.ok ? 'throw' : 'refused'}`;
    }
    case 'agree': {
      const v = agreeView(s);
      if (!v.proposal) return 'agree:propose';
      const g = agreeGate(s, v);
      if (g.ok) return 'agree:confirm';
      if (g.next === 'rule') return `agree:rule:${v.challenges.find((c) => v.unruled.includes(c.id))?.id ?? ''}`;
      return `agree:${g.next}`;
    }
    case 'prove': {
      const p = originalProof(s);
      return `prove:${!p ? 'start' : p.result === 'running' ? 'running' : 'not-proved'}`;
    }
    case 'faster':
      return `faster:${s.optimize.startedAt === null ? 'start' : optimizeFailed(s) ? 'failed' : 'running'}`;
    case 'result':
      return s.delivery ? 'result:delivered' : 'result';
    default:
      return step;
  }
}

/**
 * The optimize (or Tested-only) job failed after `optimize.started`: the server emits `job.failed` and never
 * `optimize.stopped`, so the session stays in the optimize stage with nothing running and nothing left to stop.
 */
export function optimizeFailed(s: SessionState): boolean {
  const j = s.job.lastError?.job;
  return s.optimize.startedAt !== null && s.optimize.stoppedBy === null && s.job.running === null && (j === 'optimize' || j === 'tested');
}

/** Identifies the not-proved run a "continue without the proof" choice was made for, so a new run asks again. */
export function proofKey(s: SessionState): string | null {
  const p = originalProof(s);
  return p ? `${s.sourceHash}:${p.theoremId}:${p.pinnedTo}:${p.attempts.length}:${p.result}` : null;
}
