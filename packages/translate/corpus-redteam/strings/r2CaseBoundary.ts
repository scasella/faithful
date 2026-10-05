// @redteam area=strings status=held
// @inputs [["@[`{AZaz"],["\u007f~ "],[""],["M"]]
export function f(s: string): string[] { return [s.toUpperCase(), s.toLowerCase(), "@[`{AZaz\u007f".toLowerCase(), "@[`{AZaz".toUpperCase()]; }
