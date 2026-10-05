/** Typeahead over the exported functions of the repository. Pure, so the ranking is tested without a DOM. */
import type { FileEntry } from '../../actions';

export interface FnHit {
  path: string;
  name: string;
  line: number;
  hasJsDoc: boolean;
  /** Character indexes in `name` that matched, for emphasis. */
  nameHits: number[];
}

/** Lower is better. null: no match. */
function rank(q: string, name: string, path: string): { r: number; hits: number[] } | null {
  const n = name.toLowerCase();
  const p = path.toLowerCase();
  if (!q) return { r: 0, hits: [] };
  const range = (from: number) => Array.from({ length: q.length }, (_, i) => from + i);
  if (n === q) return { r: 0, hits: range(0) };
  if (n.startsWith(q)) return { r: 1, hits: range(0) };
  const i = n.indexOf(q);
  if (i >= 0) return { r: 2, hits: range(i) };
  // "fib.ts fib" or "math/fib": the query names the file, optionally followed by the function.
  const parts = q.split(/\s+/).filter(Boolean);
  if (parts.length > 1 && parts.every((x) => p.includes(x) || n.includes(x))) return { r: 3, hits: [] };
  if (p.includes(q)) return { r: 4, hits: [] };
  // Subsequence on the name: "fbn" finds "fibonacci".
  const hits: number[] = [];
  let j = 0;
  for (let k = 0; k < n.length && j < q.length; k++) if (n[k] === q[j]) (hits.push(k), j++);
  if (j === q.length) return { r: 5, hits };
  return null;
}

/** Functions matching `query`, best first; ties keep repository order (path, then line). */
export function matchFunctions(files: FileEntry[], query: string, limit = 50): { hits: FnHit[]; total: number } {
  const q = query.trim().toLowerCase();
  const all: Array<FnHit & { r: number; order: number }> = [];
  let order = 0;
  const sorted = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  for (const f of sorted) {
    for (const fn of [...f.functions].sort((a, b) => a.line - b.line)) {
      const m = rank(q, fn.name, f.path);
      order++;
      if (m) all.push({ path: f.path, name: fn.name, line: fn.line, hasJsDoc: fn.hasJsDoc, nameHits: m.hits, r: m.r, order });
    }
  }
  all.sort((a, b) => a.r - b.r || a.order - b.order);
  return { hits: all.slice(0, limit).map(({ r: _r, order: _o, ...h }) => h), total: all.length };
}

/** The exported function name a pasted snippet declares, if the snippet makes it obvious. */
export function pastedName(source: string): string | null {
  const m = /\bexport\s+(?:default\s+)?function\s+([A-Za-z_$][\w$]*)/.exec(source) ?? /\bfunction\s+([A-Za-z_$][\w$]*)/.exec(source);
  return m ? m[1]! : null;
}
