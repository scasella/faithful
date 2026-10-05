// @redteam area=arrays status=held
// @redteam expect=ok
// @redteam inputs=[[[true,false,true]],[[]]]
export function fb(bs: boolean[]): number {
  return bs.filter((b) => b).length * 100 + bs.indexOf(false) * 10 + (bs.includes(true) ? 1 : 0);
}
