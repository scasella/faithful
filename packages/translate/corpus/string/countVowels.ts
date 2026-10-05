// @corpus class=string expect=ok
// @corpus note=indexOf-as-contains on a one-character needle (never "", whose indexOf is 0). toLowerCase (ascii precondition): JS turns "İ" into "i̇", so countVowels("İ") === 1 in JS although the input has no ASCII vowel; accented vowels such as "é" are not counted; "y" is not a vowel here.

/**
 * Counts the vowels a, e, i, o, u in `text`, ignoring case.
 *
 * @example countVowels("Programming in TypeScript") // 6
 * @example countVowels("")                          // 0
 */
export function countVowels(text: string): number {
  const vowels = "aeiou";
  const lower = text.toLowerCase();
  let n = 0;
  for (let i = 0; i < lower.length; i++) {
    if (vowels.indexOf(lower.charAt(i)) !== -1) {
      n++;
    }
  }
  return n;
}
