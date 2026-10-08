/**
 * Nothing runs `lake` in a Lake project that has not been built: `lake` would fetch the missing dependencies (Mathlib,
 * about 1 GB) as a side effect of `lake env`, so loadLeanEnv refuses first and points at `faithful setup --yes`.
 */
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { leanProjectBuilt, loadLeanEnv } from './lean-env.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'faithful-leanenv-'));
  await writeFile(join(dir, 'lean-toolchain'), 'leanprover/lean4:v4.34.0\n');
  await writeFile(join(dir, 'lakefile.toml'), 'name = "x"\n[[require]]\nname = "mathlib"\ngit = "https://example.invalid/mathlib4"\nrev = "0"\n');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('leanProjectBuilt', () => {
  it('is false until the Faithful library has been built, true after', async () => {
    expect(leanProjectBuilt(dir)).toBe(false);
    await mkdir(join(dir, '.lake', 'build', 'lib', 'lean'), { recursive: true });
    expect(leanProjectBuilt(dir)).toBe(false);
    await writeFile(join(dir, '.lake', 'build', 'lib', 'lean', 'Faithful.olean'), '');
    expect(leanProjectBuilt(dir)).toBe(true);
  });
});

describe('loadLeanEnv on a project that has not been built', () => {
  it('refuses with the fix and never starts lake (which would create .lake and fetch dependencies)', async () => {
    const t0 = Date.now();
    await expect(loadLeanEnv(dir)).rejects.toThrow(/has not been built yet: run `faithful setup --yes`/);
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(existsSync(join(dir, '.lake'))).toBe(false);
  });
});
