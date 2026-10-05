// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[-1],[0],[1],[2],[3]]
export function f(n: number): number { if (n < 0) throw new Error("it's \"x\"\\n\ttab é ñ"); if (n === 0) throw "plain\nline"; if (n === 1) throw new Error(""); if (n === 2) throw Error(`tpl`); return n; }
