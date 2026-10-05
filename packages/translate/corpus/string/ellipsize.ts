// @corpus class=string expect=ok
// @corpus note=sign-mixed Math.ceil/Math.floor feeding slice: for max < 1 the halves go negative and slice counts from the end. ellipsize("abcdef", -1): keep=-2, head=-1, s.slice(0,-1)="abcde", tail=-1, s.slice(7)="" -> "abcde…". ellipsize("abcdef", -2): keep=-3, head=Math.ceil(-1.5)=-1 (truncation also -1, floor would be -2). "…" is U+2026, one BMP code unit. Math.ceil(-1/2) is -0 in JS; slice treats it as 0.

/**
 * Shortens `s` to at most `max` code units by replacing its middle with an ellipsis,
 * keeping slightly more of the start than of the end.
 *
 * @example ellipsize("abcdefghij", 6) // "abc…ij"
 * @example ellipsize("short", 10)     // "short"
 */
export function ellipsize(s: string, max: number): string {
  if (s.length <= max) {
    return s;
  }
  const keep = max - 1;
  const head = Math.ceil(keep / 2);
  const tail = Math.floor(keep / 2);
  return s.slice(0, head) + "…" + s.slice(s.length - tail);
}
