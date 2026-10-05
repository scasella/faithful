/** Test helpers: visible text of rendered HTML, and the claim-vocabulary rules every rendered page must satisfy. */
import { expect } from 'vitest';
import { provedSentence } from '@faithful/core/tiers';

/** Strip tags and decode the few entities preact-render-to-string emits. Keeps text only (no attributes). */
export function visibleText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/g, ' ')
    // inline elements join their text; block-level tags separate it
    .replace(/<\/?(?:span|button|del|b|i|em|strong|mark|code|kbd|a|abbr)\b[^>]*>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');
}

const SENTENCE_HEAD = provedSentence(0).split(' The model')[0]!; // "Proved for the Lean model of this function."

/**
 * - "Proved" (capitalized, as a claim) appears only together with provedSentence(N).
 * - No percent sign except the literal "95% CI".
 * - No scores or grades.
 * - Never "for all inputs".
 */
export function assertClaimsExact(text: string): void {
  const withoutSentences = text.split(SENTENCE_HEAD).join(' ');
  const hasSentence = withoutSentences.length !== text.length;
  if (/\bProved\b/.test(withoutSentences)) expect(hasSentence, 'a "Proved" claim without provedSentence(N)').toBe(true);
  expect(text.replace(/95% CI/g, ''), 'percent sign other than "95% CI"').not.toMatch(/%/);
  expect(text, 'score or grade').not.toMatch(/\b(score|grade|rating)\b|\/\s*10\b|\/\s*100\b/i);
  expect(text, '"for all inputs"').not.toMatch(/for all inputs/i);
}

/** Remove every `<tag class="…cls…">…</tag>` element (nesting-aware) from rendered HTML. */
export function stripElements(html: string, tag: string, cls: string): string {
  const open = new RegExp(`<${tag}\\b[^>]*class="[^"]*\\b${cls}\\b[^"]*"[^>]*>`, 'g');
  let out = '';
  let i = 0;
  for (;;) {
    open.lastIndex = i;
    const m = open.exec(html);
    if (!m) break;
    out += html.slice(i, m.index);
    const tagRe = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'g');
    tagRe.lastIndex = m.index + m[0].length;
    let depth = 1;
    let end = html.length;
    for (let t = tagRe.exec(html); t; t = tagRe.exec(html)) {
      depth += t[1] ? -1 : 1;
      if (depth === 0) {
        end = t.index + t[0].length;
        break;
      }
    }
    out += ' ';
    i = end;
  }
  return out + html.slice(i);
}
