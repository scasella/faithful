// @redteam area=control status=held
// @redteam-expect refuse:unsupported-syntax
// @redteam-note round 4: hoisted unreachable `var K` shadowing a module const (JS reads undefined): refused via TS2454
const K = 5;
export function f(n: number): number { return n + K; var K = 1; }
