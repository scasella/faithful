/** Browser stand-in for `node:fs` as used by packages/translate/src/program.ts: reads the bundled lib .d.ts files only. */
import { libText } from './libfiles';

export function readFileSync(path: string, _enc?: unknown): string {
  const t = libText(path);
  if (t === undefined) {
    const e = new Error(`ENOENT: no such file in the in-browser TypeScript lib set: ${path}`) as Error & { code: string };
    e.code = 'ENOENT';
    throw e;
  }
  return t;
}

export function existsSync(path: string): boolean {
  return libText(path) !== undefined;
}

export function readdirSync(): string[] {
  throw new Error('readdirSync is not available in the browser');
}

export default { readFileSync, existsSync, readdirSync };
