import { access, constants } from 'node:fs/promises';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';

/** Extra places tools commonly live that a GUI-launched or npx process may not have on PATH. */
export function extraBinDirs(): string[] {
  const h = homedir();
  return [join(h, '.elan', 'bin'), '/opt/homebrew/bin', '/usr/local/bin', join(h, '.local', 'bin')];
}

export async function findBinary(name: string, env: NodeJS.ProcessEnv = process.env): Promise<string | null> {
  if (name.includes('/')) return (await isExecutable(name)) ? name : null;
  const dirs = [...(env.PATH ?? '').split(delimiter).filter(Boolean), ...extraBinDirs()];
  for (const d of dirs) {
    const p = join(d, name);
    if (await isExecutable(p)) return p;
  }
  return null;
}

async function isExecutable(p: string): Promise<boolean> {
  try {
    await access(p, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Environment with the extra bin dirs appended to PATH, for subprocesses that call other tools (lake → lean). */
export function envWithToolDirs(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const dirs = [...(env.PATH ?? '').split(delimiter).filter(Boolean), ...extraBinDirs()];
  return { ...env, PATH: [...new Set(dirs)].join(delimiter) };
}
