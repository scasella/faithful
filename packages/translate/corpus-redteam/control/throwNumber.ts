// @redteam area=control status=held
// @redteam-expect refuse:unsupported-syntax
// @redteam-note refused: only `throw new Error("literal message")` or `throw "literal message"` is supported
export function f(n: number): number { if (n < 0) throw 42; return n; }
