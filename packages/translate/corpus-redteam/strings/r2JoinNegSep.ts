// @redteam area=strings status=held
// @inputs [[[],""],[[-1,0],","],[[9007199254740992,-9007199254740992],"\u0000"],[[5],"ab"]]
export function f(xs: number[], sep: string): string { return xs.join(sep) + "|" + xs.join() + "|" + [true, false].join(sep); }
