// @sample library=radash path=src/array.ts commit=4cab1900d08e0997abc4f17aec3cbfe18958d766 license=MIT
// Copyright (c) 2022 radash; MIT License; see LICENSES/radash.txt

/**
 * Given two arrays, returns true if any
 * elements intersect
 */
export const intersects = <T, K extends string | number | symbol>(
  listA: readonly T[],
  listB: readonly T[],
  identity?: (t: T) => K
): boolean => {
  if (!listA || !listB) return false
  const ident = identity ?? ((x: T) => x as unknown as K)
  const dictB = listB.reduce((acc, item) => {
    acc[ident(item)] = true
    return acc
  }, {} as Record<string | number | symbol, boolean>)
  return listA.some(value => dictB[ident(value)])
}
