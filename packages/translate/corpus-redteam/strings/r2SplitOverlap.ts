// @redteam area=strings status=held
// @inputs [["aaaa"],["ababab"],["abababa"],[""],["a"],["aab"]]
export function f(s: string): string[][] { return [s.split("ab"), s.split("aa"), s.split("aba"), (s + s).split(s.slice(0, 2))]; }
