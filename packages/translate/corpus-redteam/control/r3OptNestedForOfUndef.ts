// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[[[1,2],[3]],3],[[[1,2],[3]],9],[[],1],[[[-1]],0]]
// @redteam-note round 3: option return from nested for...of, `return undefined` inside the inner loop, implicit fall-off
export function f(xss: number[][], t: number): string | undefined { for (const xs of xss) { for (const x of xs) { if (x < 0) return undefined; if (x === t) return "hit" + x; } if (xs.length === 0) return "empty"; } }
