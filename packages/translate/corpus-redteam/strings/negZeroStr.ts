// @redteam area=strings status=held
// @inputs [[0,-1],[0,1],[-3,0],[0,0]]
export function negZeroStr(a: number, b: number): string {
  const p = a * b;
  return "" + p + `/${p}/` + [p].join() + (-p);
}
