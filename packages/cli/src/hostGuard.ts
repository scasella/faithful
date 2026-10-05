import { randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Same-host enforcement. The server binds 127.0.0.1 only, and additionally checks headers because binding alone does
 * not stop a web page you visit from calling `http://localhost:<port>` (CSRF) or a rebinding DNS name resolving to
 * 127.0.0.1 (DNS rebinding). Rules:
 *   - `Host` must be exactly 127.0.0.1, localhost or [::1] on our port.
 *   - If `Origin` is present it must be one of those origins on our port.
 *   - Mutating methods and all `/api` routes that run tools need the per-process token in `x-faithful-token`.
 */
export interface GuardInput {
  method: string;
  host: string | undefined;
  origin: string | undefined;
  secFetchSite?: string | undefined;
  token: string | undefined;
  path: string;
}

export type GuardResult = { ok: true } | { ok: false; status: number; reason: string };

export function makeToken(): string {
  return randomBytes(24).toString('hex');
}

export function allowedHosts(port: number): string[] {
  return [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`];
}

function tokenOk(expected: string, got: string | undefined): boolean {
  if (!got) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(got);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function guard(input: GuardInput, port: number, token: string): GuardResult {
  const hosts = allowedHosts(port);
  if (!input.host || !hosts.includes(input.host.toLowerCase())) {
    return { ok: false, status: 403, reason: `bad Host header (${input.host ?? 'none'}); only same-host requests are answered` };
  }
  if (input.origin !== undefined) {
    const allowed = hosts.map((h) => `http://${h}`);
    if (!allowed.includes(input.origin.toLowerCase())) {
      return { ok: false, status: 403, reason: `cross-origin request from ${input.origin} refused` };
    }
  }
  if (input.secFetchSite !== undefined && !['same-origin', 'none'].includes(input.secFetchSite)) {
    return { ok: false, status: 403, reason: `Sec-Fetch-Site ${input.secFetchSite} refused` };
  }
  const isApi = input.path.startsWith('/api/');
  if (isApi && !tokenOk(token, input.token)) {
    return { ok: false, status: 401, reason: 'missing or wrong x-faithful-token' };
  }
  return { ok: true };
}
