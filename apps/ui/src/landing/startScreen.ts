/**
 * Which screen the local UI opens on: the landing page or the app. Kept in a SESSION cookie (no Expires, no Max-Age),
 * so the choice lasts until the browser session ends and is never sent anywhere but this local server's own pages.
 * Absent or unreadable cookie: the app.
 */
export type StartScreen = 'landing' | 'app';

export const START_COOKIE = 'faithful_start';

/** The start screen named by a `document.cookie` string; 'app' unless the cookie says 'landing'. */
export function readStartScreen(cookie: string): StartScreen {
  for (const part of cookie.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === START_COOKIE) return v.join('=') === 'landing' ? 'landing' : 'app';
  }
  return 'app';
}

/** The Set-Cookie text for a choice: a session cookie (no Expires / Max-Age), this site only. */
export function startCookie(screen: StartScreen): string {
  return `${START_COOKIE}=${screen}; Path=/; SameSite=Strict`;
}

/** The current choice, or 'app' where there is no document (server rendering, tests in node). */
export function currentStartScreen(): StartScreen {
  try {
    return typeof document === 'undefined' ? 'app' : readStartScreen(document.cookie);
  } catch {
    return 'app';
  }
}

export function writeStartScreen(screen: StartScreen): void {
  try {
    if (typeof document !== 'undefined') document.cookie = startCookie(screen);
  } catch {
    // cookies blocked: the choice simply does not persist
  }
}
