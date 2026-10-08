// @vitest-environment happy-dom
/** The view choice: a session cookie, default the Simple view. */
import { afterEach, describe, expect, it } from 'vitest';
import { VIEW_COOKIE, currentView, readView, viewCookie, viewFromQuery, writeView } from './viewPref';

afterEach(() => {
  document.cookie = `${VIEW_COOKIE}=; Path=/; Max-Age=0`;
});

describe('view cookie', () => {
  it('defaults to the Simple view when the cookie is absent or unreadable', () => {
    expect(readView('')).toBe('simple');
    expect(readView('other=1; x=full')).toBe('simple');
    expect(readView(`${VIEW_COOKIE}=bogus`)).toBe('simple');
    expect(currentView()).toBe('simple');
  });

  it('writing "full" makes the full view the choice; "simple" switches back', () => {
    writeView('full');
    expect(document.cookie).toContain(`${VIEW_COOKIE}=full`);
    expect(currentView()).toBe('full');
    expect(readView(`a=1; ${VIEW_COOKIE}=full; b=2`)).toBe('full');
    writeView('simple');
    expect(currentView()).toBe('simple');
  });

  it('is a session cookie: no Expires, no Max-Age; path-wide and same-site only', () => {
    for (const v of ['simple', 'full'] as const) {
      const c = viewCookie(v);
      expect(c).toBe(`${VIEW_COOKIE}=${v}; Path=/; SameSite=Strict`);
      expect(c).not.toMatch(/expires|max-age/i);
    }
  });

  it('does not disturb the start-screen cookie', () => {
    document.cookie = 'faithful_start=landing; Path=/';
    writeView('full');
    expect(document.cookie).toContain('faithful_start=landing');
    document.cookie = 'faithful_start=; Path=/; Max-Age=0';
  });

  it('?view=simple|full is read; anything else is ignored', () => {
    expect(viewFromQuery(new URLSearchParams('mock=catch&view=simple'))).toBe('simple');
    expect(viewFromQuery(new URLSearchParams('view=full'))).toBe('full');
    expect(viewFromQuery(new URLSearchParams('view=other'))).toBeNull();
    expect(viewFromQuery(new URLSearchParams(''))).toBeNull();
  });
});
