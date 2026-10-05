/**
 * The TypeScript ES2023 lib .d.ts files, as text, for the in-browser compiler. Provided at build time by the
 * `virtual:faithful-ts-libs` plugin in vite.config.ts (the closure of `/// <reference lib>` from lib.es2023.d.ts and
 * lib.es2022.d.ts, no DOM). Every in-browser compiler host reads lib files from LIB_DIR through this map.
 */
import libs from 'virtual:faithful-ts-libs';

/** Directory the virtual TypeScript "installation" lives in. */
export const LIB_DIR = '/ts-lib';

const files = new Map<string, string>(Object.entries(libs as Record<string, string>).map(([name, text]) => [`${LIB_DIR}/${name}`, text]));

export function libText(path: string): string | undefined {
  return files.get(path);
}

export function libPaths(): string[] {
  return [...files.keys()];
}
