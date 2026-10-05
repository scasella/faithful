/**
 * Codex driver: one `codex exec` subprocess per request, serialized, process group killed on timeout.
 * Adapted from scasella/undefined server/codexService.ts (MIT, (c) 2026 Stephen Casella): the argument shape, the
 * auth-failure patterns and the serial queue. Changes: Node-only, no SSE, every call is returned as a complete
 * record (`CodexCall`) so the prompt can be shown verbatim ("What the model saw") and replayed in the showcase.
 *
 * Codex is read-only, runs in an EMPTY temp directory, and never sees the repo. It does not run lake; the prover checks
 * every proof itself.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SerialQueue, envWithToolDirs, findBinary, resolveConfig, run, type FaithfulConfig } from '@faithful/core';

export type JsonSchema = Record<string, unknown>;

export interface CodexUsage {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
}

/** Everything about one call: enough to display it, replay it, and count it. */
export interface CodexCall {
  /** What the call was for, e.g. `spec-proposal`, `proof-attempt`, `candidate`. */
  purpose: string;
  /** The exact prompt text sent on stdin. */
  prompt: string;
  schema: JsonSchema;
  /** Exact argv passed to the codex binary (after the binary name). */
  argv: string[];
  model: string;
  effort: string;
  startedAt: string;
  ms: number;
  /** The model's final message exactly as returned, and its parse. */
  rawOutput: string | null;
  output: unknown | null;
  usage: CodexUsage | null;
  error: CodexError | null;
}

export type CodexErrorCode = 'codex_missing' | 'not_logged_in' | 'timeout' | 'aborted' | 'codex_failed' | 'bad_output';
export interface CodexError {
  code: CodexErrorCode;
  message: string;
  fix?: string[];
}

const AUTH_PATTERNS = [/not logged in/i, /401 Unauthorized/i, /codex login/i, /login required/i, /authenticat/i];
export const looksLikeAuthFailure = (text: string): boolean => AUTH_PATTERNS.some((p) => p.test(text));

export function buildCodexArgs(cfg: Pick<FaithfulConfig, 'model' | 'effort'>, p: { workDir: string; schemaPath: string; outPath: string }): string[] {
  return [
    'exec', '-',
    '--model', cfg.model,
    '--sandbox', 'read-only',
    '--skip-git-repo-check',
    '--ephemeral',
    '--ignore-user-config',
    '-C', p.workDir,
    '--output-schema', p.schemaPath,
    '-o', p.outPath,
    '--json',
    '-c', `model_reasoning_effort=${cfg.effort}`,
  ];
}

export function parseUsage(jsonl: string): CodexUsage | null {
  let usage: CodexUsage | null = null;
  for (const line of jsonl.split('\n')) {
    if (!line.startsWith('{')) continue;
    try {
      const e = JSON.parse(line) as { type?: string; usage?: Record<string, number> };
      if (e.type === 'turn.completed' && e.usage) {
        const u = e.usage;
        usage = {
          inputTokens: u.input_tokens ?? 0,
          cachedInputTokens: u.cached_input_tokens ?? 0,
          outputTokens: u.output_tokens ?? 0,
          reasoningOutputTokens: u.reasoning_output_tokens ?? 0,
        };
      }
    } catch {
      /* not an event line */
    }
  }
  return usage;
}

function errorTail(jsonl: string, stderr: string): string {
  const lines: string[] = [];
  for (const l of jsonl.split('\n')) {
    if (!l.startsWith('{')) continue;
    try {
      const e = JSON.parse(l) as { type?: string; message?: string; error?: { message?: string } };
      if (e.type === 'error' && e.message) lines.push(e.message);
      if (e.type === 'turn.failed' && e.error?.message) lines.push(e.error.message);
    } catch {
      /* skip */
    }
  }
  lines.push(...stderr.split('\n').map((s) => s.trim()).filter(Boolean).slice(-6));
  return lines.slice(-6).join('\n');
}

export interface CodexRequest {
  purpose: string;
  prompt: string;
  schema: JsonSchema;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Reasoning effort for this call only (e.g. a proof retry at higher effort); defaults to the client's configured effort. */
  effort?: string;
}

export class CodexClient {
  private readonly queue = new SerialQueue();
  private readonly cfg: FaithfulConfig;
  /** Every call made by this client, in order (the number of Codex calls is a reported figure). */
  readonly calls: CodexCall[] = [];

  constructor(cfg: FaithfulConfig = resolveConfig()) {
    this.cfg = cfg;
  }

  get model(): string {
    return this.cfg.model;
  }

  /** The configured default effort (`FAITHFUL_EFFORT`, default `low`). */
  get effort(): string {
    return this.cfg.effort;
  }

  /** Serialized: at most one codex process at a time. Never throws; failures are in `call.error`. */
  ask(req: CodexRequest): Promise<CodexCall> {
    return this.queue.run(() => this.doAsk(req));
  }

  private async doAsk(req: CodexRequest): Promise<CodexCall> {
    const startedAt = new Date().toISOString();
    const t0 = performance.now();
    const effort = req.effort || this.cfg.effort;
    const call: CodexCall = {
      purpose: req.purpose,
      prompt: req.prompt,
      schema: req.schema,
      argv: [],
      model: this.cfg.model,
      effort,
      startedAt,
      ms: 0,
      rawOutput: null,
      output: null,
      usage: null,
      error: null,
    };
    const finish = (error: CodexError | null): CodexCall => {
      call.error = error;
      call.ms = performance.now() - t0;
      this.calls.push(call);
      return call;
    };
    if (req.signal?.aborted) return finish({ code: 'aborted', message: 'Request cancelled; codex was not started.' });
    const bin = await findBinary(this.cfg.codexBin);
    if (!bin) {
      return finish({ code: 'codex_missing', message: `Codex CLI not found (tried "${this.cfg.codexBin}").`, fix: ['npm i -g @openai/codex', 'codex login'] });
    }
    const dir = await mkdtemp(join(tmpdir(), 'faithful-codex-'));
    try {
      const workDir = join(dir, 'empty');
      await (await import('node:fs/promises')).mkdir(workDir);
      const schemaPath = join(dir, 'schema.json');
      const outPath = join(dir, 'out.json');
      await writeFile(schemaPath, JSON.stringify(req.schema), 'utf8');
      call.argv = buildCodexArgs({ model: this.cfg.model, effort }, { workDir, schemaPath, outPath });
      const timeoutMs = req.timeoutMs ?? this.cfg.codexTimeoutMs;
      let r;
      try {
        r = await run(bin, call.argv, { cwd: workDir, env: envWithToolDirs(), input: req.prompt, timeoutMs, signal: req.signal });
      } catch (e) {
        return finish({ code: 'codex_failed', message: `Could not start codex: ${(e as Error).message}` });
      }
      call.usage = parseUsage(r.stdout);
      if (req.signal?.aborted) return finish({ code: 'aborted', message: 'Request cancelled; the codex process was stopped.' });
      if (r.timedOut) return finish({ code: 'timeout', message: `codex did not finish within ${Math.round(timeoutMs / 1000)} s and was stopped.` });
      if (r.code !== 0) {
        const tail = errorTail(r.stdout, r.stderr);
        if (looksLikeAuthFailure(tail)) return finish({ code: 'not_logged_in', message: `Codex is not logged in.\n${tail}`, fix: ['codex login'] });
        return finish({ code: 'codex_failed', message: `codex exec failed (exit ${r.code}).\n${tail}` });
      }
      let raw: string;
      try {
        raw = await readFile(outPath, 'utf8');
      } catch {
        return finish({ code: 'bad_output', message: 'codex exited 0 but wrote no final message.' });
      }
      call.rawOutput = raw;
      try {
        call.output = JSON.parse(raw);
      } catch {
        return finish({ code: 'bad_output', message: 'the model\'s final message was not JSON.' });
      }
      return finish(null);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}

/** Totals for the "Codex calls" figure reported per session. */
export function summarizeCalls(calls: readonly CodexCall[]): { calls: number; failed: number; ms: number; inputTokens: number; outputTokens: number } {
  return {
    calls: calls.length,
    failed: calls.filter((c) => c.error).length,
    ms: calls.reduce((s, c) => s + c.ms, 0),
    inputTokens: calls.reduce((s, c) => s + (c.usage?.inputTokens ?? 0), 0),
    outputTokens: calls.reduce((s, c) => s + (c.usage?.outputTokens ?? 0), 0),
  };
}
