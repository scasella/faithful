// @redteam area=arrays status=held
// @redteam note=a map callback inside a for loop inside a map callback, reading the inner loop's const
// @redteam expect=ok
// @redteam inputs=[[[[1,2],[3]],2],[[],0],[[[]],3]]
export function f(xss: number[][], n: number): number[][] {
  return xss.map((xs) => {
    let acc: number[] = [];
    for (let k = 0; k < n; k++) {
      const off = k * 10;
      acc = acc.concat(xs.map((x) => x + off));
    }
    return acc;
  });
}
