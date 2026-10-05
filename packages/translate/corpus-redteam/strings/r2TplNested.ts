// @redteam area=strings status=held
// @inputs [[0,true,""],[-5,false,"\u0000"],[9007199254740992,true,"x"],[-9007199254740992,false,"\uffff"]]
export function f(n: number, b: boolean, s: string): string { return `a${`b${n}${`${b}`}`}c${s}${n < 0}${-n}`; }
