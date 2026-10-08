/**
 * Source with line numbers, light highlighting (TypeScript, Lean) and an optional marked span (e.g. a refusal); and
 * CodePair, the original and a candidate side by side (stacked on a narrow screen).
 */
import type { CandidateRecord } from '@faithful/session';
import { tokenize, toLines, type Lang } from '../lib/highlight';

export interface CodeProps {
  text: string;
  lang: Lang;
  /** UTF-16 offsets into `text`. */
  mark?: { start: number; end: number } | null;
  /** Accessible name, e.g. "Source of fib". */
  label?: string;
  caption?: string;
  /** First line number (default 1). */
  from?: number;
}

export function Code({ text, lang, mark, label, caption, from = 1 }: CodeProps) {
  const body = text.endsWith('\n') ? text.slice(0, -1) : text;
  const lines = toLines(tokenize(body, lang), mark);
  return (
    <figure class="code-fig">
      <pre class="code" tabIndex={0} aria-label={label}>
        <code>
          {lines.map((segs, i) => (
            <span key={i} class={`line${segs.some((s) => s.marked) ? ' has-mark' : ''}`}>
              <span class="ln" aria-hidden="true">
                {i + from}
              </span>
              <span class="src">
                {segs.map((s, j) => {
                  const cls = s.kind === 'plain' || s.kind === 'op' ? undefined : `tk-${s.kind}`;
                  const inner = cls ? <span class={cls}>{s.text}</span> : s.text;
                  return s.marked ? (
                    <mark key={j} class="span">
                      {inner}
                    </mark>
                  ) : (
                    <span key={j}>{inner}</span>
                  );
                })}
                {'\n'}
              </span>
            </span>
          ))}
        </code>
      </pre>
      {caption && <figcaption class="code-caption">{caption}</figcaption>}
    </figure>
  );
}

/** The original and a candidate side by side. `rejected` marks the candidate's column (the CatchCard's pair). */
export function CodePair({ original, candidate, rejected = false }: { original: string; candidate: Pick<CandidateRecord, 'id' | 'source'>; rejected?: boolean }) {
  return (
    <div class="code-pair" role="group" aria-label={`Original and candidate ${candidate.id}`}>
      {original && (
        <div class="code-pair-col">
          <p class="code-pair-head">Original</p>
          <Code text={original} lang="ts" label="Source of the original" />
        </div>
      )}
      <div class={`code-pair-col${rejected ? ' rejected' : ''}`}>
        <p class="code-pair-head">
          Candidate {candidate.id}
          {rejected && <span class="code-pair-rejected"> · rejected</span>}
        </p>
        <Code text={candidate.source} lang="ts" label={`Source of candidate ${candidate.id}`} />
      </div>
    </div>
  );
}
