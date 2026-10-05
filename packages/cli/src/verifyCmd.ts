import { openZ3 } from '@faithful/smt';
import { verifyDirectory } from './flow/verify.js';
import { smtChecker } from './smtChecker.js';

export async function runVerifyCmd(dir: string, log: (s: string) => void): Promise<number> {
  let smt = null;
  try {
    smt = smtChecker(await openZ3());
  } catch {
    log('NOTE: no Z3 available: a recorded Verified-to-k claim cannot be re-checked here.');
  }
  const rep = await verifyDirectory(dir, { log, smt });
  log(rep.ok ? '\nAll checks passed.' : '\nSome checks FAILED. The delivered claims are not confirmed.');
  if (rep.evidence) log(rep.evidence);
  return rep.ok ? 0 : 1;
}
