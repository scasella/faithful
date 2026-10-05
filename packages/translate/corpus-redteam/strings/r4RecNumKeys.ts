// @redteam area=strings status=held
// @inputs [["a"],[""]]
export function f(s: string): { "1": string; "0": string; b: string; "-1": string; "01": string } { return { "1": s, "0": s + s, b: "b", "-1": "m", "01": "z" }; }
