import { describe, expect, it } from 'vitest';
import { reduce, initialState } from './reduce.js';
import { testedExtractWords, testedIncludedWords, testedLoadFailure, testedLoadWords, testedNoInputsWords } from './tested.js';

describe('Tested tier load problems in plain words', () => {
  it('a value import: the module, its position, and why the sandbox needs a self-contained file', () => {
    expect(testedLoadWords('browserZ3', 'line 7, column 1: import declarations are not allowed: the function must be self-contained')).toBe(
      'browserZ3 cannot run on its own: its file imports another module (line 7, column 1). The Tested tier runs the function in an isolated sandbox, so it needs a self-contained file.',
    );
  });

  it('the other module forms, a syntax error, and a load failure without a position', () => {
    expect(testedLoadWords('f', 'line 2, column 3: dynamic import() is not allowed')).toContain('loads another module with import() (line 2, column 3)');
    expect(testedLoadWords('f', 'line 1, column 1: re-exports from another module are not allowed')).toContain('re-exports from another module');
    expect(testedLoadWords('f', "line 4, column 9: ')' expected.")).toBe(
      "f cannot run on its own: its file does not compile by itself (line 4, column 9: ')' expected). The Tested tier runs the function in an isolated sandbox, so it needs a self-contained file.",
    );
    expect(testedLoadWords('f', 'window is not defined')).toBe('f cannot run on its own: its file did not load in the isolated sandbox (window is not defined). The Tested tier needs a file that loads by itself.');
  });

  it('top-level code that fails when the worker evaluates the file: ambient access, a throw, a timeout', () => {
    expect(testedLoadWords('f', 'InvariantViolation: candidate used Date.now')).toBe(
      'f cannot run on its own: code at the top level of its file uses Date.now when the file loads. The Tested tier runs the function in an isolated sandbox, so its file must load there without side effects.',
    );
    expect(testedLoadWords('f', 'impure at load: process')).toContain('code at the top level of its file uses process when the file loads.');
    expect(testedLoadWords('f', 'Error: boom')).toBe(
      'f cannot run on its own: code at the top level of its file throws when the file loads (Error: boom). The Tested tier runs the function in an isolated sandbox, so its file must load there without side effects.',
    );
    expect(testedLoadWords('f', 'ReferenceError: window is not defined.')).toContain('throws when the file loads (ReferenceError: window is not defined).');
    expect(testedLoadWords('f', 'timeout while evaluating the source')).toContain('the code at the top level of its file did not finish loading.');
    expect(testedLoadFailure('f', 'calibration: the original did not load: InvariantViolation: candidate used console')).toContain('uses console when the file loads');
  });

  it('recognises the run error "the original did not load", and nothing else', () => {
    const msg = 'calibration: the original did not load: line 7, column 1: import declarations are not allowed: the function must be self-contained';
    expect(testedLoadFailure('browserZ3', msg)).toMatch(/^browserZ3 cannot run on its own: its file imports another module \(line 7, column 1\)\./);
    expect(testedLoadFailure('f', 'calibration: the original did not load')).toBe(
      'f cannot run on its own: its file did not load in the isolated sandbox. The Tested tier needs a file that loads by itself.',
    );
    expect(testedLoadFailure('f', 'the model call failed: timeout')).toBeNull();
  });
});

describe('Tested tier with an extracted original', () => {
  it('an extraction refusal in plain words, with its position once', () => {
    expect(testedExtractWords('f', { reason: "it uses clamp, imported from './util'", line: 3, column: 10 })).toBe(
      "f cannot run on its own: it uses clamp, imported from './util' (line 3, column 10). The Tested tier runs the function in an isolated sandbox together with only the declarations it uses from its own file.",
    );
    // the soundness guard already names its line: not repeated
    expect(testedExtractWords('get', { reason: 'module-level code outside the function (line 2) changes counter, which the function reads', line: 2, column: 1 })).toBe(
      'get cannot run on its own: module-level code outside the function (line 2) changes counter, which the function reads. The Tested tier runs the function in an isolated sandbox together with only the declarations it uses from its own file.',
    );
  });

  it('load problems of an extracted unit talk about the declarations it uses, not the whole file', () => {
    expect(testedLoadWords('f', 'impure at load: Date.now', 'extracted')).toBe(
      'f cannot run on its own: a declaration it uses from its file uses Date.now when the file loads. The Tested tier runs the function in an isolated sandbox together with the declarations it uses from its file, so those must load there without side effects.',
    );
    expect(testedLoadWords('f', "line 70, column 22: Cannot find name 'Worker'.", 'extracted')).toBe(
      "f cannot run on its own: it and the declarations it uses do not compile by themselves (line 70, column 22: Cannot find name 'Worker'). The Tested tier runs the function in an isolated sandbox together with only the declarations it uses from its own file.",
    );
    expect(testedLoadFailure('f', 'calibration: the original did not load: Error: boom', 'extracted')).toContain('a declaration it uses from its file throws when the file loads (Error: boom)');
    expect(testedNoInputsWords('p', 50, 'faults')).toBe('p cannot be tested: it failed or took longer than 100 ms on each of the first 50 inputs generated from its signature (first: faults), so there is nothing to compare a faster version with.');
  });

  it('what ran as the original, and the reducer keeps it (additive: older events have neither field)', () => {
    expect(testedIncludedWords({ original: 'extracted', included: ['A', 'B'] })).toBe('Ran the function together with: A, B from the same file; the rest of the file (imports and other code) was not loaded.');
    expect(testedIncludedWords({ original: 'extracted', included: [] })).toBe('Ran the function by itself: it uses no other declarations from its file; the rest of the file (imports and other code) was not loaded.');
    expect(testedIncludedWords({ original: 'file' })).toBe('Ran the function with its whole file loaded.');
    expect(testedIncludedWords({})).toBeNull();
    const refusal = { code: 'float', reason: 'r', span: { line: 1, column: 1, start: 0, end: 1 } } as never;
    const ev = { kind: 'tested.started' as const, refusal, signature: 'f()', specials: false, at: 't' };
    expect(reduce(initialState(), { ...ev, original: 'extracted', included: ['A'] }).tested).toMatchObject({ original: 'extracted', included: ['A'] });
    const old = reduce(initialState(), ev).tested!;
    expect('original' in old || 'included' in old).toBe(false);
  });
});
