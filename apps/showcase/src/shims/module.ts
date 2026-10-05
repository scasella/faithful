/**
 * Browser stand-in for `node:module`: `createRequire(...).resolve('typescript/lib/<file>')` points into the virtual lib
 * directory (packages/translate/src/program.ts only resolves `typescript/lib/lib.d.ts` to find the lib folder).
 */
import { LIB_DIR } from './libfiles';

export function createRequire(_from: string | URL) {
  const req = (id: string): never => {
    throw new Error(`require(${JSON.stringify(id)}) is not available in the browser`);
  };
  req.resolve = (id: string): string => {
    const m = /^typescript\/lib\/(lib[^/]*\.d\.ts)$/.exec(id);
    if (m) return `${LIB_DIR}/${m[1]}`;
    throw new Error(`require.resolve(${JSON.stringify(id)}) is not available in the browser`);
  };
  return req;
}

export default { createRequire };
