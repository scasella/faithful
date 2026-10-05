/**
 * A command (or any text) the user copies: monospaced, selectable, with a Copy button that has a bound, visible key.
 * Copying is local (it never calls the backend), so it works in replays too. The result is announced politely.
 */
import { useState } from 'preact/hooks';
import { useKeys } from '../lib/keys';
import { KeyHint } from './KeyHint';
import './CopyBlock.css';

export interface CopyBlockProps {
  text: string;
  /** Key that copies it, e.g. '1'. Avoid replay keys (p . s 0 e). */
  keyName?: string;
  /** Accessible name of the block, e.g. "Command: re-check the delivery". */
  label: string;
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through */
  }
  return false;
}

export function CopyBlock({ text, keyName, label }: CopyBlockProps) {
  const [status, setStatus] = useState<'idle' | 'copied' | 'failed'>('idle');
  const go = async () => setStatus((await copyText(text)) ? 'copied' : 'failed');
  useKeys(keyName ? { [keyName]: () => void go() } : {});
  return (
    <div class="copyblock">
      <pre tabIndex={0} aria-label={label}>
        <code>{text}</code>
      </pre>
      <button type="button" class="btn" aria-keyshortcuts={keyName} onClick={() => void go()}>
        Copy {keyName && <KeyHint keys={keyName} />}
      </button>
      <span class="copy-status" role="status" aria-live="polite">
        {status === 'copied' ? 'Copied.' : status === 'failed' ? 'Copy failed: select the text and copy it yourself.' : ''}
      </span>
    </div>
  );
}
