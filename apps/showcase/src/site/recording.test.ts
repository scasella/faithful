import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { RECORDING_ORDER, carveOutRemainder, liveInputsOf, orderHeads, specFaultRuled, validateRecording, type RecordingHead } from './recording';

const devSample = JSON.parse(readFileSync(new URL('../../public/recordings/dev-sample.json', import.meta.url), 'utf8'));
const load = (name: string) =>
  validateRecording(JSON.parse(readFileSync(new URL(`../../public/recordings/${name}.json`, import.meta.url), 'utf8')), `${name}.json`);

describe('recordings', () => {
  it('the dev sample is a schema-1 recording, marked as a dev sample, copied from a real session log', () => {
    const rec = validateRecording(devSample, 'dev-sample.json');
    expect(rec.notes).toMatch(/^DEV SAMPLE/);
    const log = readFileSync(new URL('../../../../docs/measurements/2026-10-05-proofs-final-heldout/sessions/numeric/clamp/events.jsonl', import.meta.url), 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    expect(rec.stampedEvents).toEqual(log);
  });
  it('reads the translation and agreement through the session reducer', () => {
    const li = liveInputsOf(validateRecording(devSample, 'dev-sample.json'));
    expect(li.translation?.fnName).toBe('clamp');
    expect(li.throwChoice).toBe('precondition');
    expect(li.candidates).toEqual([]);
  });
  it('refuses a file that is not a recording', () => {
    expect(() => validateRecording({ schema: 2 }, 'x')).toThrow(/schema/);
    expect(() => validateRecording({ ...devSample, stampedEvents: devSample.stampedEvents.slice(1) }, 'x')).toThrow(/session.started/);
  });
});

describe('recording order and cautions', () => {
  it('clamp is the default, then fibRecursive, then aliquotSum; others follow by name', () => {
    const head = (name: string): RecordingHead => ({ name, file: `recordings/${name}.json`, fn: name, recordedAt: '', notes: '', lean: null });
    const sorted = orderHeads(['aliquotSum', 'clamp', 'dev-sample', 'fibRecursive', 'zz'].map(head)).map((x) => x.name);
    expect(sorted).toEqual(['clamp', 'fibRecursive', 'aliquotSum', 'dev-sample', 'zz']);
    expect(RECORDING_ORDER[0]).toBe('clamp');
  });

  it('aliquotSum: two carve-outs (n != 0, n <= 0), the hand-written remainder note applies, and it predates the spec-fault fix', () => {
    const rec = load('aliquotSum');
    const carve = liveInputsOf(rec).carveOuts;
    expect(carve.map((c) => c.ts)).toEqual(['(n !== 0)', '(n <= 0)']);
    expect(carve.map((c) => c.words)).toEqual([
      'Carved out (known problem in the original): inputs where n is 0 are excluded from everything proved below.',
      'Carved out (known problem in the original): inputs where n is positive are excluded from everything proved below.',
    ]);
    expect(carveOutRemainder('aliquotSum', carve)).toMatch(/n < 0/);
    // the delivered candidate's speedup was measured entirely outside what the carve-outs leave: said, with its numbers
    const li = liveInputsOf(rec);
    expect(li.incumbent?.id).toBe(3);
    expect(carveOutRemainder('aliquotSum', carve, li.incumbent)).toBe(
      'Together they leave only negative n (where the original returns 0): every proof in this recording covers n < 0 and nothing else. ' +
        'The delivered candidate 3’s 1.9× (95% CI 1.9–2.0) was measured on auto: n: integer in [0, n] at n = 1,024, 2,048, 4,096: ' +
        'every one of those inputs has n ≥ 0, which the carve-outs exclude, so that speedup describes no input the proof covers.',
    );
    expect(carveOutRemainder('aliquotSum', carve.slice(0, 1))).toBeNull();
    expect(specFaultRuled(rec)).toBe(true);
  });

  it('clamp and fibRecursive: no carve-outs and no spec fault ruled', () => {
    for (const name of ['clamp', 'fibRecursive']) {
      const rec = load(name);
      expect(liveInputsOf(rec).carveOuts).toEqual([]);
      expect(specFaultRuled(rec)).toBe(false);
      expect(carveOutRemainder(name, [])).toBeNull();
    }
  });
});
