/**
 * In-memory TypeScript program for one source text, so the checker can give local variable types.
 * Lib files (ES2023, no DOM, no @types) are parsed once per process and reused; the previous program is passed as
 * `oldProgram` so unchanged lib files are not re-bound.
 */
import ts from 'typescript';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const LIB_DIR = dirname(require.resolve('typescript/lib/lib.d.ts'));
export const USER_FILE = '/faithful/input.ts';

export const COMPILER_OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  lib: ['lib.es2023.d.ts'],
  types: [],
  strict: true,
  noResolve: true,
  noEmit: true,
  skipLibCheck: true,
  noUncheckedIndexedAccess: false,
  allowJs: false,
};

const libCache = new Map<string, ts.SourceFile | undefined>();
let lastProgram: ts.Program | undefined;

function libFile(fileName: string): ts.SourceFile | undefined {
  if (libCache.has(fileName)) return libCache.get(fileName);
  let sf: ts.SourceFile | undefined;
  try {
    const text = readFileSync(fileName, 'utf8');
    sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.ES2022, true);
  } catch {
    sf = undefined;
  }
  libCache.set(fileName, sf);
  return sf;
}

export interface Loaded {
  program: ts.Program;
  checker: ts.TypeChecker;
  sf: ts.SourceFile;
}

/** Build a program whose only user file is `source`. */
export function loadProgram(source: string): Loaded {
  const userSf = ts.createSourceFile(USER_FILE, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const host: ts.CompilerHost = {
    getSourceFile: (fileName) => (fileName === USER_FILE ? userSf : libFile(fileName)),
    getDefaultLibFileName: () => join(LIB_DIR, 'lib.es2023.d.ts'),
    getDefaultLibLocation: () => LIB_DIR,
    writeFile: () => undefined,
    getCurrentDirectory: () => '/faithful',
    getDirectories: () => [],
    fileExists: (f) => f === USER_FILE || libFile(f) !== undefined,
    readFile: (f) => (f === USER_FILE ? source : libFile(f)?.text),
    getCanonicalFileName: (f) => f,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => '\n',
  };
  const program = ts.createProgram({ rootNames: [USER_FILE], options: COMPILER_OPTIONS, host, oldProgram: lastProgram });
  lastProgram = program;
  return { program, checker: program.getTypeChecker(), sf: userSf };
}

/** Parse only (no checker): for listing functions. */
export function parseOnly(source: string): ts.SourceFile {
  return ts.createSourceFile(USER_FILE, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
}
