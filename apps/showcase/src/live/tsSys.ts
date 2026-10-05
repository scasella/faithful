/**
 * A virtual `ts.sys` for the browser, so the engine's compile gate (`ts.createCompilerHost`) and anything else that
 * reaches `ts.sys` works without Node. The only files are the bundled ES2023 lib .d.ts texts under LIB_DIR; the
 * compile gate's own candidate/original files live in its in-memory host. TypeScript exports `setSys` for this purpose.
 */
import ts from 'typescript';
import { LIB_DIR, libPaths, libText } from '../shims/libfiles';

let installed = false;

export function installTsSys(): void {
  if (installed) return;
  installed = true;
  const dirs = new Set(['/', LIB_DIR, '/faithful']);
  const sys: ts.System = {
    args: [],
    newLine: '\n',
    useCaseSensitiveFileNames: true,
    write: () => undefined,
    writeOutputIsTTY: () => false,
    readFile: (p) => libText(p),
    writeFile: () => undefined,
    resolvePath: (p) => p,
    fileExists: (p) => libText(p) !== undefined,
    directoryExists: (p) => dirs.has(p.replace(/\/$/, '') || '/'),
    createDirectory: () => undefined,
    getExecutingFilePath: () => `${LIB_DIR}/typescript.js`,
    getCurrentDirectory: () => '/faithful',
    getDirectories: () => [],
    readDirectory: (p) => (p.replace(/\/$/, '') === LIB_DIR ? libPaths() : []),
    exit: () => undefined,
    realpath: (p) => p,
    getModifiedTime: () => undefined,
    setModifiedTime: () => undefined,
    deleteFile: () => undefined,
    createHash: undefined,
    createSHA256Hash: undefined,
    getMemoryUsage: () => 0,
    getFileSize: (p) => libText(p)?.length ?? 0,
  };
  (ts as unknown as { setSys(s: ts.System): void }).setSys(sys);
}
