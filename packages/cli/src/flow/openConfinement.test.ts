/**
 * SessionRuntime.openFunction reads only files whose real path is inside the repository: a `..` path, an absolute path
 * elsewhere and a symlink inside the repository that points outside are all refused before anything is read or started.
 */
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SessionRuntime } from './runtime.js';

const SRC = 'export function f(n: number): number {\n  return n + 1;\n}\n';
let base: string;
let repo: string;
let rt: SessionRuntime;

beforeAll(async () => {
  base = await mkdtemp(join(tmpdir(), 'faithful-confine-'));
  repo = join(base, 'repo');
  await mkdir(repo, { recursive: true });
  await writeFile(join(base, 'outside.ts'), SRC);
  await symlink(join(base, 'outside.ts'), join(repo, 'link.ts'));
  rt = new SessionRuntime({ repoRoot: repo });
});

afterAll(async () => {
  await rt.close();
  await rm(base, { recursive: true, force: true });
});

describe('openFunction confinement', () => {
  it('refuses a relative path that leaves the repository', async () => {
    await expect(rt.openFunction('../outside.ts', 'f')).rejects.toThrow('the file must be inside the repository');
  });

  it('refuses an absolute path outside the repository', async () => {
    await expect(rt.openFunction(join(base, 'outside.ts'), 'f')).rejects.toThrow('the file must be inside the repository');
  });

  it('refuses a symlink inside the repository that points outside it', async () => {
    await expect(rt.openFunction('link.ts', 'f')).rejects.toThrow('the file must be inside the repository');
  });
});
