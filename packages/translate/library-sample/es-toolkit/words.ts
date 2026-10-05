// @sample library=es-toolkit path=src/string/words.ts commit=43e1118884e07cebdf1e767038f6e7f697fa27ec license=MIT
// Copyright (c) 2024 Viva Republica, Inc.; MIT License; see LICENSES/es-toolkit.txt

/**
 * Splits `string` into an array of its words, treating spaces and punctuation marks as separators.
 *
 * @param str The string to inspect.
 * @param [pattern] The pattern to match words.
 * @returns Returns the words of `string`.
 *
 * @example
 * words('fred, barney, & pebbles');
 * // => ['fred', 'barney', 'pebbles']
 *
 * words('camelCaseHTTPRequest🚀');
 * // => ['camel', 'Case', 'HTTP', 'Request', '🚀']
 *
 * words('Lunedì 18 Set')
 * // => ['Lunedì', '18', 'Set']
 */
export function words(str: string): string[] {
  return Array.from(str.match(CASE_SPLIT_PATTERN) ?? []);
}
