// @redteam area=arithmetic status=divergence input=[3002399751580331,true] ts=ok:0 lean=ok:1,rangeOk=false expect=range-violation root-cause=instrument.ts-isNum/isStr/isIndexable severity=soundness:ts-side-range-ok-enforcement
// instrument.ts isNum: `x *= c ? 3 : 1` is not checked (right operand type `1 | 3`); 3002399751580331*3 = 2^53+1 rounds to 2^53
export function compoundTernary(a: number, c: boolean): number { let x = a; x *= c ? 3 : 1; return x % 2; }
