/**
 * Reasons written by the translator and the checks mark code with backticks (`sum / xs.length`). Split such text into
 * plain and code parts so the page renders <code> instead of literal backticks. An unpaired backtick stays as text.
 */
export interface InlinePart {
  code: boolean;
  text: string;
}

export function splitInlineCode(text: string): InlinePart[] {
  const out: InlinePart[] = [];
  const re = /`([^`\n]+)`/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > last) out.push({ code: false, text: text.slice(last, m.index) });
    out.push({ code: true, text: m[1]! });
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push({ code: false, text: text.slice(last) });
  return out;
}
