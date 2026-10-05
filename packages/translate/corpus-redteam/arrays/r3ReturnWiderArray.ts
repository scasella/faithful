// @redteam area=arrays status=held
// @redteam note=width subtyping: returning W[] where N[] is declared
// @redteam expect=refuse code=unsupported-type|unsupported-syntax
// @redteam inputs=[[[{"a":2,"b":3}]]]
type W = { a: number; b: number };
type N = { a: number };
export function retArr(ws: W[]): N[] {
  return ws.filter((w) => w.a > 0);
}
