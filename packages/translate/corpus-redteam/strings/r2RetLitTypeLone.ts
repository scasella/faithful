// @redteam area=strings status=held
// @inputs [[true],[false]]
export function f(b: boolean): "a" | "\uD800" { return "a"; }
