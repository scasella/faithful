// @redteam area=arithmetic status=divergence input=[9007199254740991,true] ts=ok:false lean=ok:true,rangeOk=false expect=range-violation root-cause=instrument.ts-isNum/isStr/isIndexable severity=soundness:ts-side-range-ok-enforcement
// instrument.ts isNum: `*` with an operand of type `3 | 5` is not checked; the product 3*(2^53-1) rounds to an even double
export function ternaryMulParity(a: number, c: boolean): boolean { return (a * (c ? 3 : 5)) % 2 === 1; }
