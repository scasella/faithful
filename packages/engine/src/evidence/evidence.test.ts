import { describe, expect, it } from 'vitest';
import { provedSentence, type Stamp } from '@faithful/core';
import { buildEvidenceBlock, buildEvidenceLine, lintEvidenceText, leanVersionOf, mathlibShortOf, type EvidenceInput } from './evidence.js';
import { stamped } from './provenance.js';

const stamp: Stamp = {
  date: '2026-10-04',
  modelId: 'gpt-6-luna',
  toolchain: {
    capturedAt: '2026-10-04T12:00:00.000Z',
    node: 'v25.8.1',
    platform: 'darwin-arm64',
    codex: { version: '0.159.2', model: 'gpt-6-luna', effort: 'low' },
    lean: {
      version: 'Lean (version 4.34.0, arm64-apple-darwin24.6.0, commit abc, Release)',
      toolchain: 'leanprover/lean4:v4.34.0',
      mathlibCommit: '5ed2965256430c3649e86755f9576b54eca72435',
    },
    z3: null,
  },
};
const noLean: Stamp = { ...stamp, toolchain: { ...stamp.toolchain, lean: { version: null, toolchain: null, mathlibCommit: null } } };

describe('buildEvidenceLine', () => {
  it('produces the exact format, followed by provedSentence(N)', () => {
    const block = buildEvidenceBlock({
      stamp,
      proof: { tier: 'proved' },
      bounded: { k: 6 },
      differential: { inputs: 1000 },
      mutation: { caught: 12, total: 12 },
      speed: { ratio: { estimate: 4.2, lo: 3.9, hi: 4.6 }, verdict: 'faster' },
    });
    expect(block.line).toBe(
      'Proved against the agreed spec (Lean 4.34.0, Mathlib 5ed2965). Verified to k=6. 1,000 differential inputs. ' +
        '12 of 12 broken copies caught. 4.2× faster (95% CI 3.9–4.6) on the declared distribution.',
    );
    expect(block.sentence).toBe(provedSentence(1000));
    expect(block.text).toBe(`${block.line} ${provedSentence(1000)}`);
    // `line` alone says Proved without the sentence: consumers must show `text` (or line + sentence).
    expect(lintEvidenceText(block.line)).toContain('says Proved without provedSentence(N)');
    expect(lintEvidenceText(block.text)).toEqual([]);
    expect(buildEvidenceLine({ stamp, proof: { tier: 'proved' }, differential: { inputs: 1000 } })).toBe(
      `Proved against the agreed spec (Lean 4.34.0, Mathlib 5ed2965). 1,000 differential inputs. ${provedSentence(1000)}`,
    );
  });

  it('includes only the pieces whose evidence exists', () => {
    expect(buildEvidenceLine({ stamp, differential: { inputs: 250 } })).toBe('250 differential inputs.');
    expect(buildEvidenceLine({ stamp, mutation: { caught: 7, total: 12 } })).toBe('7 of 12 broken copies caught.');
    expect(buildEvidenceLine({ stamp, bounded: { k: 4 } })).toBe('Verified to k=4.');
    expect(buildEvidenceLine({ stamp })).toBe('Not proved.');
  });

  it('uses the compiler-trust tier label', () => {
    const t = buildEvidenceLine({ stamp, proof: { tier: 'proved-trusting-compiler' }, differential: { inputs: 10 } });
    expect(t.startsWith('Proved (trusting the compiler) against the agreed spec')).toBe(true);
    expect(t.endsWith(provedSentence(10))).toBe(true);
  });

  it('cannot say Proved without the sentence or without measured versions', () => {
    expect(() => buildEvidenceBlock({ stamp, proof: { tier: 'proved' } })).toThrow(/provedSentence/);
    expect(() => buildEvidenceBlock({ stamp: noLean, proof: { tier: 'proved' }, differential: { inputs: 5 } })).toThrow(/Lean version/);
    expect(() => buildEvidenceBlock({ stamp, proof: { tier: 'tested' as 'proved' }, differential: { inputs: 5 } })).toThrow(/not a proof tier/);
  });

  it('says faster only on a faster verdict; slower and overlap are worded without it', () => {
    expect(buildEvidenceLine({ stamp, speed: { ratio: { estimate: 0.5, lo: 0.4, hi: 0.625 }, verdict: 'slower' } })).toBe(
      '2.0× slower (95% CI 1.6–2.5) on the declared distribution.',
    );
    const same = buildEvidenceLine({ stamp, speed: { ratio: { estimate: 1.02, lo: 0.97, hi: 1.08 }, verdict: 'not-distinguished' } });
    expect(same).toBe('No speed difference distinguished on the declared distribution (speed-up 95% CI 1.0–1.1).');
    expect(same.includes('faster')).toBe(false);
  });

  it('rejects impossible numbers', () => {
    expect(() => buildEvidenceLine({ stamp, mutation: { caught: 13, total: 12 } })).toThrow();
    expect(() => buildEvidenceLine({ stamp, differential: { inputs: 1.5 } })).toThrow();
    expect(() => buildEvidenceLine({ stamp, bounded: { k: 0 } })).toThrow();
    expect(() => buildEvidenceLine({ stamp, speed: { ratio: { estimate: 2, lo: 3, hi: 1 }, verdict: 'faster' } })).toThrow();
  });

  it('reads versions from the stamp only', () => {
    expect(leanVersionOf(stamp)).toBe('4.34.0');
    expect(mathlibShortOf(stamp)).toBe('5ed2965');
    expect(leanVersionOf(noLean)).toBeNull();
  });

  it('attaches stamps to reports', () => {
    const r = stamped({ caught: 1, total: 2 }, stamp);
    expect(r.stamp.date).toBe('2026-10-04');
    expect(() => stamped({}, undefined as unknown as Stamp)).toThrow();
  });
});

describe('lint over every string the builder can emit', () => {
  const tiers = [undefined, 'proved', 'proved-trusting-compiler'] as const;
  const ks = [undefined, 1, 6, 100];
  const diffs = [undefined, 0, 1, 1000, 1234567];
  const muts = [undefined, { caught: 0, total: 0 }, { caught: 1, total: 1 }, { caught: 7, total: 12 }, { caught: 12, total: 12 }];
  const speeds = [
    undefined,
    { ratio: { estimate: 4.2, lo: 3.9, hi: 4.6 }, verdict: 'faster' as const },
    { ratio: { estimate: 12.34, lo: 10.01, hi: 15.5 }, verdict: 'faster' as const },
    { ratio: { estimate: 0.21, lo: 0.2, hi: 0.22 }, verdict: 'slower' as const },
    { ratio: { estimate: 1.0, lo: 0.95, hi: 1.05 }, verdict: 'not-distinguished' as const },
  ];

  it('no emitted text has a stray percent, "for all inputs", a score word, or Proved without its sentence', () => {
    let built = 0;
    for (const tier of tiers)
      for (const k of ks)
        for (const n of diffs)
          for (const m of muts)
            for (const s of speeds) {
              const input: EvidenceInput = { stamp };
              if (tier) input.proof = { tier };
              if (k !== undefined) input.bounded = { k };
              if (n !== undefined) input.differential = { inputs: n };
              if (m) input.mutation = m;
              if (s) input.speed = s;
              if (tier && n === undefined) {
                expect(() => buildEvidenceBlock(input)).toThrow();
                continue;
              }
              const b = buildEvidenceBlock(input);
              built++;
              for (const t of [b.text, buildEvidenceLine(input)]) {
                expect(lintEvidenceText(t)).toEqual([]);
                expect(t.includes('%')).toBe(t.includes('95% CI'));
                expect(/for all inputs/i.test(t)).toBe(false);
                if (t.includes('Proved')) expect(t.includes(provedSentence(n!))).toBe(true);
              }
              if (tier) expect(b.sentence).toBe(provedSentence(n!));
              else expect(b.text.includes('Proved')).toBe(false);
            }
    expect(built).toBeGreaterThan(1000);
  });

  it('the lint itself catches each forbidden form', () => {
    expect(lintEvidenceText('Proved against the agreed spec.')).toContain('says Proved without provedSentence(N)');
    expect(lintEvidenceText('Correct for all inputs.')).toContain('says "for all inputs"');
    expect(lintEvidenceText('Coverage 85%.')).toContain('contains a percent sign other than "95% CI"');
    expect(lintEvidenceText('Quality score 9.')).toContain('contains a score, grade or percentage word');
    expect(lintEvidenceText('Grade: A')).toContain('contains a score, grade or percentage word');
    expect(lintEvidenceText(`4.2× faster (95% CI 3.9–4.6). Proved x. ${provedSentence(3)}`)).toEqual([]);
  });
});
