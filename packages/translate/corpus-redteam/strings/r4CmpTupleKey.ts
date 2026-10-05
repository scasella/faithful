// @redteam area=strings status=held
// @inputs [[[["b",1],["a",2],["b",3],["",4],["\u00e9",5],["a",6]]],[[]]]
export function f(xs: [string, number][]): number[] { return xs.slice().sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map((x) => x[1]); }
