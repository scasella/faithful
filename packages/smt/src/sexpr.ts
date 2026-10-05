/**
 * Reading Z3's answers: the status lines and `get-value` responses of a script with one or more `(check-sat)`.
 */
import type { SmtResult } from './z3.js';
import type { ModelValue } from './values.js';

export type SExpr = string | SExpr[];

/** Parse every top-level item of `text` (atoms and lists; string literals kept whole, quotes included). */
export function parseSExprs(text: string): SExpr[] {
  const out: SExpr[] = [];
  const stack: SExpr[][] = [];
  let i = 0;
  const push = (x: SExpr): void => {
    if (stack.length) stack[stack.length - 1]!.push(x);
    else out.push(x);
  };
  while (i < text.length) {
    const c = text[i]!;
    if (c === '(') {
      stack.push([]);
      i++;
    } else if (c === ')') {
      const top = stack.pop();
      if (!top) throw new Error('unbalanced ) in solver output');
      push(top);
      i++;
    } else if (/\s/.test(c)) {
      i++;
    } else if (c === '"') {
      let j = i + 1;
      while (j < text.length) {
        if (text[j] === '"') {
          if (text[j + 1] === '"') j += 2;
          else break;
        } else j++;
      }
      push(text.slice(i, j + 1));
      i = j + 1;
    } else if (c === '|') {
      const j = text.indexOf('|', i + 1);
      push(text.slice(i, j + 1));
      i = j + 1;
    } else {
      let j = i;
      while (j < text.length && !/[\s()]/.test(text[j]!)) j++;
      push(text.slice(i, j));
      i = j;
    }
  }
  if (stack.length) throw new Error('unbalanced ( in solver output');
  return out;
}

/** The full transcript of a driver result (the driver splits off the first status line). */
export function transcript(r: SmtResult): string {
  return r.status === 'sat' || r.status === 'unsat' || r.status === 'unknown' ? `${r.status}\n${r.output}` : r.output;
}

/** An Int or Bool model value: `5`, `(- 5)`, `true`, `false`. */
export function modelValue(x: SExpr): ModelValue {
  if (x === 'true') return true;
  if (x === 'false') return false;
  if (typeof x === 'string' && /^\d+$/.test(x)) return BigInt(x);
  if (Array.isArray(x) && x.length === 2 && x[0] === '-' && typeof x[1] === 'string' && /^\d+$/.test(x[1])) return -BigInt(x[1]);
  throw new Error(`unexpected model value ${JSON.stringify(x)}`);
}

export interface Answer {
  status: 'sat' | 'unsat' | 'unknown';
  /** Values of the `get-value` that followed this check, in request order (absent when none followed or unsat). */
  values?: ModelValue[];
}

/**
 * Split a transcript into one answer per `(check-sat)`. A `get-value` response is the list that follows a status.
 * Any `(error ...)` item is returned in `errors` (the driver keeps going after an error; callers must never treat an
 * errored script as an answer). `(error "... model is not available")` after `unsat` is expected and ignored.
 */
export function readAnswers(text: string): { answers: Answer[]; errors: string[] } {
  const items = parseSExprs(text);
  const answers: Answer[] = [];
  const errors: string[] = [];
  for (const it of items) {
    if (it === 'sat' || it === 'unsat' || it === 'unknown') {
      answers.push({ status: it });
    } else if (Array.isArray(it) && it[0] === 'error') {
      const msg = String(it[1] ?? '');
      const last = answers[answers.length - 1];
      if (last && last.status !== 'sat' && /model is not available/.test(msg)) continue;
      errors.push(msg);
    } else if (Array.isArray(it) && answers.length && it.every((p) => Array.isArray(p) && p.length === 2)) {
      const last = answers[answers.length - 1]!;
      last.values = (it as SExpr[][]).map((p) => modelValue(p[1]!));
    } else if (Array.isArray(it) && it.length === 0 && answers.length) {
      answers[answers.length - 1]!.values = [];
    }
  }
  return { answers, errors };
}
