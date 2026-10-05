// @redteam area=arrays status=held
// @redteam expect=ok
// @redteam inputs=[[[true,true]],[[false]],[[]]]
export function hasFalse(bs: boolean[]): number {
  return bs.includes(false) ? bs.indexOf(false) : bs.indexOf(true);
}
