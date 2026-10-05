// @corpus class=string expect=ok
// @corpus note=case-insensitive via toLowerCase (ascii precondition): JS maps 'İ' (U+0130) to two code units "i̇", which shifts every index after it; the Lean model maps ASCII letters only.

/**
 * Returns true when `text` reads the same forwards and backwards, ignoring letter case.
 * The empty string and single characters are palindromes.
 *
 * @example isPalindrome("Racecar") // true
 * @example isPalindrome("abca")    // false
 */
export function isPalindrome(text: string): boolean {
  const s = text.toLowerCase();
  let i = 0;
  let j = s.length - 1;
  while (i < j) {
    if (s.charAt(i) !== s.charAt(j)) {
      return false;
    }
    i++;
    j--;
  }
  return true;
}
