// @redteam area=arrays status=held
// @redteam note=a record field named length next to array .length
// @redteam expect=ok
// @redteam inputs=[[[{"length":5,"name":"ab"},{"length":-1,"name":""}]]]
type R = { length: number; name: string };
export function lens(rs: R[]): number[] {
  return rs.map((r) => r.length * 100 + r.name.length + rs.length);
}
