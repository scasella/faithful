// @redteam area=strings status=held
// Round 3 note: instrument.ts rewrites a throw to userThrow only for a bare (parenthesized) literal argument; `"q" satisfies string` is not rewritten, yet the outcomes agree (the runner maps the raw Error to the same throw outcome).
// @inputs [[-1],[1]]
export function f(n: number): number { if (n < 0) throw new Error("q" satisfies string); return n; }
