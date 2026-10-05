// @sample library=radash path=src/array.ts commit=4cab1900d08e0997abc4f17aec3cbfe18958d766 license=MIT
// Copyright (c) 2022 radash; MIT License; see LICENSES/radash.txt

/**
 * Sort an array without modifying it and return
 * the newly sorted value. Allows for a string
 * sorting value.
 */
export const alphabetical = <T>(
  array: readonly T[],
  getter: (item: T) => string,
  dir: 'asc' | 'desc' = 'asc'
) => {
  if (!array) return []
  const asc = (a: T, b: T) => `${getter(a)}`.localeCompare(getter(b))
  const dsc = (a: T, b: T) => `${getter(b)}`.localeCompare(getter(a))
  return array.slice().sort(dir === 'desc' ? dsc : asc)
}
