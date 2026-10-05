// @sample library=es-toolkit path=src/compat/array/pullAll.ts commit=43e1118884e07cebdf1e767038f6e7f697fa27ec license=MIT
// Copyright (c) 2024 Viva Republica, Inc.; MIT License; see LICENSES/es-toolkit.txt

import { pull as pullToolkit } from '../../array/pull.ts';

export type Equals<T, U> = (<X>() => X extends T ? 1 : 2) extends <X>() => X extends U ? 1 : 2 ? true : false;

export interface MutableList<T> {
  length: number;
  [k: number]: T;
}

export type IsWritable<T> = Equals<{ [K in keyof T]: T[K] }, { -readonly [K in keyof T]: T[K] }>;

export type RejectReadonly<T extends MutableList<unknown>> = IsWritable<T> extends true ? T : never;

/**
 * This method is like `_.pull` except that it accepts an array of values to remove.
 *
 * **Note:** Unlike `_.difference`, this method mutates `array`.
 *
 * @template T
 * @param array - The array to modify.
 * @param [values] - The values to remove.
 * @returns Returns `array`.
 *
 * @example
 * var array = [1, 2, 3, 1, 2, 3];
 *
 * pullAll(array, [2, 3]);
 * console.log(array);
 * // => [1, 1]
 */
export function pullAll<T>(array: T[], values?: ArrayLike<T>): T[];

/**
 * This method is like `_.pull` except that it accepts an array of values to remove.
 *
 * **Note:** Unlike `_.difference`, this method mutates `array`.
 *
 * @template L
 * @param array - The array to modify.
 * @param [values] - The values to remove.
 * @returns Returns `array`.
 *
 * @example
 * var array = [1, 2, 3, 1, 2, 3];
 *
 * pullAll(array, [2, 3]);
 * console.log(array);
 * // => [1, 1]
 */
export function pullAll<L extends MutableList<any>>(array: RejectReadonly<L>, values?: ArrayLike<L[0]>): L;

/**
 * Removes all specified values from an array.
 *
 * This function changes `arr` in place.
 * If you want to remove values without modifying the original array, use `difference`.
 *
 * @template T
 * @param arr - The array to modify.
 * @param valuesToRemove - The values to remove from the array.
 * @returns The modified array with the specified values removed.
 *
 * @example
 * const numbers = [1, 2, 3, 4, 5, 2, 4];
 * pullAll(numbers, [2, 4]);
 * console.log(numbers); // [1, 3, 5]
 */
export function pullAll<T>(arr: T[], valuesToRemove: ArrayLike<T> = []): T[] {
  if (arr?.length == null || valuesToRemove?.length == null) {
    return arr;
  }

  return pullToolkit(arr, Array.from(valuesToRemove));
}
