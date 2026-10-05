import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { liveInputsOf, validateRecording } from './recording';

const devSample = JSON.parse(readFileSync(new URL('../../public/recordings/dev-sample.json', import.meta.url), 'utf8'));

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
