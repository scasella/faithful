// @redteam area=strings status=held
// @inputs [["ab,c,,d"],[""],[","],["\u00e9,z"]]
export function f(s: string): number { let acc = 0; for (const w of s.split(",")) { if (w === "") break; acc += w.length * 10 + w.charCodeAt(0); } return acc; }
