/**
 * "What the model saw": the verbatim prompt sent to Codex (and its verbatim answer), collapsed by default. Sits under
 * every spec proposal, proof attempt and candidate. When there was no model call, it says so.
 */
import type { CallRecord } from '@faithful/session';
import { formatCount } from '@faithful/core/tiers';
import { msText } from '../lib/format';
import { Num } from './Provenance';

export function ModelSaw({ call, what }: { call: CallRecord | null; what?: string }) {
  if (!call) {
    return (
      <details class="saw">
        <summary>What the model saw</summary>
        <p class="meta">No model call is recorded for {what ?? 'this item'}.</p>
      </details>
    );
  }
  return (
    <details class="saw">
      <summary>
        What the model saw{' '}
        <span class="muted">
          {what ? `· ${what} ` : ''}· call {call.id} · {call.model}
        </span>
      </summary>
      <p class="meta">
        {call.model}, effort {call.effort} · started {call.startedAt} ·{' '}
        <Num what="Wall-clock time of the Codex call">{msText(call.ms)}</Num>
        {call.inputTokens !== null && (
          <>
            {' '}
            · <Num what="Input tokens reported by Codex (includes its own overhead)">{formatCount(call.inputTokens)} tokens in</Num>
          </>
        )}
        {call.outputTokens !== null && (
          <>
            {' '}
            · <Num what="Output tokens reported by Codex">{formatCount(call.outputTokens)} out</Num>
          </>
        )}
      </p>
      <p class="label">Prompt, verbatim</p>
      <pre tabIndex={0}>{call.prompt}</pre>
      <details class="saw">
        <summary>What the model answered</summary>
        {call.error ? <p class="err-inline">Error: {call.error}</p> : <pre tabIndex={0}>{call.response ?? ''}</pre>}
      </details>
    </details>
  );
}
