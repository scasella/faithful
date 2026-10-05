// @sample library=remeda path=packages/remeda/src/forEachObj.ts commit=8e6e78f6eaf66eaf0b4797d72cc3691823c91335 license=MIT
// Copyright (c) 2018 remeda; MIT License; see LICENSES/remeda.txt

import type { EnumerableStringKeyedValueOf } from "./internal/types/EnumerableStringKeyedValueOf";
import { purry } from "./purry";

/**
 * A utility to preserve strings as-is, convert numbers to strings, and fail on
 * anything else. This happens a lot in JS when accessing objects or when
 * enumerating over keys.
 *
 * Notice that symbols are not supported, which is consistent with how built-in
 * functions like `Object.keys` and `Object.entries` behave.
 */
export type ToString<T> = T extends unknown
  ? T extends number
    ? `${T}`
    : T extends string
      ? T
      : never
  : never;

/**
 * A union of all keys of T which are not symbols, and where number keys are
 * converted to strings, following the definition of `Object.keys` and
 * `Object.entries`.
 *
 * Inspired and largely copied from [`sindresorhus/ts-extras`](https://github.com/sindresorhus/ts-extras/blob/44f57392c5f027268330771996c4fdf9260b22d6/source/object-keys.ts).
 *
 * @see EnumerableStringKeyedValueOf
 */
export type EnumerableStringKeyOf<T> =
  Required<T> extends Record<infer K, unknown> ? ToString<K> : never;

/**
 * Iterate an object using a defined callback function.
 *
 * The dataLast version returns the original object (instead of not returning
 * anything (`void`)) to allow using it in a pipe. The returned object is the
 * same reference as the input object, and not a shallow copy of it!
 *
 * @param data - The object who'se entries would be iterated on.
 * @param callbackfn - A function to execute for each element in the array.
 * @signature
 *    forEachObj(object, fn)
 * @example
 *    forEachObj({a: 1}, (val, key, obj) => {
 *      console.log(`${key}: ${val}`)
 *    }) // "a: 1"
 * @dataFirst
 * @category Object
 */
export function forEachObj<T extends object>(
  data: T,
  callbackfn: (
    value: EnumerableStringKeyedValueOf<T>,
    key: EnumerableStringKeyOf<T>,
    obj: T,
  ) => void,
): void;

/**
 * Iterate an object using a defined callback function.
 *
 * The dataLast version returns the original object (instead of not returning
 * anything (`void`)) to allow using it in a pipe. The returned object is the
 * same reference as the input object, and not a shallow copy of it!
 *
 * @param callbackfn - A function to execute for each element in the array.
 * @returns The original object (the ref itself, not a shallow copy of it).
 * @signature
 *    forEachObj(fn)(object)
 * @example
 *    pipe(
 *      {a: 1},
 *      forEachObj((val, key) => console.log(`${key}: ${val}`))
 *    ) // "a: 1"
 * @dataLast
 * @category Object
 */
export function forEachObj<T extends object>(
  callbackfn: (
    value: EnumerableStringKeyedValueOf<T>,
    key: EnumerableStringKeyOf<T>,
    obj: T,
  ) => void,
): (object: T) => T;

export function forEachObj(...args: readonly unknown[]): unknown {
  return purry(forEachObjImplementation, args);
}
