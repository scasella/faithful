// @redteam area=arrays status=held
// @redteam expect=ok
// @redteam inputs=[[[{"k":1,"id":0},{"k":0,"id":1},{"k":1,"id":2},{"k":0,"id":3},{"k":1,"id":4}]],[[]],[[{"k":9007199254740992,"id":0},{"k":-9007199254740992,"id":1},{"k":9007199254740992,"id":2}]]]
interface Item { k: number; id: number }
export function byK(rs: Item[]): number[] {
  return rs.slice().sort((a, b) => a.k - b.k).map((r) => r.id);
}
