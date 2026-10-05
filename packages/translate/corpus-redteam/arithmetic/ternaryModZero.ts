// @redteam area=arithmetic status=divergence input=[1,true] ts=ok:false lean=ok:true,rangeOk=false expect=range-violation root-cause=instrument.ts-isNum/isStr/isIndexable severity=soundness:ts-side-range-ok-enforcement
// instrument.ts isNum: `%` with a divisor of union-of-literal type `0 | 2` is not routed through __faithful.mod, so the zero divisor (NaN) is not reported
export function ternaryModZero(a: number, c: boolean): boolean { return a % (c ? 0 : 2) === 1; }
