// @redteam area=arrays status=held
// @redteam note=filter callback (x, i) whose body loops over the captured array and returns from inside the loop
// @redteam expect=ok
// @redteam inputs=[[[2,3,2,5,3]],[[]],[[1,1,1]]]
export function firstOccurrences(xs: number[]): number[] {
  return xs.filter((x, i) => {
    for (let j = 0; j < i; j++) {
      if (xs[j] === x) return false;
    }
    return true;
  });
}
