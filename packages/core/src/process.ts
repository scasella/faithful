import { spawn } from 'node:child_process';

export interface RunOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  input?: string;
  /** Wall-clock budget. The whole process group is SIGKILLed when it elapses. */
  timeoutMs: number;
  /** Cap on captured characters per stream; output beyond it is dropped and `truncated` is set. */
  maxBytes?: number;
  signal?: AbortSignal;
}

export interface RunResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  truncated: boolean;
  ms: number;
}

/**
 * Run a subprocess in its own process group so a timeout kills grandchildren too
 * (lean spawns workers, codex spawns tools). Never throws for a non-zero exit; rejects only when the
 * binary cannot be spawned at all.
 */
export function run(bin: string, args: string[], opts: RunOptions): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const t0 = performance.now();
    const maxBytes = opts.maxBytes ?? 8 * 1024 * 1024;
    const child = spawn(bin, args, {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: true,
    });
    let stdout = '';
    let stderr = '';
    let truncated = false;
    let timedOut = false;
    let settled = false;
    const killGroup = () => {
      try {
        if (child.pid) process.kill(-child.pid, 'SIGKILL');
      } catch {
        try {
          child.kill('SIGKILL');
        } catch {
          /* already gone */
        }
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      killGroup();
    }, opts.timeoutMs);
    const onAbort = () => killGroup();
    opts.signal?.addEventListener('abort', onAbort, { once: true });
    const take = (cur: string, chunk: Buffer): string => {
      if (cur.length >= maxBytes) {
        truncated = true;
        return cur;
      }
      const s = cur + chunk.toString('utf8');
      if (s.length > maxBytes) {
        truncated = true;
        return s.slice(0, maxBytes);
      }
      return s;
    };
    child.stdout.on('data', (c: Buffer) => (stdout = take(stdout, c)));
    child.stderr.on('data', (c: Buffer) => (stderr = take(stderr, c)));
    child.on('error', (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
      killGroup(); // nothing in the group outlives the call
      resolve({ code, signal, stdout, stderr, timedOut, truncated, ms: performance.now() - t0 });
    });
    child.stdin.on('error', () => {});
    if (opts.input !== undefined) child.stdin.end(opts.input);
    else child.stdin.end();
  });
}

/** Serializes async work: one at a time, in submission order. */
export class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve();
  run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.tail.then(fn, fn);
    this.tail = next.catch(() => {});
    return next;
  }
}
