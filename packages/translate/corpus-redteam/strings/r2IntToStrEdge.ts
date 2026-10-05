// @redteam area=strings status=held
// @inputs [[0],[-1],[9007199254740992],[-9007199254740992],[-7],[-3],[1000000],[123456789012345]]
export function f(n: number): string[] { return ["" + n, `${n}`, [n, -n, 0 - n].join(":"), "" + n % 7, "" + Math.ceil(n / 4), "" + Math.floor(n / -3)]; }
