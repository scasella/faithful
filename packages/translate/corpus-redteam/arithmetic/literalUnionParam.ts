// @redteam area=arithmetic status=divergence input=[3,3002399751580331] ts=ok:0 lean=ok:1,rangeOk=false expect=range-violation root-cause=instrument.ts-isNum/isStr/isIndexable severity=soundness:ts-side-range-ok-enforcement
// instrument.ts isNum: a parameter of type `3 | 5` (accepted as int by lower.ts) makes `a * b` unchecked
export function literalUnionParam(a: 3 | 5, b: number): number { return (a * b) % 2; }
