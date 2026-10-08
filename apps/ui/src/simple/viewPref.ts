/**
 * Which view of the app the local UI shows: the Simple view (one question per screen) or the full view (every stage,
 * every detail). Kept in a SESSION cookie (no Expires, no Max-Age), like landing/startScreen.ts, so the choice lasts
 * until the browser session ends and never leaves this local server's own pages. Absent or unreadable cookie: Simple.
 */
export type View = 'simple' | 'full';

export const VIEW_COOKIE = 'faithful_view';

/** The view named by a `document.cookie` string; 'simple' unless the cookie says 'full'. */
export function readView(cookie: string): View {
  for (const part of cookie.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === VIEW_COOKIE) return v.join('=') === 'full' ? 'full' : 'simple';
  }
  return 'simple';
}

/** The Set-Cookie text for a choice: a session cookie (no Expires / Max-Age), this site only. */
export function viewCookie(view: View): string {
  return `${VIEW_COOKIE}=${view}; Path=/; SameSite=Strict`;
}

/** The current choice, or 'simple' where there is no document (tests in node) or cookies cannot be read. */
export function currentView(): View {
  try {
    return typeof document === 'undefined' ? 'simple' : readView(document.cookie);
  } catch {
    return 'simple';
  }
}

export function writeView(view: View): void {
  try {
    if (typeof document !== 'undefined') document.cookie = viewCookie(view);
  } catch {
    // cookies blocked: the choice simply does not persist
  }
}

/** `?view=simple|full` in a query string, or null when absent or anything else. */
export function viewFromQuery(q: URLSearchParams): View | null {
  const v = q.get('view');
  return v === 'simple' || v === 'full' ? v : null;
}
