// @redteam area=strings status=held expect=refuse code=unsupported-syntax
export function refuseLengthKey(xs: string[]): string[] { return xs.slice().sort((a, b) => a.length - b.length); }
