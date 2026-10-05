/** Pure helpers for the Translate screen: refusal titles, source excerpts with exact spans, type names. */
import type { RefusalCode, Span, Ty } from '@faithful/translate';

/** A short plain-words title per refusal code. The full reason always comes from the translator (Refusal.reason). */
export const REFUSAL_TITLE: Record<RefusalCode, string> = {
  float: 'Arithmetic that is not provably integer-valued',
  regex: 'Regular expressions',
  date: 'Dates and clocks',
  'map-set': 'Map or Set',
  dictionary: 'Objects used as dictionaries',
  nan: 'NaN or Infinity',
  io: 'Input or output',
  random: 'Randomness',
  async: 'Asynchronous code',
  generic: 'Generic type parameters',
  bitwise: 'Bitwise operators',
  this: '`this`',
  'mutable-capture': 'Captured mutable state',
  'no-termination-measure': 'A loop or recursion with no termination measure the translator can find',
  'unsupported-type': 'A type outside the subset',
  'unsupported-syntax': 'Syntax outside the subset',
  'unsupported-library': 'A library call outside the subset',
  'missing-annotation': 'A missing type annotation',
  'non-bmp': 'Text outside the Basic Multilingual Plane',
  'not-found': 'Function not found among the exports',
};

export interface Excerpt {
  /** The source lines that contain the span (whole lines). */
  text: string;
  /** The span, as offsets into `text`. */
  mark: { start: number; end: number };
  /** Line number of the first line of `text`. */
  from: number;
}

/** The whole lines of `source` that contain `span`, with the span re-based onto them. Offsets are UTF-16, like Span. */
export function lineExcerpt(source: string, span: Span, context = 0): Excerpt {
  const start = Math.max(0, Math.min(span.start, source.length));
  const end = Math.max(start, Math.min(span.end, source.length));
  let a = source.lastIndexOf('\n', start - 1) + 1;
  let from = source.slice(0, a).split('\n').length;
  for (let i = 0; i < context && a > 0; i++) {
    a = source.lastIndexOf('\n', a - 2) + 1;
    from--;
  }
  let b = source.indexOf('\n', Math.max(end - 1, start));
  if (b < 0) b = source.length;
  for (let i = 0; i < context && b < source.length; i++) {
    const nb = source.indexOf('\n', b + 1);
    b = nb < 0 ? source.length : nb;
  }
  return { text: source.slice(a, b), mark: { start: start - a, end: end - a }, from };
}

/** "integer", "array of string", "{ x: integer, y: integer }", "integer or nothing". */
export function tyWords(t: Ty): string {
  switch (t.k) {
    case 'int':
      return 'integer';
    case 'bool':
      return 'boolean';
    case 'string':
      return 'string';
    case 'array':
      return `array of ${tyWords(t.elem)}`;
    case 'tuple':
      return `[${t.elems.map(tyWords).join(', ')}]`;
    case 'record':
      return `{ ${t.fields.map((f) => `${f.name}: ${tyWords(f.ty)}`).join(', ')} }`;
    case 'option':
      return `${tyWords(t.inner)} or nothing`;
  }
}
