import { Fragment } from 'preact';

/** Visible key hint: <kbd>a</kbd>, or several alternatives: <kbd>←</kbd>/<kbd>[</kbd>. Decorative for screen readers;
 *  the control it labels carries aria-keyshortcuts. */
export function KeyHint({ keys, sep = '/' }: { keys: string | string[]; sep?: string }) {
  const list = Array.isArray(keys) ? keys : [keys];
  return (
    <span class="keyhint" aria-hidden="true">
      {list.map((k, i) => (
        <Fragment key={k}>
          {i > 0 && <span class="muted"> {sep} </span>}
          <kbd>{k}</kbd>
        </Fragment>
      ))}
    </span>
  );
}
