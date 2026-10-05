// @redteam area=strings status=held
// @inputs [[[{"name":"😀"}]],[[{"name":"ab"}]]]
interface P { name: string }
export function f(xs: P[]): number[] { return xs.map((x) => x.name.length); }
