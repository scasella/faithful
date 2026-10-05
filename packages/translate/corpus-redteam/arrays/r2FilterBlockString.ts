// @redteam area=arrays status=held
// @redteam note=filter callback with a block body returning a string (truthiness of "" vs non-empty); must be refused
// @redteam expect=refuse code=unsupported-type
// @redteam inputs=[[["","a","","bc"]]]
export function nonEmpty(xs: string[]): string[] {
  return xs.filter((s) => {
    return s;
  });
}
