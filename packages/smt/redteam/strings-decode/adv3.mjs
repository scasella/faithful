/**
 * Red-team round 3, strings-decode: adversarial concrete inputs for sanity mode (the encoding of one function
 * evaluated by Z3 on constants vs the instrumented function in the sandbox). Used by the vitest file and probe-adv.mjs.
 */
const P53 = 2 ** 53;
const pows = [];
for (let k = 0; k <= 15; k++) {
  const p = 10 ** k;
  pows.push([p], [p - 1], [-p], [-(p - 1)]);
}
export const ADV3 = [
  [
    'String(n) at every power of ten and one below, both signs, and ±2^53',
    'export function f(n: number): string { return `${n}|${-n}|${n * 0}|${n}`.length + "|" + `${n}`.charAt(`${n}`.length - 1) + `${n}`.slice(1, 3); }',
    [...pows, [P53], [-P53], [P53 - 1], [-(P53 - 1)]],
  ],
  [
    'split on a symbolic separator at the edges',
    'export function f(s: string, t: string): string[] { return s.split(t).concat([s.split(t).join("|")]); }',
    [['aaaa', 'aa'], ['abab', 'ab'], ['aaa', 'aaa'], ['a', 'aa'], ['￿￿', '￿'], ['ba', 'a'], ['ab', 'a'], ['', 'a'], ['aaa', 'a'], ['\u0000', '\u0000'], ['abc', '']],
  ],
  [
    'sort with a subtracting comparator at ±2^53',
    'export function f(xs: number[]): number[] { return xs.slice().sort((a, b) => a - b).concat(xs.slice().sort((a, b) => b - a)); }',
    [[[P53, -P53]], [[-P53, P53, 0]], [[P53 - 1, -P53, P53]], [[]]],
  ],
  [
    'case maps on every ASCII letter boundary',
    'export function f(s: string): string { return s.toUpperCase() + "|" + s.toLowerCase() + "|" + (s.toUpperCase() < s.toLowerCase() ? "lt" : "ge"); }',
    [['@AZ['], ['`az{'], ['\u007f\u0000'], ['Zz'], ['']],
  ],
  [
    'string order with NUL prefixes and the top unit',
    'export function f(a: string, b: string): number { return (a < b ? 1 : 0) + (a <= b ? 2 : 0) + (a + b < b + a ? 4 : 0) + (a.slice(1) > b.slice(-1) ? 8 : 0); }',
    [['', '\u0000'], ['\u0000', ''], ['\u0000\u0000', '\u0000'], ['￿', '￾￿'], ['a\u0000', 'a'], ['퟿', '']],
  ],
  [
    'indexOf with symbolic needle and position at the edges',
    'export function f(s: string, t: string, p: number): number[] { return [s.indexOf(t, p), s.indexOf(t, s.indexOf(t) + 1), s.indexOf(t + t, -p)]; }',
    [['aaaa', 'aa', 3], ['aaaa', 'aa', -P53], ['', '', P53], ['abab', 'ab', 2], ['abab', 'b', 4], ['x', 'xx', 0]],
  ],
  [
    'join of string arrays with a symbolic separator and empty parts',
    'export function f(xs: string[], t: string): string { return xs.join(t) + "#" + xs.filter((x) => x.length > 0).join(t + t) + "#" + xs.join(); }',
    [[['', ''], ','], [[''], 'ab'], [[], 'x'], [['a', '', 'b'], ''], [[' ', ' '], '\u0000']],
  ],
];
