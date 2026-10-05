// @redteam area=control status=held
// @redteam-expect refuse:unsupported-syntax
// @redteam-note refused: the function does not type-check: TS2366 Function lacks ending return statement and return type does not include 'undefined'.
export function f(xs: string[]): string | null { for (const x of xs) { if (x.length > 2) return x; } }
