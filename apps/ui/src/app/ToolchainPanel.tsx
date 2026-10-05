/**
 * Toolchain (key T): the server's own checks (`GET /api/doctor`, the same as `faithful doctor`), so a user can see why a
 * tier is unavailable: no Lean means no proof tier, no Z3 means no Verified-to-k tier, no Codex login means no spec or
 * proof attempts. Non-modal, like the keys panel. In a replay there is no server: it says so and shows the toolchain
 * snapshot recorded in the session instead.
 */
import { Fragment } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { DoctorCheck } from '../actions';
import { KeyHint } from '../components/KeyHint';
import { provenanceRows, stampOf } from '../lib/provenance';
import { useApp } from './AppContext';

const STATUS_WORD: Record<DoctorCheck['status'], string> = { ok: 'OK', warn: 'Warning', fail: 'Missing' };

export function ToolchainPanel({ onClose }: { onClose(): void }) {
  const { store, adapter } = useApp();
  const [checks, setChecks] = useState<DoctorCheck[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const load = () => {
    setLoading(true);
    setErr(null);
    adapter.doctor().then(
      (c) => (setChecks(c), setLoading(false)),
      (e: Error) => (setErr(e.message || String(e)), setLoading(false)),
    );
  };
  useEffect(load, [adapter]);
  const rows = provenanceRows(stampOf(store.state.value));
  return (
    <aside class="help tc" aria-label="Toolchain">
      <div class="row" style={{ justifyContent: 'space-between' }}>
        <h2>Toolchain</h2>
        <div class="row">
          {!adapter.readOnly && (
            <button type="button" class="btn" onClick={load} disabled={loading}>
              Check again
            </button>
          )}
          <button type="button" class="btn" onClick={onClose}>
            Close <KeyHint keys="Esc" />
          </button>
        </div>
      </div>
      <p class="help-note">
        Each tier needs its tools: the proof tiers need Lean (and Mathlib), Verified to k needs Z3, and specs and proof attempts need the Codex CLI, logged
        in. Tested needs only Node.
      </p>
      {loading && (
        <p class="help-note" role="status">
          Asking the local server (this runs the same checks as <code>faithful doctor</code>; it can take a few seconds)…
        </p>
      )}
      {err && (
        <p class="err-inline" role="alert">
          {err}
        </p>
      )}
      {checks && (
        <ul class="tc-list">
          {checks.map((c) => (
            <li key={c.id}>
              <span class={`tc-st ${c.status}`}>{STATUS_WORD[c.status]}</span>
              <span>
                <b>{c.label}</b> <span class="tc-detail">{c.detail}</span>
                {c.fix && (
                  <span class="tc-fix">
                    <br />
                    To fix: <code>{c.fix}</code>
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      <section class="help-group">
        <h3 class="label">Recorded in this session</h3>
        <dl>
          {rows.map((r) => (
            <Fragment key={r.label}>
              <dt>{r.label}</dt>
              <dd>{r.value}</dd>
            </Fragment>
          ))}
        </dl>
      </section>
    </aside>
  );
}
