// @redteam area=strings status=held
// @inputs [[["\u00e9","a"]],[["a","\u00e9"]],[["abcdefghijk"]],[["\u00e9bcdefghijk"]]]
export function f(xs: string[]): string { return xs.reduce((acc, x) => x.charCodeAt(9) + acc + x.toUpperCase(), ""); }
