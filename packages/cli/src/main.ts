import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { formatDoctor, runDoctor } from './doctor.js';
import { startServer } from './server.js';
import { createApi } from './api.js';
import { runOptimize } from './optimizeCmd.js';
import { runVerifyCmd } from './verifyCmd.js';
import { runSetup } from './setup.js';

const USAGE = `faithful: make a TypeScript function faster while Lean 4 checks that it still does what you agreed.

Usage:
  faithful                          open the browser UI for the repo in the current directory
  faithful optimize <file> --fn <name>   run the workflow headlessly
  faithful verify .faithful/<fn>    re-check a delivered result without trusting it
  faithful doctor                   check Node, Codex, Lean, Mathlib cache, Z3, disk
  faithful setup [--yes] [--install-elan]   install and cache the Lean toolchain (states cost first)
  faithful showcase-record          record a full session for the static showcase

Environment: FAITHFUL_MODEL (default gpt-6-luna), FAITHFUL_EFFORT (default low), FAITHFUL_LEAN_DIR.
`;

function flag(args: string[], name: string): boolean {
  return args.includes(`--${name}`);
}

function opt(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

export async function main(argv: string[]): Promise<number> {
  const flagFirst = argv[0]?.startsWith('--') && argv[0] !== '--help';
  const [cmd, ...rest] = flagFirst ? ['serve', ...argv] : argv;
  const log = (s: string) => process.stdout.write(s + '\n');
  switch (cmd) {
    case undefined:
    case 'ui':
    case 'serve': {
      const repoRoot = resolve(opt(rest, 'repo') ?? process.cwd());
      const api = await createApi(repoRoot);
      const s = await startServer({ repoRoot, port: Number(opt(rest, 'port')) || 0, api });
      log(`Faithful is running at ${s.url}  (127.0.0.1 only; Ctrl-C to stop)`);
      if (!flag(rest, 'no-open') && process.platform === 'darwin') spawn('open', [s.url], { stdio: 'ignore', detached: true }).unref();
      await new Promise<void>((ok) => process.once('SIGINT', ok));
      await s.close();
      return 0;
    }
    case 'doctor': {
      const { checks } = await runDoctor();
      log(formatDoctor(checks));
      return checks.some((c) => c.status === 'fail') ? 1 : 0;
    }
    case 'setup':
      return runSetup({ yes: flag(rest, 'yes'), installElan: flag(rest, 'install-elan'), log });
    case 'optimize': {
      const file = rest.find((a) => !a.startsWith('--'));
      const fn = opt(rest, 'fn');
      if (!file || !fn) {
        log('usage: faithful optimize <file> --fn <name> [--minutes 10] [--yes]');
        return 2;
      }
      return runOptimize({ file, fn, repo: opt(rest, 'repo') ?? process.cwd(), minutes: Number(opt(rest, 'minutes')) || 10, yes: flag(rest, 'yes'), proofAttempts: Number(opt(rest, 'proof-attempts')) || 6, proofMinutes: Number(opt(rest, 'proof-minutes')) || 10, log });
    }
    case 'verify': {
      const dir = rest.find((a) => !a.startsWith('--'));
      if (!dir) {
        log('usage: faithful verify .faithful/<fn>');
        return 2;
      }
      return runVerifyCmd(resolve(dir), log);
    }
    case 'showcase-record':
      log(`faithful ${cmd}: not implemented yet in this build.`);
      return 2;
    case '-h':
    case '--help':
    case 'help':
      log(USAGE);
      return 0;
    default:
      log(`unknown command: ${cmd}\n\n${USAGE}`);
      return 2;
  }
}
