// @redteam area=arrays status=held
// @redteam expect=refuse code=unsupported-syntax
export function f(flags: boolean[], i: number): boolean[] {
  flags[i] &&= false;
  return flags;
}
