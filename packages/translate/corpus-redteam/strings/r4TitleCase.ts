// @redteam area=strings status=held
// @inputs [["hello big WORLD"],[""],["  a"],["\u00e9t\u00e9 x"],["a \u00e9"]]
export function f(s: string): string { return s.toLowerCase().split(" ").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" "); }
