/** What runs live on this page and what is replayed from the recording. Plain words; no scores. */
import { Z3_VERSION_LABEL } from './versions';
import { dateOf, recordedWith, type Recording } from './recording';

export function About({ rec }: { rec: Recording }) {
  const coi = typeof globalThis.crossOriginIsolated === 'boolean' && globalThis.crossOriginIsolated;
  return (
    <section class="panel about" id="about" aria-labelledby="about-h" data-testid="about">
      <h2 id="about-h">What is live and what is replayed</h2>
      <h3>Replayed (recorded on {dateOf(rec.recordedAt)})</h3>
      <p>
        The session panel plays back the events the tool wrote while it ran, at their recorded pace: the translation, the
        model’s spec proposals and every prompt it was sent, the challenge search, the Lean proof attempts and Lean’s verdicts,
        and, in sessions that optimized, the candidates, their checks and benchmarks. It was recorded with {recordedWith(rec.toolchain)}.
        Nothing in that panel is recomputed here: no model is called, no Lean runs, and the benchmark figures (with their 95% CI)
        are the recorded ones from the recording machine. The Lean file offered below the live checks is the one the tool
        delivered then; it is not re-checked in your browser.
      </p>
      <h3>Live (ran in your browser)</h3>
      <ul>
        <li>
          The deterministic translator (TypeScript to the Lean model) runs here on the recorded original and its output is compared
          with the recorded model by hash.
        </li>
        <li>The compile gate: the real TypeScript compiler in strict mode, with the ES2022/ES2023 standard library declarations bundled into the page.</li>
        <li>
          The purity check and the differential test: the tool’s own sandbox code and purity mask run in a Web Worker, on inputs drawn by
          the tool’s generator under the recorded preconditions, with the same seed rule as the optimizer.
        </li>
        <li>
          The SMT check: the tool’s SMT encoder plus Z3 {Z3_VERSION_LABEL} compiled to WebAssembly. It needs a cross-origin-isolated page
          (the WASM build uses threads, hence SharedArrayBuffer). A static host cannot send the needed headers, so this site installs
          coi-serviceworker (MIT, Guido Zuidhof), which adds them and reloads the page once. This page is{' '}
          {coi ? 'cross-origin isolated, so Z3 can run here' : 'not cross-origin isolated right now, so the SMT stage is shown as not available'}.
        </li>
      </ul>
      <p>
        Not live: the mutation check of the original, the Lean proof, and the benchmark. A candidate that passes everything here has
        passed the checks that run in a browser and nothing more.
      </p>
      <h3>Limits</h3>
      <p>
        The browser sandbox is the same accident-catching purity mask as the tool’s Node worker: it is not a security boundary, and a
        Web Worker’s memory cannot be capped from the page. Time is bounded: a call that runs longer than its budget is stopped by
        terminating the worker. The live checks run on your machine, so their timings are your browser’s, not the recording machine’s.
      </p>
    </section>
  );
}
