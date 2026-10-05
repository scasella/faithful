// @redteam area=arithmetic status=held expect=ok
// @inputs [[-5,5],[-9007199254740992,-9007199254740987],[9007199254740987,9007199254740992],[3,-3]]
export function loopModParity(a: number, b: number): number { let c = 0; for (let i = a; i < b; i++) { if (i % 2 === -1) { c += 10; } else if (i % 2 === 0) { c -= 1; } else { c += 1; } } return c; }
