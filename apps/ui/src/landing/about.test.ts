// @vitest-environment happy-dom
/** "About Faithful" in the app's top bar: only in the local UI (onAbout given), never in replays or the showcase. */
import { describe, expect, it } from 'vitest';
import { h } from 'preact';
import { renderToString } from 'preact-render-to-string';
import { Shell } from '../app/App';
import { ReplayAdapter } from '../adapters/replay';
import { FIXTURES } from '../fixtures';
import { createStore } from '../store';

describe('About Faithful button', () => {
  const fx = FIXTURES.catch!;
  const replay = new ReplayAdapter(fx.events, { label: fx.title, fixture: true });

  it('is shown when the shell gets onAbout', () => {
    const html = renderToString(h(Shell, { store: createStore(), adapter: replay, onAbout: () => {} }));
    expect(html).toMatch(/<button type="button" class="btn"[^>]*>About Faithful<\/button>/);
  });

  it('is absent otherwise (replay, fixtures, the showcase)', () => {
    const html = renderToString(h(Shell, { store: createStore(), adapter: replay, replay, fixtureTitle: fx.title }));
    expect(html).not.toContain('About Faithful');
  });
});
