// @redteam area=strings status=held
// @inputs [[["b","a","ba","","￿"]],[[]],[["é","z"]]]
export function f(xs: string[]): string { return xs.reduce((m, x) => (x > m ? x : m), ""); }
