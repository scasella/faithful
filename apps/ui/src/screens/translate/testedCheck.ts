/**
 * Whether the Tested tier can run the open function at all, for both views:
 *   - `useTestedBlock`: asks the server's preflight (`Actions.testedCheck`, `GET /api/tested/check`) once per session and
 *     returns its plain reason when the Tested path can never run (a file that imports another module, say). Null while
 *     the answer is unknown, when it is ok, when the adapter cannot tell (replays), or when the check itself failed:
 *     the screens then keep their usual offer.
 *   - `testedLoadFailed`: a Tested run already failed because the original did not load in the sandbox. That failure is
 *     deterministic, so the screens say why in plain words and offer only another function, never "Try again".
 */
import { useEffect, useState } from 'preact/hooks';
import type { SessionState } from '@faithful/session';
import { testedLoadFailure } from '@faithful/session';
import { useApp } from '../../app/AppContext';

export function useTestedBlock(ask: boolean, s: SessionState): string | null {
  const { adapter } = useApp();
  const key = ask ? `${s.sourceHash}:${s.fn}` : null;
  const [answer, setAnswer] = useState<{ key: string; reason: string | null } | null>(null);
  useEffect(() => {
    if (key === null) return;
    let live = true;
    adapter.testedCheck().then(
      (c) => live && setAnswer({ key, reason: c && !c.ok ? c.reason : null }),
      () => live && setAnswer({ key, reason: null }),
    );
    return () => {
      live = false;
    };
  }, [adapter, key]);
  return key !== null && answer?.key === key ? answer.reason : null;
}

/** The plain sentence when the last Tested run failed because the original did not load; otherwise null. */
export function testedLoadFailed(s: SessionState): string | null {
  const e = s.job.lastError;
  if (!e || e.job !== 'tested' || s.job.running) return null;
  return testedLoadFailure(s.fn, e.message, s.tested?.original ?? 'file');
}
