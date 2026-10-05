// @redteam area=arrays status=held
// @redteam note=logical assignment to an element of a local copy mutates the shared array
// @redteam expect=refuse code=unsupported-syntax
export function f(flags: boolean[]): boolean[] {
  const c = flags;
  c[0] ||= true;
  return flags;
}
