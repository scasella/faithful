// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [["abc"],[""],["a"]]
// @redteam-note round 4: unused charCodeAt(i) with i = length on the last iteration: rangeOk false
export function f(s: string): number { for (let i = 0; i <= s.length; i++) { const c = s.charCodeAt(i); } return s.length; }
