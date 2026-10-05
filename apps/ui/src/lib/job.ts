/**
 * Server jobs (packages/cli/src/api.ts `job(name, …)`): one at a time; `SessionState.job` says which is running and the
 * last failure. These are the names the server uses, in plain words.
 */
import type { SessionState, StampedEvent } from '@faithful/session';

const WORDS: Record<string, string> = {
  open: 'Opening and translating the function',
  'throw-choice': 'Recording how to treat the throw',
  'spec-proposal': 'Asking the model for a spec, then checking it against the Lean model',
  'spec-revision': 'Asking the model to revise the spec, then checking it',
  challenge: 'Searching for inputs where the spec and your function disagree',
  ruling: 'Recording the ruling',
  agree: 'Recording the agreement',
  'prove-original': 'Proving the original (the model writes attempts, Lean checks each)',
  optimize: 'Optimizing',
  accept: 'Accepting the candidate',
  deliver: 'Writing the delivery',
};

export function jobWords(job: string): string {
  return WORDS[job] ?? job;
}

/** Stream time (ms since the session's first event) at which the running job started, or null. */
export function jobStartedAt(s: Pick<SessionState, 'job'>, events: readonly StampedEvent[]): number | null {
  if (!s.job.running) return null;
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!.event;
    if (e.kind === 'job.started' && e.job === s.job.running) return events[i]!.t;
  }
  return null;
}
