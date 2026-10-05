// @redteam area=strings status=held
// @inputs [[""],["-"]]
export function f(s: string): string { return `${0.5e1}|${.5e1}|${1e3}|${0x1F}|${0b101}|${0o17}|${1_000}|${9007199254740991.5}|${-0}|${50e-1}` + s + 1e1; }
