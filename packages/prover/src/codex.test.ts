import { chmod, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveConfig } from '@faithful/core';
import { CodexClient, buildCodexArgs, looksLikeAuthFailure, parseUsage, summarizeCalls } from './codex.js';

const SCHEMA = { type: 'object', properties: { answer: { type: 'string' } }, required: ['answer'], additionalProperties: false };

/** A fake `codex` that honors -o and prints events, so the driver is tested without the network. */
async function fakeCodex(body: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'fake-codex-'));
  const p = join(dir, 'codex');
  await writeFile(p, `#!/bin/sh\n${body}\n`);
  await chmod(p, 0o755);
  return p;
}

const cfgFor = (bin: string) => ({ ...resolveConfig({}), codexBin: bin, codexTimeoutMs: 5_000 });

describe('codex driver', () => {
  it('builds exactly the argument set the brief requires', () => {
    const a = buildCodexArgs({ model: 'gpt-6-luna', effort: 'low' }, { workDir: '/w', schemaPath: '/s', outPath: '/o' });
    expect(a).toEqual([
      'exec', '-', '--model', 'gpt-6-luna', '--sandbox', 'read-only', '--skip-git-repo-check', '--ephemeral', '--ignore-user-config',
      '-C', '/w', '--output-schema', '/s', '-o', '/o', '--json', '-c', 'model_reasoning_effort=low',
    ]);
  });

  it('records the verbatim prompt, output and usage of a successful call', async () => {
    const bin = await fakeCodex(
      'OUT=""; while [ $# -gt 0 ]; do [ "$1" = "-o" ] && OUT="$2"; shift; done; cat > /dev/null\n' +
        'echo \'{"answer":"hi"}\' > "$OUT"\n' +
        'echo \'{"type":"turn.completed","usage":{"input_tokens":10,"cached_input_tokens":0,"output_tokens":3,"reasoning_output_tokens":1}}\'',
    );
    const c = new CodexClient(cfgFor(bin));
    const call = await c.ask({ purpose: 'test', prompt: 'PROMPT TEXT', schema: SCHEMA });
    expect(call.error).toBeNull();
    expect(call.prompt).toBe('PROMPT TEXT');
    expect(call.output).toEqual({ answer: 'hi' });
    expect(call.usage).toEqual({ inputTokens: 10, cachedInputTokens: 0, outputTokens: 3, reasoningOutputTokens: 1 });
    expect(call.argv).toContain('--ephemeral');
    expect(summarizeCalls(c.calls).calls).toBe(1);
  });

  it('runs in an empty directory and passes the prompt on stdin only', async () => {
    const bin = await fakeCodex(
      'OUT=""; D=""; while [ $# -gt 0 ]; do [ "$1" = "-o" ] && OUT="$2"; [ "$1" = "-C" ] && D="$2"; shift; done\n' +
        'N=$(ls -A "$D" | wc -l | tr -d " "); P=$(cat)\n' +
        'echo "{\\"answer\\":\\"files=$N prompt=$P\\"}" > "$OUT"',
    );
    const call = await new CodexClient(cfgFor(bin)).ask({ purpose: 't', prompt: 'hello', schema: SCHEMA });
    expect((call.output as { answer: string }).answer).toBe('files=0 prompt=hello');
  });

  it('kills the whole process group on timeout', async () => {
    const bin = await fakeCodex('sleep 60 & sleep 60');
    const t0 = Date.now();
    const call = await new CodexClient({ ...cfgFor(bin), codexTimeoutMs: 1_000 }).ask({ purpose: 't', prompt: 'x', schema: SCHEMA });
    expect(call.error?.code).toBe('timeout');
    expect(Date.now() - t0).toBeLessThan(6_000);
  });

  it('classifies auth failures, missing binary, bad output', async () => {
    const auth = await fakeCodex('cat >/dev/null; echo "401 Unauthorized: please codex login" >&2; exit 1');
    expect((await new CodexClient(cfgFor(auth)).ask({ purpose: 't', prompt: 'x', schema: SCHEMA })).error?.code).toBe('not_logged_in');
    expect((await new CodexClient({ ...cfgFor('/nonexistent/codex') }).ask({ purpose: 't', prompt: 'x', schema: SCHEMA })).error?.code).toBe('codex_missing');
    const bad = await fakeCodex('OUT=""; while [ $# -gt 0 ]; do [ "$1" = "-o" ] && OUT="$2"; shift; done; cat >/dev/null; echo "not json" > "$OUT"');
    expect((await new CodexClient(cfgFor(bad)).ask({ purpose: 't', prompt: 'x', schema: SCHEMA })).error?.code).toBe('bad_output');
  });

  it('serializes concurrent asks', async () => {
    const bin = await fakeCodex('OUT=""; while [ $# -gt 0 ]; do [ "$1" = "-o" ] && OUT="$2"; shift; done; cat >/dev/null; sleep 0.4; echo \'{"answer":"x"}\' > "$OUT"');
    const c = new CodexClient(cfgFor(bin));
    const t0 = Date.now();
    await Promise.all([1, 2, 3].map((i) => c.ask({ purpose: `p${i}`, prompt: 'x', schema: SCHEMA })));
    expect(Date.now() - t0).toBeGreaterThanOrEqual(1_150);
    expect(c.calls.map((x) => x.purpose)).toEqual(['p1', 'p2', 'p3']);
  });

  it('parses usage and detects auth text', () => {
    expect(parseUsage('{"type":"turn.completed","usage":{"input_tokens":5,"output_tokens":2}}')?.inputTokens).toBe(5);
    expect(looksLikeAuthFailure('Not logged in')).toBe(true);
    expect(looksLikeAuthFailure('boom')).toBe(false);
  });
});
