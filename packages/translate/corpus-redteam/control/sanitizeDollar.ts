// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[1,2,3]]
export function f($a: number, _a: number, a: number): number { return $a * 100 + _a * 10 + a; }
