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

/**
 * The program of the last source asked for. `translate` is asked once per exported function, and a program is
 * parsed, bound and type-checked per source (`getSemanticDiagnostics` covers the whole file), so a file with N functions
 * cost N times the file: 127 s for 2,400 one-line exports, 27 s for 1,500 in a 290 KB file. The same source gets the
 * same program: nothing translate does changes the syntax tree or the checker's answers (it only reads them).
 */
let lastLoaded: { source: string; loaded: Loaded } | undefined;

/** Build a program whose only user file is `source` (the last one built is reused for the same text). */
export function loadProgram(source: string): Loaded {
  if (lastLoaded?.source === source) return lastLoaded.loaded;
  const loaded = buildProgram(source);
  lastLoaded = { source, loaded };
  return loaded;
}

function buildProgram(source: string): Loaded {
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
