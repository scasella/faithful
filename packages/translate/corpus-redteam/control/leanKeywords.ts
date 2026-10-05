// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[1,2,3,4,5,6,7,8]]
export function f(match: number, end: number, by: number, from: number, at: number, fun: number, then: number, where: number): number { let open = match + end; const section = by * from; let variable = at - fun; const structure = then + where; return open + section + variable + structure; }
