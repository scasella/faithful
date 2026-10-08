/**
 * The job line under the stepper: a calm indicator while the server runs a job (with its name), and the last failure,
 * inline and kept until the next job starts (the reducer clears it on `job.started`). Never a modal.
 */
import { useApp } from './AppContext';
import { jobWords } from '../lib/job';
import { testedLoadFailed } from '../screens/translate/testedCheck';

export function JobBar() {
  const { store } = useApp();
  const s = store.state.value;
  const { running, lastError } = s.job;
  // a Tested run that failed loading the original: the plain reason, not the sandbox's internals
  const plain = testedLoadFailed(s);
  if (!running && !lastError) return null;
  return (
    <div class="jobbar">
      {running && (
        <p class="job-running" role="status" aria-live="polite">
          <span class="job-dot" aria-hidden="true" />
          {jobWords(running)}… <span class="muted">Other actions wait until it finishes.</span>
        </p>
      )}
      {lastError && (
        <p class="err-inline job-failed" role="alert">
          <b>{jobWords(lastError.job)} failed.</b> {plain ?? lastError.message}
        </p>
      )}
    </div>
  );
}
