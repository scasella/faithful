// @redteam area=strings status=held
// @inputs [[{"tags":[["x😀",true]]}],[{"tags":[["xy",false]]}],[{"tags":[]}]]
export function f(r: { tags: [string, boolean][] }): number { return r.tags.length > 0 ? r.tags[0][0].length : -1; }
