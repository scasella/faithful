// @redteam area=strings status=held
// @inputs [[[["a","😀"]]],[[[]]]]
export function f(xss: string[][]): number { return xss.reduce((a, xs) => a + xs.join("").length, 0); }
