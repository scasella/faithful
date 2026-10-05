/**
 * The job line under the stepper: a calm indicator while the server runs a job (with its name), and the last failure,
 * inline and kept until the next job starts (the reducer clears it on `job.started`). Never a modal.
 */
import { useApp } from './AppContext';
import { jobWords } from '../lib/job';

export function JobBar() {
  const { store } = useApp();
  const { running, lastError } = store.state.value.job;
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
          <b>{jobWords(lastError.job)} failed.</b> {lastError.message}
        </p>
      )}
    </div>
  );
}
