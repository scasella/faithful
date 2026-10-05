// @redteam area=strings status=held
// @inputs [[["\u00e9","z","Z","\uffff","\ud7ff","\ue000","","a","aa"]],[[]],[["b","a","b","a"]]]
export function f(xs: string[]): string { return xs.slice().sort().join("/"); }
