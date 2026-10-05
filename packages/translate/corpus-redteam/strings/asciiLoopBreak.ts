// @redteam area=strings status=held
// @inputs [[["a","b","STOP","é"]],[["é"]],[["STOP","é"]],[[]]]
export function asciiLoopBreak(xs: string[]): string {
  let acc = "";
  for (const x of xs) {
    if (x === "STOP") break;
    acc = acc + x.toLowerCase();
  }
  return acc;
}
