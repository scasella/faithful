// @redteam status=held
// @redteam expect=refuse code=dictionary|unsupported-type
// @redteam inputs=[[[1,2]]]
// Round 4 (arrays): a parameter whose type is an interface extending Array (not an array type to the checker).
interface Nums extends Array<number> {}
export function r4InterfaceExtendsArray(xs: Nums): number {
  return xs.length;
}
