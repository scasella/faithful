import { verifyDirectory } from './flow/verify.js';

export async function runVerifyCmd(dir: string, log: (s: string) => void): Promise<number> {
  const rep = await verifyDirectory(dir, { log });
  log(rep.ok ? '\nAll checks passed.' : '\nSome checks FAILED. The delivered claims are not confirmed.');
  if (rep.evidence) log(rep.evidence);
  return rep.ok ? 0 : 1;
}
