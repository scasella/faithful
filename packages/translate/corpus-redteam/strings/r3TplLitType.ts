// @redteam area=strings status=held expect=refuse code=unsupported-type
// @inputs [["id-3"]]
export function f(s: `id-${number}`): number { return s.length; }
