// @redteam area=control status=held
// @redteam-expect refuse:mutable-capture
// @redteam-note refused: `LIMIT` is module-level state (only module-level `const` number/string/boolean literals are supported)
let LIMIT = 3;
export function f(n: number): number { let c = 0; for (let i = 0; i < LIMIT; i++) { c = c + n; } return c; }
