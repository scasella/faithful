/**
 * Plain words for "the Tested tier cannot run this function", shared by the server's preflight
 * (`SessionRuntime.testedBlocker`, `GET /api/tested/check`) and the UI, which says the same sentence when a Tested run
 * failed because the original did not load in the sandbox (a deterministic failure: trying again cannot help).
 *
 * Input: a `prepareSource` problem (packages/engine/src/sandbox/source.ts), `line N, column M: <message>`, or an error
 * the sandbox worker reports when the file's top-level code fails at load (ambient access, a throw, a timeout). Output: one or two sentences without internals.
 */

/** What `calibrateSignatureDistribution` (packages/cli/src/flow/tested.ts) prefixes a load failure of the original with. */
export const ORIGINAL_DID_NOT_LOAD = 'the original did not load: ';

const SANDBOX = 'The Tested tier runs the function in an isolated sandbox, so it needs a self-contained file.';
const LOADS = 'The Tested tier runs the function in an isolated sandbox, so its file must load there without side effects.';

/** `moduleProblems` messages, by a stable prefix, in plain words. */
const MODULE_WORDS: Array<[prefix: string, words: string]> = [
  ['import declarations are not allowed', 'its file imports another module'],
  ['re-exports from another module', 'its file re-exports from another module'],
  ['`export =`', 'its file exports an expression (`export =` or `export default` of a value)'],
  ['dynamic import()', 'its file loads another module with import()'],
  ['import.meta', 'its file uses import.meta'],
];

/**
 * Which original a Tested run loads: `'extracted'` is the function plus only the module-level declarations it uses
 * (packages/engine/src/sandbox/extract.ts); `'file'` is the whole file (recordings made before extraction, and files
 * where extraction refused but the whole file loads).
 */
export type TestedScope = 'extracted' | 'file';

/** The sentence for one load problem of the function's file (as `prepareSource` or the sandbox reports it). */
export function testedLoadWords(fn: string, problem: string, scope: TestedScope = 'file'): string {
  const m = /^line (\d+), column (\d+): ([\s\S]*)$/.exec(problem.trim());
  const at = m ? `line ${m[1]}, column ${m[2]}` : null;
  const msg = (m ? m[3]! : problem).trim();
  const unit = scope === 'extracted';
  const top = unit ? 'a declaration it uses from its file' : 'code at the top level of its file';
  const loads = unit ? UNIT_LOADS : LOADS;
  if (!msg) return `${fn} cannot run on its own: its file did not load in the isolated sandbox. The Tested tier needs a file that loads by itself.`;
  const mod = MODULE_WORDS.find(([p]) => msg.startsWith(p));
  if (mod) return `${fn} cannot run on its own: ${mod[1]}${at ? ` (${at})` : ''}. ${SANDBOX}`;
  if (at) {
    const what = unit ? 'it and the declarations it uses do not compile by themselves' : 'its file does not compile by itself';
    return `${fn} cannot run on its own: ${what} (${at}: ${msg.replace(/\.$/, '')}). ${unit ? UNIT_SANDBOX : SANDBOX}`;
  }
  // the worker evaluated the file and its top-level code failed (packages/engine/src/sandbox/worker.ts 'load')
  const ambient = /^(?:InvariantViolation: candidate used |impure at load: )([\s\S]+)$/.exec(msg);
  if (ambient) return `${fn} cannot run on its own: ${top} uses ${ambient[1]!.trim()} when the file loads. ${loads}`;
  if (msg === 'timeout while evaluating the source') return `${fn} cannot run on its own: ${unit ? 'a declaration it uses from its file' : 'the code at the top level of its file'} did not finish loading. ${loads}`;
  const thrown = /^(\w*Error): ([\s\S]*)$/.exec(msg);
  if (thrown) return `${fn} cannot run on its own: ${top} throws when the file loads (${thrown[1]}: ${thrown[2]!.trim().replace(/\.$/, '')}). ${loads}`;
  return `${fn} cannot run on its own: its file did not load in the isolated sandbox (${msg.replace(/\.$/, '')}). The Tested tier needs a file that loads by itself.`;
}

const UNIT_SANDBOX = 'The Tested tier runs the function in an isolated sandbox together with only the declarations it uses from its own file.';
const UNIT_LOADS = 'The Tested tier runs the function in an isolated sandbox together with the declarations it uses from its file, so those must load there without side effects.';

/**
 * The sentence for an extraction refusal (`extractUnit` in packages/engine/src/sandbox/extract.ts returns
 * `{ ok: false, reason, line?, column? }`; its reasons are already plain words).
 */
export function testedExtractWords(fn: string, r: { reason: string; line?: number; column?: number }): string {
  const reason = r.reason.trim().replace(/\.$/, '');
  const at = r.line !== undefined && !/\(line \d+\)/.test(reason) ? ` (line ${r.line}${r.column !== undefined ? `, column ${r.column}` : ''})` : '';
  return `${fn} cannot run on its own: ${reason}${at}. ${UNIT_SANDBOX}`;
}

/** The sentence when the original fails (or is too slow) on every input of the preflight sample. */
export function testedNoInputsWords(fn: string, n: number, first: string | null): string {
  return `${fn} cannot be tested: it failed or took longer than 100 ms on each of the first ${n} inputs generated from its signature${first ? ` (first: ${first})` : ''}, so there is nothing to compare a faster version with.`;
}

/** Each disclosure of an extracted original as a sentence ("Caveat: other code in this file ... ."). */
export function testedCaveatWords(t: { caveats?: string[] } | null | undefined): string[] {
  return (t?.caveats ?? []).map((c) => `Caveat: ${c.trim().replace(/\.$/, '')}.`);
}

/**
 * "Ran the function together with: live (line 70) from the same file." for the declarations an extracted original
 * included; null when there were none or the run loaded the whole file (`tested.started` without `included`).
 */
export function testedIncludedWords(t: { original?: TestedScope; included?: string[] } | null | undefined): string | null {
  if (!t) return null;
  if (t.original === 'file') return 'Ran the function with its whole file loaded.';
  if (!t.included) return null;
  if (t.included.length === 0) return 'Ran the function by itself: it uses no other declarations from its file; the rest of the file (imports and other code) was not loaded.';
  return `Ran the function together with: ${t.included.join(', ')} from the same file; the rest of the file (imports and other code) was not loaded.`;
}

/**
 * When a Tested run's error says the original did not load, the plain sentence for it; otherwise null (a failure that
 * may not happen again, where "Try again" is a fair offer).
 */
export function testedLoadFailure(fn: string, message: string, scope: TestedScope = 'file'): string | null {
  const marker = ORIGINAL_DID_NOT_LOAD.replace(/: $/, '');
  const i = message.indexOf(marker);
  if (i < 0) return null;
  return testedLoadWords(fn, message.slice(i + marker.length).replace(/^:\s*/, ''), scope);
}
