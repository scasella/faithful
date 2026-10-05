// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[[1,2],[3,4],5],[[],[1],1],[[9],[9],9],[[1],[2],100]]
// @redteam-note round 4: return from a while nested in two for...of loops, Option via undefined after
export function f(a: number[], b: number[], t: number): number | undefined { let acc = 0; for (const x of a) { for (const y of b) { let k = 0; while (k < 3) { acc += x * y; if (acc === t) return k; k++; } } } if (acc > t) return undefined; return -acc; }
