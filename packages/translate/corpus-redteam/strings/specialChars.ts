// @redteam area=strings status=held
// @inputs [[""],["\"\\\n\t\r"],["\u0000\u0001\u001f\u007f"],["\u2028\u2029\ufeff\uffff"],["'"],["{}"]]
export function specialChars(s: string): string {
  return s + "\u0000\u0001\"\\'\n\t\r\u007f\u0080\u2028\u2029\ufeff\uffff{x}" + s.length;
}
