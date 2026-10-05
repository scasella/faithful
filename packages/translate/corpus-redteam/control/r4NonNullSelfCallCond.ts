// @redteam area=control status=held
// @redteam-expect refuse:unsupported-syntax
// @redteam-note round 4: `if (f(n - 1)!)` in an Option<boolean> function: refused
export function f(n: number): boolean | undefined { if (n <= 0) return undefined; if (f(n - 1)!) return false; return true; }
