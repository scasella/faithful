export interface FaithfulConfig {
  model: string;
  effort: string;
  codexBin: string;
  /** Wall-clock for one `codex exec` call. */
  codexTimeoutMs: number;
  leanDir?: string;
}

export function resolveConfig(env: NodeJS.ProcessEnv = process.env): FaithfulConfig {
  const t = Number(env.FAITHFUL_CODEX_TIMEOUT_MS);
  return {
    model: env.FAITHFUL_MODEL || 'gpt-6-luna',
    effort: env.FAITHFUL_EFFORT || 'low',
    codexBin: env.FAITHFUL_CODEX_BIN || 'codex',
    codexTimeoutMs: Number.isFinite(t) && t > 0 ? t : 300_000,
    leanDir: env.FAITHFUL_LEAN_DIR || undefined,
  };
}
