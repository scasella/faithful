// @redteam area=strings status=held
// @inputs [["ab"]]
interface P { name: string }
export function f(s: P["name"]): string { return s + s.length; }
