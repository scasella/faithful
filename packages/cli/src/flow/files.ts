/**
 * The repository's exported functions (`GET /api/files`): every `.ts`/`.mts` file with at least one exported function,
 * outside the usual build and vendor directories, tests and declaration files. Read-only.
 *
 * One entry per function NAME per file: an overloaded function is listed once, at its lowest line (every overload
 * signature is a declaration, and the Pick list would show the same function several times). Whether it can run is the
 * triage's question, and its answer for an overloaded function says it is overloaded.
 */
import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { listExportedFunctions } from '@faithful/translate';
import { MAX_FILE_BYTES, uniqueFunctions, type ExportedFn } from './triage.js';

export interface FileEntry {
  path: string;
  functions: ExportedFn[];
}

const SKIP_DIRS = new Set(['node_modules', '.git', '.faithful', 'dist', 'build', 'coverage', '.next', 'out']);

export async function listFiles(repoRoot: string, max = 2000): Promise<FileEntry[]> {
  const out: FileEntry[] = [];
  let realRoot: string | null = null;
  async function walk(dir: string): Promise<void> {
    if (out.length >= max) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (out.length >= max) return;
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) await walk(p);
      } else if (/\.(ts|mts)$/.test(e.name) && !/\.d\.ts$/.test(e.name) && !/\.(test|spec)\.ts$/.test(e.name)) {
        try {
          if (e.isSymbolicLink()) {
            // a link that leaves the repository is not a file of it (opening it is refused as well)
            realRoot ??= await realpath(resolve(repoRoot));
            const rel = relative(realRoot, await realpath(p));
            if (rel.startsWith('..') || isAbsolute(rel)) continue;
          }
          const st = await stat(p);
          if (!st.isFile() || st.size > MAX_FILE_BYTES) continue;
          const fns = uniqueFunctions(listExportedFunctions(await readFile(p, 'utf8')).filter((f) => f.exported));
          if (fns.length) out.push({ path: relative(repoRoot, p), functions: fns });
        } catch {
          // unreadable or a dangling link: not listed
        }
      }
    }
  }
  await walk(repoRoot);
  return out.sort((a, b) => a.path.localeCompare(b.path));
}
