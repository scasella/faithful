/**
 * Keyboard-first: one window-level listener per binding, ignored while typing in a field or when a modifier is held.
 * Every binding must also be visible next to its control (<KeyHint>) and listed in the help panel.
 */
import { useEffect, useRef } from 'preact/hooks';

export interface KeyTargetLike {
  tagName?: string;
  isContentEditable?: boolean;
  type?: string;
}

/** True when the key press belongs to a text field, not to the app. */
export function isTypingTarget(t: KeyTargetLike | null | undefined): boolean {
  if (!t || !t.tagName) return false;
  const tag = t.tagName.toUpperCase();
  if (t.isContentEditable) return true;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') return !['button', 'checkbox', 'radio', 'submit', 'reset'].includes((t.type ?? 'text').toLowerCase());
  return false;
}

export interface KeyEventLike {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  target?: unknown;
  defaultPrevented?: boolean;
}

/** Normalize a key event to a binding name, or null when the app should not handle it. */
export function bindingOf(e: KeyEventLike): string | null {
  if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return null;
  if (isTypingTarget(e.target as KeyTargetLike)) return null;
  if (e.key === 'ArrowLeft' || e.key === '[') return 'prev';
  if (e.key === 'ArrowRight' || e.key === ']') return 'next';
  return e.key;
}

/**
 * Bind keys to handlers while mounted. `keys` maps a binding (`'prev'`, `'next'`, or a literal key like `'a'`, `'?'`)
 * to a handler. Handlers see the latest closure without re-binding.
 */
export function useKeys(keys: Record<string, (() => void) | undefined | false>, enabled = true): void {
  const ref = useRef(keys);
  ref.current = keys;
  useEffect(() => {
    if (!enabled) return;
    const on = (e: KeyboardEvent) => {
      const b = bindingOf(e);
      if (!b) return;
      // Arrow keys inside a slider or other focused control keep their native meaning.
      if ((b === 'prev' || b === 'next') && e.key.startsWith('Arrow') && (e.target as HTMLElement | null)?.tagName === 'INPUT') return;
      const f = ref.current[b];
      if (f) {
        e.preventDefault();
        f();
      }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [enabled]);
}
