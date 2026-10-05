/**
 * Selectors that read facts out of SessionState. Every claim the UI prints comes from here, and each returns null when
 * the fact is absent: callers omit the clause instead of substituting a neighbouring number.
 *
 * `StageResult.detail` is read through the typed shapes of @faithful/session (details.ts) and their guards:
 *   differential: DifferentialDetail  generated, compared, skippedSlow?, seed, mutation?{caught,total,undistinguished,seed}
 *   smt:          SmtDetail           k, bounds, result, encoding, z3
 *   proof:        ProofDetail         theoremId, against, axioms, attempts (+ statement, accepted, when the server sends them)
 * Anything else in `detail` is not read. Documented in apps/ui/API.md.
 */
import {
  isDifferentialDetail,
  isProofDetail,
  isSmtDetail,
  type CallRecord,
  type CandidateRecord,
  type DifferentialDetail,
  type ModelCheck,
  type ProofDetail,
  type SessionState,
  type SmtDetail,
  type StageId,
  type StageResult,
  type StampedEvent,
} from '@faithful/session';

export function stageOf(c: CandidateRecord, id: StageId): StageResult | null {
  return c.stages.find((s) => s.stage === id) ?? null;
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** The differential stage's detail, when it has the typed shape (with finite counts). */
export function differentialDetail(c: CandidateRecord): (DifferentialDetail & { skippedSlow?: number }) | null {
  const d = stageOf(c, 'differential')?.detail;
  if (!isDifferentialDetail(d) || !finite(d.compared)) return null;
  return d as DifferentialDetail & { skippedSlow?: number };
}

export function smtDetail(c: CandidateRecord): SmtDetail | null {
  const d = stageOf(c, 'smt')?.detail;
  return isSmtDetail(d) && finite(d.k) ? d : null;
}

/** The bound k of a candidate's SMT stage, or null when not recorded. */
export function smtK(c: CandidateRecord): number | null {
  return smtDetail(c)?.k ?? null;
}

export function proofDetail(c: CandidateRecord): (ProofDetail & { statement?: unknown; accepted?: unknown }) | null {
  const d = stageOf(c, 'proof')?.detail;
  return isProofDetail(d) ? d : null;
}

/** Mutation check of the differential inputs: broken copies of the ORIGINAL the inputs caught. */
export function mutationOf(c: CandidateRecord): { caught: number; total: number; undistinguished: number } | null {
  const m = differentialDetail(c)?.mutation;
  if (!m || !finite(m.caught) || !finite(m.total)) return null;
  return { caught: m.caught, total: m.total, undistinguished: finite(m.undistinguished) ? m.undistinguished : 0 };
}

// ───────────── N for provedSentence(N): the model checks ─────────────

/** The latest model check of the ORIGINAL (its Lean model compared with its TypeScript). */
export function originalModelCheck(s: SessionState): ModelCheck | null {
  return s.modelChecks.filter((m) => m.subject === 'original').at(-1) ?? null;
}

/** The latest model check of one candidate (matched by candidateId). */
export function candidateModelCheck(s: SessionState, candidateId: number): ModelCheck | null {
  return s.modelChecks.filter((m) => m.subject === 'candidate' && m.candidateId === candidateId).at(-1) ?? null;
}

/** N for the original's "Proved": null when no model check of the original is recorded (the label is then withheld). */
export function nForOriginal(s: SessionState): number | null {
  return originalModelCheck(s)?.inputs ?? null;
}

/** N for a candidate's "Proved": only that candidate's own model check counts. */
export function nForCandidate(s: SessionState, c: Pick<CandidateRecord, 'id'>): number | null {
  return candidateModelCheck(s, c.id)?.inputs ?? null;
}

export function paramNames(s: SessionState): string[] | null {
  return s.translation?.ok ? s.translation.value.params.map((p) => p.name) : null;
}

export function callById(s: SessionState, id: number | null | undefined): CallRecord | null {
  if (id === null || id === undefined) return null;
  return s.calls.find((c) => c.id === id) ?? null;
}

export function incumbent(s: SessionState): CandidateRecord | null {
  const id = s.optimize.incumbentId;
  return id === null ? null : (s.optimize.candidates.find((c) => c.id === id) ?? null);
}

/**
 * The model calls of a candidate's proof attempts. The proof detail may list them (`callIds`); the server does not, so
 * they are read from the event order instead: candidates are checked one at a time, and every `proof-attempt` call
 * recorded after this candidate was proposed and before the next one was proposed (or optimizing stopped) is one of its
 * attempts.
 */
export function candidateProofCalls(s: SessionState, events: readonly StampedEvent[], c: CandidateRecord): CallRecord[] {
  const listed = stageOf(c, 'proof')?.detail?.['callIds'];
  if (Array.isArray(listed)) return listed.filter(finite).map((id) => callById(s, id)).filter((x): x is CallRecord => x !== null);
  const out: CallRecord[] = [];
  let inside = false;
  for (const { event: e } of events) {
    if (e.kind === 'session.started') inside = false;
    else if (e.kind === 'candidate.proposed') inside = e.candidate.id === c.id;
    else if (e.kind === 'optimize.stopped') inside = false;
    else if (inside && e.kind === 'call.recorded' && e.call.purpose === 'proof-attempt') out.push(e.call);
  }
  return out;
}
