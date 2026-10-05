// @redteam area=arrays status=held
// @redteam expect=ok
// @redteam inputs=[[["a","","b"]],[[]],[[""]],[[",",","]]]
export function rj(xs: string[]): boolean {
  return xs.reduce((acc, x, i) => acc + (i > 0 ? "," : "") + x, "") === xs.join();
}
