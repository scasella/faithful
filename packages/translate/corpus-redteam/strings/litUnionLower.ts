// @redteam area=strings status=divergence expect=ok input=["É"] ts=ok:"éÉ"(no-ascii-violation) lean=ok:"ÉÉ",asciiOk=false
// instrument.ts gates the lower/upper (ascii) helpers on TypeFlags.StringLike; a string-literal union receiver is a
// Union type, so the ascii check is missing from instrumentedTs.
// @inputs [["ab"],["É"],["İ"],["AB"]]
export function litUnionLower(s: "ab" | "É"): string {
  return s.toLowerCase() + s.toUpperCase();
}
