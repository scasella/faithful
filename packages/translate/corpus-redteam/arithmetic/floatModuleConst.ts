// @redteam area=arithmetic status=held expect=refuse code=float
const K = 0.5;
export function floatModuleConst(a: number): number { return a + K; }
