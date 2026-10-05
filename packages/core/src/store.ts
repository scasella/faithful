import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { hashOf } from './hash.js';

/** All persistence is plain files under `<repo>/.faithful/<fn>/`: JSON and Lean, git-friendly, no database. */
export class FaithfulStore {
  readonly root: string;
  constructor(repoRoot: string) {
    this.root = resolve(repoRoot, '.faithful');
  }
  fnDir(fn: string): string {
    if (!/^[A-Za-z_$][\w$]*$/.test(fn)) throw new Error(`not a function name: ${fn}`);
    return join(this.root, fn);
  }
  path(fn: string, ...rest: string[]): string {
    return join(this.fnDir(fn), ...rest);
  }
  async writeText(fn: string, rel: string, text: string): Promise<string> {
    const p = this.path(fn, rel);
    await mkdir(dirname(p), { recursive: true });
    const tmp = `${p}.tmp-${process.pid}`;
    await writeFile(tmp, text, 'utf8');
    await rename(tmp, p); // atomic: a crashed run never leaves a half-written session file
    return p;
  }
  async writeJson(fn: string, rel: string, value: unknown): Promise<string> {
    return this.writeText(fn, rel, JSON.stringify(value, null, 2) + '\n');
  }
  async readText(fn: string, rel: string): Promise<string | null> {
    try {
      return await readFile(this.path(fn, rel), 'utf8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw e;
    }
  }
  async readJson<T>(fn: string, rel: string): Promise<T | null> {
    const t = await this.readText(fn, rel);
    return t === null ? null : (JSON.parse(t) as T);
  }
}

/** Content-address a record: `{ hash, ...record }` where hash covers the record. */
export function withHash<T extends object>(record: T): T & { hash: string } {
  return { ...record, hash: hashOf(record) };
}
