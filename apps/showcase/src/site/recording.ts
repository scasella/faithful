/**
 * Recordings: real sessions produced by the tool, replayed here. Format (schema 1):
 *   { schema: 1, fn, stampedEvents: StampedEvent[], source, toolchain, recordedAt, notes }
 * stored as public/recordings/<name>.json. The session's delivered Lean file, when there is one, sits next to it as
 * public/recordings/<name>.lean (the site links to it and shows its text). recordings/index.json is generated at
 * build time from the folder (vite.config.ts).
 *
 * Nothing here is invented: the loader refuses a file that is not schema 1 or whose events do not start with the
 * recorded session.
 */
import type { ToolchainSnapshot } from '@faithful/core';
import { replay, type Agreement, type CandidateRecord, type SessionEvent, type StampedEvent } from '@faithful/session';
import type { Precondition, Translation } from '@faithful/translate';

export interface Recording {
  schema: 1;
  fn: string;
  stampedEvents: StampedEvent[];
  /** Original file text (what the tool translated). */
  source: string;
  toolchain: ToolchainSnapshot;
  recordedAt: string;
  notes: string;
}

export interface RecordingHead {
  name: string;
  file: string;
  fn: string;
  recordedAt: string;
  notes: string;
  lean: string | null;
}

export function validateRecording(x: unknown, where: string): Recording {
  const r = x as Partial<Recording>;
  const bad = (why: string): never => {
    throw new Error(`${where}: ${why}`);
  };
  if (!r || typeof r !== 'object') bad('not an object');
  if (r.schema !== 1) bad(`schema is ${String(r.schema)}, expected 1`);
  if (typeof r.fn !== 'string' || !r.fn) bad('missing fn');
  if (!Array.isArray(r.stampedEvents) || r.stampedEvents.length === 0) bad('no stampedEvents');
  if (typeof r.source !== 'string') bad('missing source');
  if (!r.toolchain || typeof r.toolchain !== 'object') bad('missing toolchain');
  const first = r.stampedEvents![0]!.event;
  if (first.kind !== 'session.started') bad('first event is not session.started');
  if ((first as Extract<SessionEvent, { kind: 'session.started' }>).fn !== r.fn) bad('session.started.fn differs from fn');
  return r as Recording;
}

export async function loadIndex(): Promise<RecordingHead[]> {
  const res = await fetch('recordings/index.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error(`recordings/index.json: HTTP ${res.status}`);
  return (await res.json()) as RecordingHead[];
}

export async function loadRecording(head: RecordingHead): Promise<Recording> {
  const res = await fetch(head.file, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${head.file}: HTTP ${res.status}`);
  return validateRecording(await res.json(), head.file);
}

/** What the live checks need from a recording (all read from its events, never assumed). */
export interface LiveInputs {
  fnName: string;
  /** The translation the tool recorded (translate.done). */
  translation: Translation | null;
  agreement: Agreement | null;
  carveOuts: Precondition[];
  throwChoice: 'precondition' | 'spec-case' | null;
  /** The candidates the tool proposed, with their recorded stage results. */
  candidates: CandidateRecord[];
  /** Original file text. */
  originalFile: string;
  recordedAt: string;
  /** Z3 the recording ran with, e.g. "5.2.0 (z3-solver WASM)". */
  z3: string;
}

export function liveInputsOf(rec: Recording): LiveInputs {
  // The session package's own reducer, so the showcase reads the recording exactly as the UI does.
  const s = replay(rec.stampedEvents);
  return {
    fnName: rec.fn,
    translation: s.translation?.ok ? s.translation.value : null,
    agreement: s.agreement,
    carveOuts: s.agreement?.carveOuts ?? s.carveOuts,
    throwChoice: s.agreement?.throwChoice ?? s.throwChoice,
    candidates: s.optimize.candidates,
    originalFile: rec.source,
    recordedAt: rec.recordedAt,
    z3: rec.toolchain.z3 ? `${rec.toolchain.z3.version} (${rec.toolchain.z3.kind === 'wasm' ? 'z3-solver WASM' : 'system binary'})` : '(version not recorded)',
  };
}

/** "2026-10-05" from an ISO time. */
export function dateOf(iso: string): string {
  return iso.slice(0, 10);
}

/** One line naming exactly what produced the recorded figures. */
export function recordedWith(t: ToolchainSnapshot): string {
  const lean = t.lean.toolchain ?? t.lean.version ?? 'Lean (version not recorded)';
  const z3 = t.z3 ? `Z3 ${t.z3.version} (${t.z3.kind === 'wasm' ? 'z3-solver WASM' : 'system binary'})` : 'Z3 (not recorded)';
  return `${lean}, Mathlib ${t.lean.mathlibCommit?.slice(0, 12) ?? '(not recorded)'}, ${z3}, model ${t.codex.model} (Codex CLI ${t.codex.version ?? 'version not recorded'}, effort ${t.codex.effort}), Node ${t.node}, ${t.platform}`;
}
