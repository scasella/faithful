/** DEVELOPMENT FIXTURES, NOT RECORDINGS. See ./common.ts. */
import { catchFixture } from './catch';
import { refusedFixture } from './refused';
import type { Fixture } from './common';

export { FIXTURE_NOTICE, FIXTURE_DETAIL, type Fixture } from './common';

export const FIXTURES: Record<string, Fixture> = {
  [catchFixture.name]: catchFixture,
  [refusedFixture.name]: refusedFixture,
};
