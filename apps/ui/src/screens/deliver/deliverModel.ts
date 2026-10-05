/**
 * Pure logic for the Deliver screen.
 *  - SessionState carries the delivery's directory and file names only, not file contents. The diff view is therefore
 *    computed here from the two sources the session does carry (the original function and the delivered candidate), and
 *    the screen says so; the patch file on disk is what the user applies.
 *  - Commands are exactly those of the delivered VERIFY.md (packages/cli/src/flow/deliver.ts `verifyMarkdown`):
 *    `faithful verify .faithful/<fn>` and, when a change was delivered, `git apply .faithful/<fn>/patch.diff`.
 */

export type DiffOp = { kind: 'same' | 'del' | 'add'; text: string; a: number | null; b: number | null };

function splitLines(s: string): string[] {
  const t = s.endsWith('\n') ? s.slice(0, -1) : s;
  return t === '' ? [] : t.split('\n');
}

/** Line diff by longest common subsequence. Line numbers are 1-based in each side. */
export function lineDiff(before: string, after: string): DiffOp[] {
  const A = splitLines(before);
  const B = splitLines(after);
  const n = A.length;
  const m = B.length;
  if (n * m > 4_000_000) {
    // Too large for the table: show it as a full replacement rather than guess.
    return [...A.map((text, i) => ({ kind: 'del' as const, text, a: i + 1, b: null })), ...B.map((text, j) => ({ kind: 'add' as const, text, a: null, b: j + 1 }))];
  }
  const L: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i]![j] = A[i] === B[j] ? L[i + 1]![j + 1]! + 1 : Math.max(L[i + 1]![j]!, L[i]![j + 1]!);
  const out: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) {
      out.push({ kind: 'same', text: A[i]!, a: i + 1, b: j + 1 });
      i++;
      j++;
    } else if (L[i + 1]![j]! >= L[i]![j + 1]!) {
      out.push({ kind: 'del', text: A[i]!, a: i + 1, b: null });
      i++;
    } else {
      out.push({ kind: 'add', text: B[j]!, a: null, b: j + 1 });
      j++;
    }
  }
  while (i < n) out.push({ kind: 'del', text: A[i]!, a: i + 1, b: null }), i++;
  while (j < m) out.push({ kind: 'add', text: B[j]!, a: null, b: j + 1 }), j++;
  return out;
}

export interface Hunk {
  header: string;
  ops: DiffOp[];
}

/** Group a diff into unified-diff hunks with `context` unchanged lines around each change. */
export function hunks(ops: DiffOp[], context = 3): Hunk[] {
  const changed = ops.map((o, i) => (o.kind === 'same' ? -1 : i)).filter((i) => i >= 0);
  if (!changed.length) return [];
  const ranges: Array<[number, number]> = [];
  for (const i of changed) {
    const lo = Math.max(0, i - context);
    const hi = Math.min(ops.length - 1, i + context);
    const last = ranges.at(-1);
    if (last && lo <= last[1] + 1) last[1] = Math.max(last[1], hi);
    else ranges.push([lo, hi]);
  }
  return ranges.map(([lo, hi]) => {
    const slice = ops.slice(lo, hi + 1);
    const aStart = slice.find((o) => o.a !== null)?.a ?? 0;
    const bStart = slice.find((o) => o.b !== null)?.b ?? 0;
    const aLen = slice.filter((o) => o.kind !== 'add').length;
    const bLen = slice.filter((o) => o.kind !== 'del').length;
    return { header: `@@ -${aStart},${aLen} +${bStart},${bLen} @@`, ops: slice };
  });
}

/** Unified diff text (for copying). */
export function unifiedText(hs: Hunk[], aName: string, bName: string): string {
  const lines = [`--- ${aName}`, `+++ ${bName}`];
  for (const h of hs) {
    lines.push(h.header);
    for (const o of h.ops) lines.push(`${o.kind === 'same' ? ' ' : o.kind === 'del' ? '-' : '+'}${o.text}`);
  }
  return lines.join('\n') + '\n';
}

// ───────────── files ─────────────

function base(path: string): string {
  return path.split('/').at(-1) ?? path;
}

/** What a delivered file is, by name. Unknown names get no description rather than a guess. */
export function describeFile(path: string, fn: string, changeDelivered = true): string | null {
  const b = base(path);
  if (/\.(diff|patch)$/.test(b)) {
    return changeDelivered
      ? 'The change to your function, as a patch. Apply it yourself; nothing was applied for you.'
      : 'A placeholder: no optimized function was delivered, so there is no change to apply.';
  }
  if (b === 'spec.md') return 'The agreed spec in Lean and in plain words, with the preconditions, carve-outs and rulings.';
  if (b === `${fn}.provenance.json` || b === 'provenance.json') return 'Every claim with its exact tier, hashes, toolchain versions and model calls: the record a reviewer re-checks.';
  if (b === 'VERIFY.md') return 'How to re-check this delivery without trusting it.';
  if (b.endsWith('.lean')) return 'Lean source: the model of the function, the agreed spec and the accepted proofs, with #print axioms for each.';
  return null;
}

export function joinPath(dir: string, file: string): string {
  if (file.startsWith('/') || file.startsWith(dir + '/')) return file;
  return `${dir.replace(/\/+$/, '')}/${file}`;
}

export interface Command {
  cmd: string;
  what: string;
}

/**
 * The commands to check and apply the delivery, exactly as VERIFY.md gives them. `git apply` only when a change was
 * delivered. `testedOnly`: a refused function (packages/cli/src/flow/tested.ts `testedVerifyMarkdown`): verify re-runs
 * the differential only, because no proof or SMT claim exists.
 */
export function deliveryCommands(delivery: { dir: string; files: string[] }, changeDelivered: boolean, testedOnly = false): Command[] {
  const out: Command[] = [
    {
      cmd: `faithful verify ${delivery.dir}`,
      what: testedOnly
        ? 'Re-check the delivery: recompute the hashes in the provenance file and re-run the differential test against your original on the same generated inputs. There is no proof or SMT claim to re-check.'
        : 'Re-check the delivery: recompute every hash in the provenance file, re-run Lean on the proof file, re-run the differential test and the bounded SMT check, and print the evidence line again.',
    },
  ];
  const patch = delivery.files.find((f) => /\.(diff|patch)$/.test(f));
  if (patch && changeDelivered) {
    out.push({ cmd: `git apply ${joinPath(delivery.dir, patch)}`, what: 'Apply the patch to your file. This is the only step that changes your source, and you run it.' });
  }
  return out;
}

/** The sentence that the user's code was not modified. */
export function notModifiedSentence(file: string): string {
  return file
    ? `Your file ${file} was not modified. The change is a patch; you apply it yourself.`
    : 'Your pasted code was not modified. The change is a patch; you apply it yourself.';
}
