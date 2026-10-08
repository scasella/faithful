/**
 * speedupText never rounds a claim up: the estimate and the lower bound round down, the upper bound rounds up, at the
 * printed precision (2 decimals below 10x, 1 decimal from 10x, none from 100x).
 */
import { describe, expect, it } from 'vitest';
import { speedupText } from './format.js';

describe('speedupText', () => {
  it('keeps an interval that toFixed would narrow (ratio 1.961, lo 1.944, hi 1.971)', () => {
    // toFixed(2) would print 1.97 for the upper bound, which is below the interval's true upper bound.
    expect(speedupText({ ratio: 1.961, lo: 1.944, hi: 1.971 })).toBe('1.96× (95% CI 1.94–1.98)');
  });

  it('rounds the estimate and the lower bound down and the upper bound up at 2 decimals', () => {
    // toFixed(2) would print 1.97 (estimate) and 2.01 (upper bound).
    expect(speedupText({ ratio: 1.969, lo: 1.951, hi: 2.011 })).toBe('1.96× (95% CI 1.95–2.02)');
  });

  it('uses 1 decimal from 10x and rounds the same way', () => {
    // toFixed(1) would print 13.0 for the estimate and 13.0 for the upper bound.
    expect(speedupText({ ratio: 12.96, lo: 12.51, hi: 13.01 })).toBe('12.9× (95% CI 12.5–13.1)');
  });

  it('uses no decimals from 100x', () => {
    expect(speedupText({ ratio: 100.9, lo: 99.9, hi: 101.1 })).toBe('100× (95% CI 99–102)');
  });
});
