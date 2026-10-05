// @redteam area=strings status=held
// @inputs [["Ab"],[""],["é"]]
export function f(s: string): string | undefined { if (s === "") return undefined; return s.toLowerCase(); }
