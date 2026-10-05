/**
 * Provenance of every number the UI shows: date, model id and toolchain versions.
 *
 * `reduce` never fills `SessionState.stamp`, so the stamp is derived from `SessionState.toolchain` the same way
 * `stampFrom` in @faithful/core does (that function lives in the node-only main entry, which the UI must not import).
 */
import type { SessionState } from '@faithful/session';
import type { Stamp, ToolchainSnapshot } from '@faithful/core';

export function stampOf(s: Pick<SessionState, 'stamp' | 'toolchain'>): Stamp | null {
  if (s.stamp) return s.stamp;
  const tc = s.toolchain;
  if (!tc) return null;
  return { date: tc.capturedAt.slice(0, 10), modelId: tc.codex.model, toolchain: tc };
}

export function shortCommit(c: string | null | undefined): string | null {
  return c ? c.slice(0, 7) : null;
}

/** "Lean 4.34.0, Mathlib 5ed2965": the parenthetical that follows a proof claim. Omits what is unknown. */
export function leanVersions(tc: ToolchainSnapshot | null | undefined): string | null {
  if (!tc) return null;
  const parts: string[] = [];
  if (tc.lean.version) parts.push(`Lean ${tc.lean.version}`);
  const m = shortCommit(tc.lean.mathlibCommit);
  if (m) parts.push(`Mathlib ${m}`);
  return parts.length ? parts.join(', ') : null;
}

export interface ProvenanceRow {
  label: string;
  value: string;
}

/** Rows shown in the provenance popover. Unknown values are said to be unknown, never guessed. */
export function provenanceRows(stamp: Stamp | null): ProvenanceRow[] {
  if (!stamp) return [{ label: 'Toolchain', value: 'not recorded in this session' }];
  const tc = stamp.toolchain;
  const unk = 'not recorded';
  return [
    { label: 'Measured', value: stamp.date },
    { label: 'Model', value: `${stamp.modelId} (effort ${tc.codex.effort})` },
    { label: 'Codex CLI', value: tc.codex.version ?? unk },
    { label: 'Lean', value: tc.lean.version ?? unk },
    { label: 'Mathlib', value: tc.lean.mathlibCommit ?? unk },
    { label: 'Z3', value: tc.z3 ? `${tc.z3.version} (${tc.z3.kind === 'wasm' ? 'WASM' : 'system'})` : unk },
    { label: 'Node', value: tc.node },
    { label: 'Platform', value: tc.platform },
    { label: 'Snapshot', value: tc.capturedAt },
  ];
}
