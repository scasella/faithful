// @redteam area=arithmetic status=held expect=ok
// @inputs [[-4,2],[-1,3],[0,5],[0,-5],[-2,-2],[1,2]]
// -0 cannot cross the Val boundary: JSON.stringify(-0) === "0", String(-0) === "0", -0 === 0; so a % b and Math.ceil(a / b) producing -0 agree with Int 0.
export function modNegZeroStr(a: number, b: number): string { const r = a % b; return "" + r + (r === 0) + Math.ceil(a / b) + (Math.ceil(a / b) === 0); }
