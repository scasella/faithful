// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[[1,2,3,4],7],[[1,2],9],[[],0],[[5,5],10]]
// @redteam-note round 4: nested index loops returning an Option tuple
export function f(xs: number[], t: number): [number, number] | null { for (let i = 0; i < xs.length; i++) { for (let j = i + 1; j < xs.length; j++) { if (xs[i] + xs[j] === t) return [i, j]; } } return null; }
