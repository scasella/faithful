// @redteam area=strings status=held
// @inputs [["x","x"],["yy","x"],["yy","yy"],["x",""]]
export function f(m: "x" | "yy", s: string): string { return m === s ? `${m}${m.length}` : s + m; }
