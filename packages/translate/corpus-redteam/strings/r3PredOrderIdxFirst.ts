// @redteam area=strings status=held
// @inputs [[["a"],5,"é"],[["a"],0,"é"],[["a"],5,"b"]]
export function f(xs: string[], i: number, s: string): string { return xs[i] + s.toUpperCase(); }
