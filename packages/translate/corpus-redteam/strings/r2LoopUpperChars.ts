// @redteam area=strings status=held
// @inputs [["aBcD"],[""],["z@[`{"],["\u00e9a"]]
export function f(s: string): string { let out = ""; for (let i = 0; i < s.length; i++) { const c = s[i]; out = i % 2 === 0 ? out + c.toUpperCase() : out + c.toLowerCase(); } return out; }
