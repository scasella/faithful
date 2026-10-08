/**
 * The landing page: what Faithful does, one real catch, the six gates with one real candidate's numbers, the five labels,
 * what was measured, and the limits. Every recorded figure comes from ./content.ts (sourced and tested there); the labels
 * and the Proved sentence come from @faithful/core, never retyped.
 *
 * variant 'showcase': the front of the static showcase; its calls to action go to the replay and the live checks below.
 * variant 'local': the start screen of the local UI; "Open the app" calls onEnter, and a checkbox decides (session
 * cookie, ./startScreen.ts) whether this page shows when Faithful opens.
 */
import { useState } from 'preact/hooks';
import { TIER_LABEL, TIER_ORDER, formatCount, provedSentence, type Tier } from '@faithful/core/tiers';
import { canSayFaster, ceilN, floorN, msText, outcomeVerb, valText } from '../lib/format';
import { isProvedTier, tierText } from '../lib/tierText';
import {
  CATCH,
  CLAMP_MODEL_CHECK_N,
  COMMANDS,
  FASTER_NOT_PROVED,
  FIB,
  MEASURED,
  MEASURED_NOTE,
  REQUIREMENTS,
  TIER_MEANING,
  TOOLCHAIN_STAMP,
  type CodeLine,
} from './content';
import { currentStartScreen, writeStartScreen } from './startScreen';
import './landing.css';

export interface LandingProps {
  variant: 'showcase' | 'local';
  /** Local variant: show the app. */
  onEnter?(): void;
}

/** Whole numbers of four or more digits in a recorded string, grouped as the rest of the page prints counts (1,000). */
export function groupDigits(text: string): string {
  return text.replace(/\d{4,}/g, (d) => formatCount(Number(d)));
}

/**
 * The speedup as printed everywhere on this page: estimate and lower bound rounded down, upper bound up (whole numbers),
 * grouped after rounding so the direction of the rounding never changes.
 */
export function fibSpeedupText(): { ratio: string; ci: string } {
  const s = FIB.speedup;
  return { ratio: `${groupDigits(floorN(s.ratio, 0))}×`, ci: `95% CI ${groupDigits(floorN(s.lo, 0))}–${groupDigits(ceilN(s.hi, 0))}` };
}

/** "n = 8, 16, 32": the sizes the benchmark distribution was drawn at. */
const FIB_SIZES = `n = ${FIB.sizes.join(', ')}`;

const VERIFIED_K = tierText('verified-to-k', { k: FIB.k, n: null }).label; // "Verified to k=6"

function Logo() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M4 12h6" />
      <path d="M14 12h6" />
      <path d="M4 7h16" />
      <path d="M4 17h16" />
    </svg>
  );
}

function Pane({ title, lines }: { title: string; lines: readonly (string | CodeLine)[] }) {
  return (
    <div class="ld-pane">
      <span class="ld-pane-title">{title}</span>
      <pre class="ld-code">
        {lines.map((l, i) => {
          const line = typeof l === 'string' ? { text: l } : l;
          return line.removed ? (
            <del key={i} class="ld-removed">
              <span class="sr-only">removed: </span>
              {line.text}
              {'\n'}
            </del>
          ) : (
            <span key={i}>
              {line.text}
              {'\n'}
            </span>
          );
        })}
      </pre>
    </div>
  );
}

function CatchCard() {
  return (
    <article id="catch" class="ld-catch" aria-labelledby="catch-h">
      <div class="ld-catch-head">
        <span class="ld-catch-tag">Rejected by Z3</span>
        <span class="ld-muted">
          Recorded session · {CATCH.fn} · candidate {CATCH.candidateId} of {CATCH.candidateCount}
        </span>
      </div>
      <div class="ld-catch-body">
        <h2 id="catch-h" class="ld-catch-h">
          {formatCount(CATCH.compared)} generated inputs agreed. Z3 found one that didn’t.
        </h2>
        <div class="ld-panes">
          <Pane title="Original" lines={CATCH.original} />
          <Pane title="The model’s “faster” rewrite" lines={CATCH.rewrite} />
        </div>
        <ol class="ld-gates">
          <li>
            <span class="ld-gate-st ld-ok">pass</span>
            <span>
              {CATCH.passed.join(' · ')}: {groupDigits(CATCH.differential)}
            </span>
          </li>
          <li>
            <span class="ld-gate-st ld-bad">{CATCH.smtResult}</span>
            <span>{CATCH.smt}</span>
          </li>
        </ol>
        <dl class="ld-cx">
          <div>
            <dt>input</dt>
            <dd class="ld-cx-big">{valText(CATCH.input)}</dd>
            <dd class="ld-muted ld-small">{CATCH.params.join(', ')}</dd>
          </div>
          <div>
            <dt>original</dt>
            <dd>{outcomeVerb(CATCH.originalOutcome)}</dd>
          </div>
          <div class="ld-cx-cand">
            <dt>candidate</dt>
            <dd class="ld-cx-big">{outcomeVerb(CATCH.candidateOutcome)}</dd>
          </div>
        </dl>
        <p class="ld-muted ld-small">
          Not delivered. The session ended with the original, for which Lean had already accepted a proof against the agreed spec.
        </p>
      </div>
    </article>
  );
}

function Funnel() {
  const sp = fibSpeedupText();
  const gates: { n: string; name: string; what: string; result: string; tone: 'ok' | 'z3' | 'none' }[] = [
    { n: '01', name: 'Compile', what: 'Strict TypeScript, same signature.', result: `pass · ${msText(FIB.compileMs)}`, tone: 'ok' },
    { n: '02', name: 'Purity', what: 'No I/O, clock, randomness or input mutation on a sample.', result: `pass · ${msText(FIB.purityMs)}`, tone: 'ok' },
    {
      n: '03',
      name: 'Differential',
      what: 'Generated inputs against the original; broken copies of the original check that the test can fail.',
      result: `${formatCount(FIB.compared)} inputs (${FIB.skippedSlow} skipped: the original takes more than 100 ms) · ${FIB.mutantsCaught} of ${FIB.mutantsTotal} broken copies caught`,
      tone: 'ok',
    },
    {
      n: '04',
      name: 'Bounded Z3',
      what: 'Searches every input within stated bounds for a difference.',
      result: `${FIB.smtResult} · ${VERIFIED_K}, narrowed to ${FIB.narrowed}`,
      tone: 'z3',
    },
    {
      n: '05',
      name: 'Benchmark',
      what: `${FIB.trials} trials on a declared distribution, 95% CI; estimate and lower bound rounded down.`,
      result: `${sp.ratio} (${sp.ci}) at ${FIB_SIZES}`,
      tone: 'ok',
    },
    {
      n: '06',
      name: 'Lean proof',
      what: 'Against the same agreed spec as the original, only for a candidate significantly faster than the current best. Lean checks every attempt.',
      result: `${TIER_LABEL['not-proved']} · ${FIB.proofAttempts} attempts`,
      tone: 'none',
    },
  ];
  return (
    <section id="funnel" class="ld-band ld-alt" aria-labelledby="funnel-h">
      <div class="ld-wrap">
        <div class="ld-sec-head ld-sec-head-row">
          <div class="ld-sec-intro">
            <h2 id="funnel-h">Six gates. Any one can say no.</h2>
            <p>
              The model only proposes. Each rewrite is checked by tools that don’t care how confident it sounded. A Lean proof is attempted
              only for a candidate that is significantly faster than the current best.
            </p>
          </div>
          <p class="ld-mono ld-muted ld-small">
            numbers: {FIB.fn}, candidate {FIB.candidateId}, recorded session
          </p>
        </div>
        <ol class="ld-funnel">
          {gates.map((g) => (
            <li key={g.n} class={`ld-gate ld-gate-${g.tone}`}>
              <span class="ld-mono ld-muted ld-small">{g.n}</span>
              <strong>{g.name}</strong>
              <span class="ld-gate-what">{g.what}</span>
              <span class={`ld-gate-res ld-mono ld-tone-${g.tone}`}>{g.result}</span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/** Position on a log10 axis from 1× to 100,000× (0..100). */
function logPos(x: number): number {
  return Math.max(0, Math.min(100, (Math.log10(Math.max(1, x)) / 5) * 100));
}

function FibCase() {
  const sp = fibSpeedupText();
  const s = FIB.speedup;
  const faster = canSayFaster(s);
  const lo = logPos(s.lo);
  const hi = logPos(s.hi);
  return (
    <section class="ld-band" aria-labelledby="fib-h">
      <div class="ld-wrap ld-split">
        <div class="ld-split-text">
          <h2 id="fib-h">A {sp.ratio} speedup we didn’t call proved.</h2>
          <p>
            The model turned textbook recursive Fibonacci into a loop. The differential test found no difference on {formatCount(FIB.compared)}{' '}
            inputs, Z3 found none up to k={FIB.k} (narrowed to {FIB.narrowed}), and the benchmark interval sits far above 1. That ratio holds
            for the benchmark’s distribution only ({FIB_SIZES}): exponential against linear time, so it grows with n. Lean proved the
            equality part, but not the range part: that the loop stays inside the model’s integer range wherever the original does. So the
            label is <strong>{VERIFIED_K}</strong>, and nothing on the page says otherwise.
          </p>
          <p class="ld-muted ld-small">
            Across the campaign, {FASTER_NOT_PROVED} candidates were faster but not proved. They are shown, labelled, and never delivered with a
            proof label.
          </p>
        </div>
        <div class="ld-card ld-fib">
          <div class="ld-fib-head">
            <span class="ld-mono ld-strong">
              {FIB.fn} · candidate {FIB.candidateId}
            </span>
            <span class="ld-label-row">
              <span class="ld-pill">{VERIFIED_K}</span>{' '}
              <span class="ld-carve">narrowed to {FIB.narrowed}</span>
            </span>
          </div>
          <div class="ld-ci">
            <div class="ld-ci-cap ld-small ld-muted">
              <span>speedup against the original, 95% CI, log scale</span>
              <span class="ld-mono">
                {FIB.distribution}, {FIB_SIZES}
              </span>
            </div>
            <div class="ld-ci-bar" aria-hidden="true">
              {[0, 1, 2, 3, 4, 5].map((e) => (
                <span key={e} class="ld-ci-tick" style={{ left: `${e * 20}%` }}>
                  <span>{formatCount(10 ** e)}×</span>
                </span>
              ))}
              <span class="ld-ci-int" style={{ left: `${lo}%`, width: `max(4px, ${hi - lo}%)` }} />
            </div>
            <p class="ld-ci-num">
              <span class="ld-mono ld-ci-big">{sp.ratio}</span> <span class="ld-mono ld-muted">({sp.ci})</span>
              {faster && <span class="ld-small ld-muted"> faster than the original</span>}
            </p>
          </div>
          <div class="ld-fib-why">
            <span class="ld-eyebrow">Lean’s verdict on the candidate</span>
            <p class="ld-mono">{FIB.proof}</p>
          </div>
        </div>
      </div>
    </section>
  );
}

function tierTone(t: Tier): string {
  return isProvedTier(t) ? 'ok' : t === 'verified-to-k' ? 'z3' : t === 'tested' ? 'warn' : 'none';
}

function Labels() {
  const row = (t: Tier) => (
    <div key={t} class="ld-tier-row">
      <span class={`ld-tier-label ld-mono ld-tone-${tierTone(t)}`}>{TIER_LABEL[t]}</span>
      <span class="ld-tier-meaning">{TIER_MEANING[t]}</span>
    </div>
  );
  const proved = TIER_ORDER.filter((t) => isProvedTier(t));
  const rest = TIER_ORDER.filter((t) => !isProvedTier(t));
  return (
    <section id="labels" class="ld-band ld-alt" aria-labelledby="labels-h">
      <div class="ld-wrap">
        <div class="ld-sec-intro">
          <h2 id="labels-h">Five labels. Exactly one per claim.</h2>
          <p>No marks, ranks or percentages. A label is a statement about evidence, strongest first.</p>
        </div>
        <div class="ld-tiers">
          {proved.map(row)}
          <figure class="ld-sentence">
            <figcaption class="ld-eyebrow">Wherever either Proved label appears, this sentence appears with it</figcaption>
            <blockquote>{provedSentence(CLAMP_MODEL_CHECK_N)}</blockquote>
            <p class="ld-small ld-muted">
              N, here {formatCount(CLAMP_MODEL_CHECK_N)}, is the number of inputs of the model check in the recorded {CATCH.fn} session.
            </p>
          </figure>
          {rest.map(row)}
        </div>
      </div>
    </section>
  );
}

function MeasuredSection() {
  return (
    <section id="measured" class="ld-band" aria-labelledby="measured-h">
      <div class="ld-wrap">
        <div class="ld-sec-intro">
          <h2 id="measured-h">What we measured, including the unflattering parts</h2>
          <p>Counts from the launch report, docs/LAUNCH.md. Every number comes from a results file in the repository.</p>
        </div>
        <dl class="ld-measured">
          {MEASURED.map((m) => (
            <div key={m.value} class="ld-card">
              <dt>{m.label}</dt>
              <dd class={`ld-mono${m.catchTone ? ' ld-bad' : ''}`}>{m.value}</dd>
            </div>
          ))}
        </dl>
        <p class="ld-muted ld-small ld-note">{MEASURED_NOTE}</p>
      </div>
    </section>
  );
}

function Limits() {
  return (
    <section id="limits" class="ld-band ld-alt" aria-labelledby="limits-h">
      <div class="ld-wrap ld-split">
        <div class="ld-sec-intro ld-split-text">
          <h2 id="limits-h">What is proved, and what is not</h2>
          <p>The theorem is about the Lean model and the agreed spec, under stated preconditions. It is not a theorem about the TypeScript itself.</p>
        </div>
        <ul class="ld-limits">
          <li>
            <strong>Subset v1 only.</strong> Integers within ±2^53, booleans, BMP strings, arrays, tuples, records and options, loops and
            recursion with a termination measure. Floats, bitwise operators, regular expressions, Map/Set, dates, randomness, I/O, async,
            generics and overloads are refused with a code and a line number.
          </li>
          <li>
            <strong>The model is a bridge, not the code.</strong> A fixed translator (no model call) produces it; the link to the TypeScript is
            the translator’s design plus a differential check on N inputs.
          </li>
          <li>
            <strong>You can carve inputs out.</strong> Every carve-out is printed beside the label it limits. A proof with heavy carve-outs can
            cover very little.
          </li>
          <li>
            <strong>Your files are never modified.</strong> You get a patch, a provenance file and VERIFY.md. <code>faithful verify</code> re-checks
            a delivery without trusting it.
          </li>
        </ul>
      </div>
    </section>
  );
}

function ShowOnOpen() {
  const [on, setOn] = useState(() => currentStartScreen() === 'landing');
  return (
    <label class="ld-check">
      <input
        type="checkbox"
        checked={on}
        onChange={(e) => {
          const v = (e.currentTarget as HTMLInputElement).checked;
          setOn(v);
          writeStartScreen(v ? 'landing' : 'app');
        }}
      />
      Show this page when Faithful opens
    </label>
  );
}

export function Landing({ variant, onEnter }: LandingProps) {
  const local = variant === 'local';
  const Main = local ? 'main' : 'div';
  return (
    <div class="landing" data-testid="landing" data-variant={variant}>
      <header class="ld-header">
        <nav class="ld-nav ld-wrap" aria-label="Landing page">
          <a href="#top" class="ld-brand">
            <Logo />
            <span class="ld-mono">faithful</span>
          </a>
          <div class="ld-nav-links">
            <a href="#funnel">How it works</a>
            <a href="#labels">The five labels</a>
            <a href="#measured">What we measured</a>
            <a href="#limits">Limits</a>
          </div>
          {local ? (
            <button type="button" class="ld-btn ld-btn-quiet" onClick={() => onEnter?.()}>
              Open the app
            </button>
          ) : (
            <a href="#replay" class="ld-btn ld-btn-quiet">
              Recorded sessions
            </a>
          )}
        </nav>
      </header>

      <Main id="top">
        <section class="ld-hero ld-wrap" aria-labelledby="hero-h">
          <div class="ld-hero-text">
            <p class="ld-mono ld-muted ld-small ld-kicker">TypeScript → Lean 4 · Z3 · bootstrap CIs · labels, not numbers</p>
            <h1 id="hero-h" tabIndex={-1}>
              Make one function faster.
              <br />
              Prove it still does the same thing.
            </h1>
            <p class="ld-lede">
              Faithful hands a TypeScript function to a model for faster rewrites, then refuses to believe it. Every rewrite runs a gauntlet of
              checks; one that is significantly faster than the current best must also pass a Lean proof against a spec you agreed to before it
              can carry a proof label. The result ships at the strongest label its evidence supports, and{' '}
              <strong>the tool never rounds a claim up</strong>.
            </p>
            <div class="ld-install">
              <pre class="ld-term">
                {COMMANDS.map((c) => (
                  <span key={c}>
                    <span aria-hidden="true" class="ld-prompt">
                      ${' '}
                    </span>
                    {c}
                    {'\n'}
                  </span>
                ))}
              </pre>
              <p class="ld-muted ld-small">
                {REQUIREMENTS} <code>faithful setup</code> states the cost before it starts.
              </p>
            </div>
            <div class="ld-ctas">
              {local ? (
                <>
                  <button type="button" class="ld-btn ld-btn-primary" onClick={() => onEnter?.()}>
                    Open the app
                  </button>
                  <a href="#labels" class="ld-btn">
                    What “proved” does and doesn’t mean
                  </a>
                </>
              ) : (
                <>
                  <a href="#replay" class="ld-btn ld-btn-primary">
                    Watch a recorded session
                  </a>
                  <a href="#live" class="ld-btn">
                    Check a rewrite in your browser
                  </a>
                </>
              )}
            </div>
            {local && <ShowOnOpen />}
          </div>
          <CatchCard />
        </section>
        <Funnel />
        <FibCase />
        <Labels />
        <MeasuredSection />
        <Limits />
      </Main>

      <footer class="ld-footer">
        <div class="ld-wrap ld-mono ld-small ld-muted ld-stamp">
          {TOOLCHAIN_STAMP.map((s) => (
            <span key={s}>{s}</span>
          ))}
        </div>
      </footer>
    </div>
  );
}
