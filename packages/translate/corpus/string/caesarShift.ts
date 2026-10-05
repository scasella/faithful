// @corpus class=string expect=ok
// @corpus note=sign-mixed truncated %: for a negative shift, (code - 97 + shift % 26) % 26 can be negative in JS (e.g. "a" with shift -1 gives -1), and charAt(-1) is "", so the letter is DROPPED: caesarShift("abc", -1) === "ab". Emitting Lean's Euclidean % instead of Int.tmod would yield "zab". charCodeAt(i) stays in bounds (i < text.length). Non-ASCII letters such as "é" pass through unchanged.

/**
 * Shifts ASCII letters by `shift` places in the alphabet, preserving case; other characters are copied.
 *
 * @example caesarShift("Hello, World!", 3) // "Khoor, Zruog!"
 * @example caesarShift("xyz", 29)          // "abc"
 */
export function caesarShift(text: string, shift: number): string {
  const lower = "abcdefghijklmnopqrstuvwxyz";
  const upper = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const k = shift % 26;
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 97 && code <= 122) {
      out += lower.charAt((code - 97 + k) % 26);
    } else if (code >= 65 && code <= 90) {
      out += upper.charAt((code - 65 + k) % 26);
    } else {
      out += text.charAt(i);
    }
  }
  return out;
}
