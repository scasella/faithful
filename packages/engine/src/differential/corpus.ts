/**
 * The translator corpus (`packages/translate/corpus/<class>/<name>.ts`) and its `// @corpus` header lines.
 *
 * Header grammar (as written by the corpus authors; every header line starts with `// @corpus `, in any order):
 *   `// @corpus class=<class> expect=ok|refuse [code=<RefusalCode>]`   exactly one; code required iff expect=refuse
 *   `// @corpus note=<free text>`                                       zero or more
 *   `// @corpus throws`                                                 the function can throw a literal message
 * Anything else after `@corpus` is a malformed header and an error.
 *
 * No sandbox or Lean here: used by the corpus test and by scripts/corpus-report.ts (which runs from dist).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REFUSAL_CODES, listExportedFunctions, type RefusalCode } from '@faithful/translate';

/**
 * expect=ok files the translator refuses although subset v1 admits them: each has an integer measure that strictly
 * decreases and is bounded below, which is what the subset text asks for ("a strictly decreasing integer bounded
 * below" / "self-recursion on a structural or integer measure"). The labels stay; these are translator findings.
 */
export const KNOWN_TRANSLATOR_GAPS: Record<string, { code: RefusalCode; why: string }> = {
  'numeric/gcd': { code: 'no-termination-measure', why: 'measure |b|: |a tmod b| < |b|; the finder only knows p - k, Math.floor(p / k) and slice' },
  'recursive/gcd': { code: 'no-termination-measure', why: 'measure |b| (same function as numeric/gcd)' },
  'array/binarySearch': { code: 'no-termination-measure', why: 'measure hi - lo with lo/hi updated in different branches (interval measure)' },
  'string/isPalindrome': { code: 'no-termination-measure', why: 'measure j - i with i++ and j-- (two loop variables)' },
  'recursive/digitSum': { code: 'no-termination-measure', why: 'measure Math.abs(n) through const m = Math.abs(n); the finder only measures parameters themselves' },
};

export const CORPUS_CLASSES = ['numeric', 'array', 'string', 'recursive', 'refuse'] as const;

export interface CorpusHeader {
  cls: string;
  expect: 'ok' | 'refuse';
  code?: RefusalCode;
  notes: string[];
  throws: boolean;
}

export interface CorpusEntry {
  /** `<class>/<name>` (names repeat across classes, so this is the id). */
  id: string;
  cls: string;
  name: string;
  file: string;
  source: string;
  header: CorpusHeader;
  /** The single exported function's name. */
  fnName: string;
}

export function parseCorpusHeader(source: string, where = 'corpus file'): CorpusHeader {
  let main: { cls: string; expect: 'ok' | 'refuse'; code?: RefusalCode } | undefined;
  const notes: string[] = [];
  let throws = false;
  for (const line of source.split('\n')) {
    const m = /^\/\/ @corpus (.*)$/.exec(line.trimEnd());
    if (!m) continue;
    const body = m[1]!.trim();
    if (body === 'throws') {
      throws = true;
    } else if (body.startsWith('note=')) {
      notes.push(body.slice(5));
    } else if (body.startsWith('class=')) {
      if (main) throw new Error(`${where}: more than one class= header line`);
      const kv: Record<string, string> = {};
      for (const tok of body.split(/\s+/)) {
        const eq = tok.indexOf('=');
        if (eq <= 0) throw new Error(`${where}: malformed header token '${tok}'`);
        kv[tok.slice(0, eq)] = tok.slice(eq + 1);
      }
      const extra = Object.keys(kv).filter((k) => !['class', 'expect', 'code'].includes(k));
      if (extra.length) throw new Error(`${where}: unknown header keys ${extra.join(', ')}`);
      const expect = kv.expect;
      if (expect !== 'ok' && expect !== 'refuse') throw new Error(`${where}: expect must be ok or refuse, got ${expect}`);
      if (expect === 'refuse') {
        if (!kv.code || !(REFUSAL_CODES as readonly string[]).includes(kv.code)) throw new Error(`${where}: expect=refuse needs a valid code=, got ${kv.code}`);
        main = { cls: kv.class!, expect, code: kv.code as RefusalCode };
      } else {
        if (kv.code) throw new Error(`${where}: expect=ok must not carry code=`);
        main = { cls: kv.class!, expect };
      }
    } else {
      throw new Error(`${where}: malformed @corpus line: ${line}`);
    }
  }
  if (!main) throw new Error(`${where}: no '// @corpus class=... expect=...' header`);
  return { ...main, notes, throws };
}

/** Every corpus file, in a stable order (class order above, then file name). */
export function loadCorpus(root: string): CorpusEntry[] {
  const out: CorpusEntry[] = [];
  for (const cls of CORPUS_CLASSES) {
    const dir = join(root, cls);
    const files = readdirSync(dir).filter((f) => f.endsWith('.ts')).sort();
    for (const f of files) {
      const file = join(dir, f);
      const source = readFileSync(file, 'utf8');
      const id = `${cls}/${f.slice(0, -3)}`;
      const header = parseCorpusHeader(source, id);
      if (header.cls !== cls) throw new Error(`${id}: header says class=${header.cls} but the file is in ${cls}/`);
      const exported = listExportedFunctions(source).filter((x) => x.exported);
      if (exported.length !== 1) throw new Error(`${id}: expected exactly one exported function, found ${exported.map((x) => x.name).join(', ') || 'none'}`);
      out.push({ id, cls, name: f.slice(0, -3), file, source, header, fnName: exported[0]!.name });
    }
  }
  return out;
}
