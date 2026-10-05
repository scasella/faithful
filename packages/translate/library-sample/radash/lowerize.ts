// @sample library=radash path=src/object.ts commit=4cab1900d08e0997abc4f17aec3cbfe18958d766 license=MIT
// Copyright (c) 2022 radash; MIT License; see LICENSES/radash.txt

type LowercasedKeys<T extends Record<string, any>> = {
  [P in keyof T & string as Lowercase<P>]: T[P]
}

/**
 * Convert all keys in an object to lower case
 */
export const lowerize = <T extends Record<string, any>>(obj: T) =>
  mapKeys(obj, k => k.toLowerCase()) as LowercasedKeys<T>
