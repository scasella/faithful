/**
 * Dev route `?dev=gallery`: every shared component, then the whole `catch` fixture session with all six screens one
 * after another. Development fixture data only (banner at the top).
 */
import { replay as replayEvents, type CandidateRecord } from '@faithful/session';
import { TIER_ORDER } from '@faithful/core/tiers';
import { ReplayAdapter } from '../adapters/replay';
import { AppContext } from '../app/AppContext';
import { FixtureBanner } from '../app/App';
import { Stepper } from '../app/Stepper';
import { CatchCard } from '../components/CatchCard';
import { Code } from '../components/Code';
import { StampContext } from '../components/context';
import { Evidence } from '../components/Evidence';
import { Funnel } from '../components/Funnel';
import { KeyHint } from '../components/KeyHint';
import { ModelSaw } from '../components/ModelSaw';
import { Num } from '../components/Provenance';
import { TierBadge } from '../components/TierBadge';
import { OutcomeView, ValueView } from '../components/ValueView';
import { CAND3_GOAL, catchFixture } from '../fixtures/catch';
import { AVERAGE_SOURCE, refusedFixture } from '../fixtures/refused';
import { callById, nForCandidate, paramNames } from '../lib/facts';
import { stampOf } from '../lib/provenance';
import { SCREENS } from '../screens';
import { STAGES, createStore } from '../store';

export function Gallery() {
  const s = replayEvents(catchFixture.events);
  const refused = replayEvents(refusedFixture.events);
  const names = paramNames(s);
  const cands = s.optimize.candidates;
  const caught = cands.find((c) => c.outcome === 'rejected')!;
  const proved = cands.find((c) => c.outcome === 'incumbent')!;
  const fnp = cands.find((c) => c.outcome === 'faster-not-proved')!;
  const noReason: CandidateRecord = { ...caught, rejection: { ...caught.rejection!, reason: '' } };
  const proofFailed: CandidateRecord = {
    ...fnp,
    outcome: 'rejected',
    speedup: null,
    stages: fnp.stages.map((x) => (x.stage === 'benchmark' ? { ...x, status: 'skipped' as const, ms: 0, summary: 'Not run' } : x)),
    rejection: {
      stage: 'proof',
      kind: 'proof-failed',
      reason: 'Lean could not carry the two-step loop invariant through the final odd step.',
      theorem: 'theorem cand3_meets_spec (n : Int) (h : Model.fib_pre n = true) (h₀ : 0 ≤ n) :\n    Cand3.fib n = Spec.spec n',
      goal: CAND3_GOAL,
    },
  };
  const store = createStore();
  store.reset(catchFixture.events);
  const adapter = new ReplayAdapter(catchFixture.events, { label: catchFixture.title, fixture: true });
  const refusal = refused.translation && !refused.translation.ok ? refused.translation.refusal : null;

  return (
    <AppContext.Provider value={{ store, adapter }}>
      <StampContext.Provider value={stampOf(s)}>
        <div class="shell gallery">
          <FixtureBanner title="Component gallery" />
          <h1>Component gallery</h1>
          <p class="muted">Every shared component, then the whole fixture session. Press Tab to walk the focus order.</p>

          <section>
            <h2>CatchCard</h2>
            <p class="gallery-note">SMT stage catches a faster candidate (reason given):</p>
            <CatchCard candidate={caught} params={names} modelChecked={nForCandidate(s, caught)} call={callById(s, caught.callId)} openWhy />
            <p class="gallery-note" style={{ marginTop: 'var(--s5)' }}>
              Same catch, no reason recorded (derived from the counterexample):
            </p>
            <CatchCard candidate={noReason} params={names} modelChecked={nForCandidate(s, caught)} call={callById(s, caught.callId)} />
            <p class="gallery-note" style={{ marginTop: 'var(--s5)' }}>
              Proof failure (no counterexample, not benchmarked):
            </p>
            <CatchCard candidate={proofFailed} params={names} modelChecked={nForCandidate(s, fnp)} call={callById(s, fnp.callId)} openWhy />
          </section>

          <section>
            <h2>TierBadge</h2>
            <div class="stack">
              {TIER_ORDER.map((t) => (
                <div key={t}>
                  <TierBadge tier={t} n={1000} k={6} />
                </div>
              ))}
              <div>
                <TierBadge tier="proved" n={null} />
              </div>
            </div>
          </section>

          <section>
            <h2>Evidence</h2>
            <div class="stack">
              <Evidence state={s} candidate={proved} />
              <Evidence state={s} candidate={fnp} />
            </div>
          </section>

          <section>
            <h2>Funnel</h2>
            <div class="stack">
              <Funnel stages={proved.stages} />
              <Funnel stages={caught.stages} />
              <Funnel stages={[{ stage: 'compile', status: 'pass', ms: 401, summary: 'Compiled' }, { stage: 'purity', status: 'running', ms: 0, summary: '' }]} />
            </div>
          </section>

          <section>
            <h2>ModelSaw</h2>
            <ModelSaw call={callById(s, 1)} what="the spec proposal" />
            <ModelSaw call={null} what="the Lean model (deterministic translator)" />
          </section>

          <section>
            <h2>Code</h2>
            <div class="stack">
              {refusal && <Code text={AVERAGE_SOURCE} lang="ts" mark={refusal.span} label="Refused source" caption={refusal.reason} />}
              <Code text={s.agreement?.specLean ?? ''} lang="lean" label="Spec" />
            </div>
          </section>

          <section>
            <h2>ValueView</h2>
            <div class="kv">
              <span class="muted">int</span> <ValueView v={-9007199254740992} />
              <span class="muted">string</span> <ValueView v={'a "quoted" ü'} />
              <span class="muted">option none</span> <ValueView v={null} />
              <span class="muted">array</span> <ValueView v={[1, [2, 3], []]} />
              <span class="muted">record</span> <ValueView v={{ name: 'x', tags: ['a'], ok: true }} />
              <span class="muted">throw</span> <OutcomeView o={{ tag: 'throw', message: 'empty input' }} />
              <span class="muted">fault</span> <OutcomeView o={{ tag: 'fault', detail: 'timeout after 2,000 ms' }} />
            </div>
          </section>

          <section>
            <h2>KeyHint and Provenance</h2>
            <p>
              <KeyHint keys={['←', '[']} /> previous · <KeyHint keys="?" /> keys · a number with provenance:{' '}
              <Num what="Example: baseline median">61.4 ns/call</Num>
            </p>
          </section>

          <section>
            <h2>Stepper</h2>
            <Stepper current="optimize" shown="prove" onGo={() => {}} />
          </section>

          <section>
            <h2>The whole session (fixture “catch”)</h2>
            {STAGES.map((st) => {
              const Screen = SCREENS[st.id];
              return (
                <div key={st.id} style={{ marginTop: 'var(--s7)' }}>
                  <h2 style={{ marginBottom: 'var(--s4)' }}>{st.label}</h2>
                  <Screen />
                </div>
              );
            })}
          </section>
        </div>
      </StampContext.Provider>
    </AppContext.Provider>
  );
}
