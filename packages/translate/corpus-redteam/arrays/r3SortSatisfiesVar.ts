// @redteam area=arrays status=held
// @redteam note=`(xs satisfies string[]).sort()` sorts the parameter in place
// @redteam expect=refuse code=unsupported-syntax
// @redteam inputs=[[["b","a"]]]
export function sv(xs: string[]): string[] {
  const ys = (xs satisfies string[]).sort();
  return ys.concat(xs);
}
