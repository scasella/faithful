// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[0],[3]]
export function f(n: number): [number, string] { let t: [number, string] = [0, ""]; for (let i = 0; i < n; i++) { t = [t[0] + i, t[1] + "a"]; } return t; }
