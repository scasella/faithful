/** Text with `backtick` spans rendered as <code> (lib/inlineCode.ts). Short code never breaks across lines. */
import { splitInlineCode } from '../lib/inlineCode';

export function InlineText({ text }: { text: string }) {
  return (
    <>
      {splitInlineCode(text).map((p, i) => (p.code ? <code key={i} class={p.text.length <= 24 ? 'nowrap' : undefined}>{p.text}</code> : p.text))}
    </>
  );
}
