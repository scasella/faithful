// @redteam status=held
// @redteam expect=ok
// @redteam inputs=[[[1,2,3]],[[]]]
// Round 4 (arrays): tuple accumulator whose components swap every step.
export function r4ReduceTupleAccSwap(xs: number[]): [number, number] {
  const init: [number, number] = [0, 0];
  return xs.reduce((acc: [number, number], x): [number, number] => [acc[1], acc[0] + x], init);
}
