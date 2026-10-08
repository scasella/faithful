// @vitest-environment happy-dom
/** The start-screen choice: a session cookie, default the app. */
import { afterEach, describe, expect, it } from 'vitest';
import { START_COOKIE, currentStartScreen, readStartScreen, startCookie, writeStartScreen } from './startScreen';

afterEach(() => {
  document.cookie = `${START_COOKIE}=; Path=/; Max-Age=0`;
});

describe('start screen cookie', () => {
  it('defaults to the app when the cookie is absent or unreadable', () => {
    expect(readStartScreen('')).toBe('app');
    expect(readStartScreen('other=1; x=landing')).toBe('app');
    expect(readStartScreen(`${START_COOKIE}=bogus`)).toBe('app');
    expect(currentStartScreen()).toBe('app');
  });

  it('writing "landing" makes the landing the start screen', () => {
    writeStartScreen('landing');
    expect(document.cookie).toContain(`${START_COOKIE}=landing`);
    expect(currentStartScreen()).toBe('landing');
    expect(readStartScreen(`a=1; ${START_COOKIE}=landing; b=2`)).toBe('landing');
  });

  it('writing "app" switches back', () => {
    writeStartScreen('landing');
    writeStartScreen('app');
    expect(currentStartScreen()).toBe('app');
  });

  it('is a session cookie: no Expires, no Max-Age; path-wide and same-site only', () => {
    for (const s of ['landing', 'app'] as const) {
      const c = startCookie(s);
      expect(c).not.toMatch(/expires/i);
      expect(c).not.toMatch(/max-age/i);
      expect(c).toContain('Path=/');
      expect(c).toContain('SameSite=Strict');
    }
  });
});
