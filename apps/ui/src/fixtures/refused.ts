/**
 * DEVELOPMENT FIXTURE, NOT A RECORDING (see ./common.ts). A function the translator refuses: bare `/` is not provably
 * integer-valued (refusal code `float`), with the exact source span of the division.
 */
import { FIXTURE_TOOLCHAIN, fakeHash, spanOf, timeline, type Fixture } from './common';

export const AVERAGE_SOURCE = `export function average(xs: number[]): number {
  let sum = 0;
  for (const x of xs) {
    sum += x;
  }
  return sum / xs.length;
}
`;

export const refusedFixture: Fixture = {
  name: 'refused',
  title: 'average(xs): refused, float division',
  fixture: true,
  events: timeline([
    [
      0,
      {
        kind: 'session.started',
        fn: 'average',
        file: 'src/stats.ts',
        source: AVERAGE_SOURCE,
        sourceHash: fakeHash(AVERAGE_SOURCE),
        toolchain: FIXTURE_TOOLCHAIN,
      },
    ],
    [
      212,
      {
        kind: 'translate.done',
        result: {
          ok: false,
          refusal: {
            code: 'float',
            reason:
              '`sum / xs.length` is a bare division, so its result is not provably an integer. Faithful models `number` as an integer. If integer division is meant, write Math.floor(sum / xs.length).',
            span: spanOf(AVERAGE_SOURCE, 'sum / xs.length'),
          },
        },
      },
    ],
  ]),
};
