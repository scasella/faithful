import { describe, expect, it } from 'vitest';
import { provedSentence } from '@faithful/core/tiers';
import { CANDIDATE_ITERATIVE, FIB_SOURCE } from '../../fixtures/catch';
import { assertClaimsExact } from '../../test/text';
import { CATCH, indexOf, render } from '../prove/testutil';
import { deliveryCommands, describeFile, hunks, joinPath, lineDiff, notModifiedSentence, unifiedText } from './deliverModel';

describe('diff', () => {
  it('a line diff keeps every line of both sides, in order', () => {
    const ops = lineDiff(FIB_SOURCE, CANDIDATE_ITERATIVE);
    expect(ops.filter((o) => o.kind !== 'add').map((o) => o.text).join('\n') + '\n').toBe(FIB_SOURCE);
    expect(ops.filter((o) => o.kind !== 'del').map((o) => o.text).join('\n') + '\n').toBe(CANDIDATE_ITERATIVE);
    expect(ops.some((o) => o.kind === 'del' && o.text.includes('fib(n - 1) + fib(n - 2)'))).toBe(true);
  });

  it('hunks carry correct unified headers', () => {
    const hs = hunks(lineDiff('a\nb\nc\nd\ne\nf\ng\nh\ni\n', 'a\nb\nc\nd\nX\nf\ng\nh\ni\n'), 1);
    expect(hs).toHaveLength(1);
    expect(hs[0]!.header).toBe('@@ -4,3 +4,3 @@');
    expect(unifiedText(hs, 'a/f', 'b/f')).toBe('--- a/f\n+++ b/f\n@@ -4,3 +4,3 @@\n d\n-e\n+X\n f\n');
    expect(hunks(lineDiff('same\n', 'same\n'))).toEqual([]);
  });
});

describe('files and commands', () => {
  it('describes the five delivered files by name and nothing it does not know', () => {
    for (const f of ['patch.diff', 'spec.md', 'fib.lean', 'fib.provenance.json', 'VERIFY.md']) expect(describeFile(f, 'fib'), f).not.toBeNull();
    expect(describeFile('EVIDENCE.md', 'fib')).toBeNull();
  });

  it('gives exactly the VERIFY.md commands: verify, and git apply only when a change was delivered', () => {
    const d = { dir: '.faithful/fib', files: ['fib.lean', 'patch.diff', 'spec.md', 'fib.provenance.json', 'VERIFY.md'] };
    expect(deliveryCommands(d, true).map((c) => c.cmd)).toEqual(['faithful verify .faithful/fib', 'git apply .faithful/fib/patch.diff']);
    // the server always writes patch.diff; without a delivered change it is a placeholder, so nothing to apply
    expect(deliveryCommands(d, false).map((c) => c.cmd)).toEqual(['faithful verify .faithful/fib']);
    // Tested-only: the differential is promised only when an optimized function was delivered (as VERIFY.md says)
    expect(deliveryCommands(d, true, true, true)[0]!.what).toContain('re-run the differential test against your original');
    expect(deliveryCommands(d, false, true, false)[0]!.what).toBe('Re-check the delivery: recompute the hashes in the provenance file. No optimized function was delivered, so there is no differential to re-run.');
    // a pasted function with a kept candidate: no patch, but the differential is re-run
    expect(deliveryCommands(d, false, true, true).map((c) => c.cmd)).toEqual(['faithful verify .faithful/fib']);
    expect(deliveryCommands(d, false, true, true)[0]!.what).toContain('re-run the differential test');
    expect(describeFile('patch.diff', 'fib', false)).toMatch(/placeholder/);
    expect(joinPath('.faithful/fib/', 'a.lean')).toBe('.faithful/fib/a.lean');
    expect(joinPath('.faithful/fib', '.faithful/fib/a.lean')).toBe('.faithful/fib/a.lean');
  });

  it('says the file was not modified', () => {
    expect(notModifiedSentence('src/math/fib.ts')).toBe('Your file src/math/fib.ts was not modified. The change is a patch; you apply it yourself.');
    expect(notModifiedSentence('')).toMatch(/^Your pasted code was not modified/);
    // nothing delivered to apply: no patch is mentioned
    expect(notModifiedSentence('src/math/fib.ts', false)).toBe('Your file src/math/fib.ts was not modified.');
  });
});

describe('Deliver screen', () => {
  it('shows not-modified, the evidence line with provedSentence, the files, the diff and copyable commands', () => {
    const { text, html } = render(CATCH, 'deliver');
    expect(text).toContain('Your file src/math/fib.ts was not modified.');
    expect(text).toContain('Proved against the agreed spec (Lean 4.34.0, Mathlib 5ed2965).');
    expect(text).toContain(provedSentence(1000));
    for (const f of ['fib.lean', 'patch.diff', 'spec.md', 'fib.provenance.json', 'VERIFY.md']) expect(text).toContain(`.faithful/fib/${f}`);
    expect(text).toContain('Computed in this page from the sources recorded in the session');
    expect(html).toContain('class="dl-diff"');
    expect(text).toContain('faithful verify .faithful/fib');
    expect(text).toContain('git apply .faithful/fib/patch.diff');
    expect(text).not.toContain('--check');
    expect((html.match(/class="copyblock"/g) ?? []).length).toBe(2);
    expect(html).toContain('aria-keyshortcuts="1"');
    // the catch fixture agreed with a carve-out: the speedup says its inputs were not restricted to what the label covers
    expect(text).toContain('without applying the carve-outs, so the speedup may have been measured on inputs the label does not cover');
    assertClaimsExact(text);
  });

  it('a pasted function gets no git apply (there is no file to patch)', () => {
    const evs = CATCH.map((e) => (e.event.kind === 'session.started' ? { ...e, event: { ...e.event, file: '' } } : e));
    const { text } = render(evs, 'deliver');
    expect(text).toContain('Your pasted code was not modified.');
    expect(text).not.toContain('git apply');
  });

  it('before delivery the screen says nothing was delivered (and the Optimize screen holds the action)', () => {
    const evs = CATCH.slice(0, indexOf('deliver.done'));
    const opt = render(evs, 'optimize').text;
    expect(opt).toContain('Write the delivery');
    expect(opt).toContain('Your source file is not modified.');
  });
});
