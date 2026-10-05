// @redteam area=strings status=held
// @inputs [[[-1,0,-9007199254740992],"é"],[[],""],[[5],"--"]]
export function f(xs: number[], sep: string): number { return xs.join(sep).length + xs.join().length; }
