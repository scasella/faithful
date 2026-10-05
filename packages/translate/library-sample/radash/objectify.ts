// @sample library=radash path=src/array.ts commit=4cab1900d08e0997abc4f17aec3cbfe18958d766 license=MIT
// Copyright (c) 2022 radash; MIT License; see LICENSES/radash.txt

/**
 * Convert an array to a dictionary by mapping each item
 * into a dictionary key & value
 */
export const objectify = <T, Key extends string | number | symbol, Value = T>(
  array: readonly T[],
  getKey: (item: T) => Key,
  getValue: (item: T) => Value = item => item as unknown as Value
): Record<Key, Value> => {
  return array.reduce((acc, item) => {
    acc[getKey(item)] = getValue(item)
    return acc
  }, {} as Record<Key, Value>)
}
