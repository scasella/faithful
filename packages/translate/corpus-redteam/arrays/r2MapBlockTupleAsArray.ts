// @redteam area=arrays status=held
// @redteam note=map callback with a block body returns a tuple-typed local where number[] is declared
// @redteam expect=refuse code=unsupported-type
// @redteam inputs=[[[1,2]]]
export function pairs(xs: number[]): number[][] {
  return xs.map((x): number[] => {
    const t: [number, number] = [x, x + 1];
    return t;
  });
}
