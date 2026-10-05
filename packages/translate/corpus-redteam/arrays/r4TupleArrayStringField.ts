// @redteam status=held
// @redteam expect=ok
// @redteam inputs=[[[[[1,2],"ab"],[[],""]]]]
// Round 4 (arrays): tuples holding arrays and strings, tuple results.
export function r4TupleArrayStringField(ps: [number[], string][]): [string, number][] {
  return ps.map((p): [string, number] => [p[1] + p[0].join("-"), p[0].length + p[1].length]);
}
