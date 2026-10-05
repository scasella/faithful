/**
 * Small regex tokenizers for TypeScript and Lean. Display only: they color, they never interpret. Tokens cover the
 * input exactly (concatenating token texts returns the input), which the tests check, so offsets stay valid for spans.
 */
export type Lang = 'ts' | 'lean' | 'text';
export type TokKind = 'kw' | 'str' | 'num' | 'com' | 'type' | 'op' | 'plain' | 'goal';
export interface Tok {
  kind: TokKind;
  text: string;
}

const TS_KW =
  'export|function|return|const|let|var|if|else|for|while|of|in|new|throw|true|false|null|undefined|typeof|number|string|boolean|import|from|type|interface|break|continue|do|switch|case|default';
const LEAN_KW =
  'def|theorem|lemma|example|by|fun|match|with|if|then|else|let|have|show|from|import|namespace|end|open|section|where|termination_by|decreasing_by|induction|cases|intro|intros|simp|omega|exact|rfl|rw|unfold|decide|native_decide|norm_num|linarith|ring|calc|at|using|generalizing|structure|instance|private|partial|true|false|sorry';

interface Rule {
  re: RegExp;
  kind: TokKind;
}

function rules(lang: Lang): Rule[] {
  if (lang === 'ts')
    return [
      { re: /\/\/[^\n]*|\/\*[\s\S]*?\*\//y, kind: 'com' },
      { re: /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/y, kind: 'str' },
      { re: /\b\d[\d_]*(?:\.\d+)?\b/y, kind: 'num' },
      { re: new RegExp(`\\b(?:${TS_KW})\\b`, 'y'), kind: 'kw' },
      { re: /\b[A-Z][A-Za-z0-9_]*\b/y, kind: 'type' },
      { re: /[A-Za-z_$][\w$]*/y, kind: 'plain' },
      { re: /[=<>!+\-*/%&|?:]+/y, kind: 'op' },
    ];
  if (lang === 'lean')
    return [
      { re: /--[^\n]*|\/-[\s\S]*?-\//y, kind: 'com' },
      { re: /"(?:[^"\\\n]|\\.)*"/y, kind: 'str' },
      { re: /⊢/y, kind: 'goal' },
      { re: /\b\d+\b/y, kind: 'num' },
      { re: new RegExp(`\\b(?:${LEAN_KW})\\b`, 'y'), kind: 'kw' },
      { re: /\b[A-Z][\w'.]*/y, kind: 'type' },
      { re: /[A-Za-z_][\w'.]*/y, kind: 'plain' },
      { re: /[=<>≤≥≠→←↔∀∃¬∧∨:+\-*/%|]+/y, kind: 'op' },
    ];
  return [];
}

export function tokenize(text: string, lang: Lang): Tok[] {
  const rs = rules(lang);
  const out: Tok[] = [];
  let i = 0;
  let plain = '';
  const flush = () => {
    if (plain) out.push({ kind: 'plain', text: plain });
    plain = '';
  };
  while (i < text.length) {
    let hit: Tok | null = null;
    for (const r of rs) {
      r.re.lastIndex = i;
      const m = r.re.exec(text);
      if (m && m[0].length > 0) {
        hit = { kind: r.kind, text: m[0] };
        break;
      }
    }
    if (hit && hit.kind !== 'plain') {
      flush();
      out.push(hit);
      i += hit.text.length;
    } else if (hit) {
      plain += hit.text;
      i += hit.text.length;
    } else {
      plain += text[i];
      i++;
    }
  }
  flush();
  return out;
}

export interface Seg {
  kind: TokKind;
  text: string;
  /** Inside the highlighted span (e.g. the refused expression). */
  marked: boolean;
}

/**
 * Split tokens into lines, marking characters in [mark.start, mark.end) (UTF-16 offsets into the same text).
 */
export function toLines(tokens: Tok[], mark?: { start: number; end: number } | null): Seg[][] {
  const lines: Seg[][] = [[]];
  let off = 0;
  const push = (kind: TokKind, text: string, marked: boolean) => {
    const parts = text.split('\n');
    parts.forEach((p, i) => {
      if (i > 0) lines.push([]);
      if (p) lines[lines.length - 1]!.push({ kind, text: p, marked });
    });
  };
  for (const t of tokens) {
    const s = off;
    const e = off + t.text.length;
    off = e;
    if (!mark || e <= mark.start || s >= mark.end) {
      push(t.kind, t.text, false);
      continue;
    }
    const a = Math.max(mark.start, s) - s;
    const b = Math.min(mark.end, e) - s;
    if (a > 0) push(t.kind, t.text.slice(0, a), false);
    push(t.kind, t.text.slice(a, b), true);
    if (b < t.text.length) push(t.kind, t.text.slice(b), false);
  }
  return lines;
}
