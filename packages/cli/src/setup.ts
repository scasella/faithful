import { run, findBinary, envWithToolDirs, resolveLeanDir } from '@faithful/core';
import { spawn } from 'node:child_process';

export const SETUP_COST =
  'faithful setup downloads and unpacks the pinned Lean toolchain (~0.4 GB) and the Mathlib build cache ' +
  '(~2 GB download, ~7 GB on disk), about 1 to 15 minutes depending on your connection. ' +
  'If elan is missing, --install-elan also runs elan\'s official installer (https://elan.lean-lang.org). ' +
  'Measured here (2026-10-04): `lake exe cache get` for the pinned Mathlib took 47 s with a warm local cache.';

function stream(bin: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): Promise<number> {
  return new Promise((resolve, reject) => {
    const c = spawn(bin, args, { cwd, env, stdio: 'inherit' });
    c.on('error', reject);
    c.on('close', (code) => resolve(code ?? 1));
  });
}

export async function runSetup(opts: { yes: boolean; installElan: boolean; log: (s: string) => void }): Promise<number> {
  const { log } = opts;
  log(SETUP_COST);
  if (!opts.yes) {
    log('\nRe-run with --yes to start. Nothing has been downloaded.');
    return 2;
  }
  const leanDir = resolveLeanDir();
  if (!leanDir) {
    log('No lean/ project found next to this install. Set FAITHFUL_LEAN_DIR to a Lake project directory.');
    return 1;
  }
  let elan = await findBinary('elan');
  if (!elan) {
    if (!opts.installElan) {
      log('elan is not installed. Re-run with --install-elan to run its official installer, or install it yourself.');
      return 1;
    }
    log('Installing elan with its official installer…');
    const code = await stream('sh', ['-c', 'curl -sSfL https://elan.lean-lang.org/elan-init.sh | sh -s -- -y --default-toolchain none'], process.cwd(), process.env);
    if (code !== 0) return code;
    elan = await findBinary('elan');
    if (!elan) {
      log('elan installed but not found on PATH; add ~/.elan/bin to PATH.');
      return 1;
    }
  }
  const env = envWithToolDirs();
  const lake = await findBinary('lake');
  if (!lake) {
    log('lake not found even with elan present.');
    return 1;
  }
  log('Fetching the Mathlib build cache (lake exe cache get)…');
  // Quiet: the cache tool prints a progress counter on one line per file.
  const r = await run(lake, ['exe', 'cache', 'get'], { cwd: leanDir, env, timeoutMs: 3_600_000, maxBytes: 64 * 1024 });
  if (r.code !== 0) {
    log(`cache get failed (exit ${r.code}): ${r.stderr.slice(-500)}`);
    return 1;
  }
  log('Building the Faithful Lean library…');
  const b = await run(lake, ['build'], { cwd: leanDir, env, timeoutMs: 3_600_000, maxBytes: 256 * 1024 });
  if (b.code !== 0) {
    log(`lake build failed: ${b.stdout.slice(-800)}`);
    return 1;
  }
  log('Done. Run `faithful doctor` to confirm.');
  return 0;
}
