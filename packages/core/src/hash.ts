import { createHash } from 'node:crypto';

/** JSON with sorted keys and no insignificant whitespace, so equal values hash equal. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as object).sort()) {
      const x = (v as Record<string, unknown>)[k];
      if (x !== undefined) out[k] = sortKeys(x);
    }
    return out;
  }
  return v;
}

export function sha256(text: string | Uint8Array): string {
  return createHash('sha256').update(text).digest('hex');
}

/** `sha256:<64 hex>` of the canonical JSON of a value. */
export function hashOf(value: unknown): string {
  return `sha256:${sha256(canonicalJson(value))}`;
}

export function hashText(text: string): string {
  return `sha256:${sha256(text)}`;
}
