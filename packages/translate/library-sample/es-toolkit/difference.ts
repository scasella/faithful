// @sample library=es-toolkit path=src/fp/array/difference.ts commit=43e1118884e07cebdf1e767038f6e7f697fa27ec license=MIT
// Copyright (c) 2024 Viva Republica, Inc.; MIT License; see LICENSES/es-toolkit.txt

import { difference as differenceToolkit } from '../../array/difference.ts';
import { combineEagerAndLazyFunctions, createLazyFunction } from '../_internal/lazy.ts';

/**
 * Creates a function that returns values from the piped array that are not present in another array.
 *
 * Equality follows SameValueZero through Set membership, matching the main
 * {@link difference} implementation. The returned function is lazy-capable
 * inside {@link pipe}.
 *
 * @template T - The type of elements in the arrays.
 * @param secondArray - Values to exclude from the piped array.
 * @returns A function that maps the piped array to its difference.
 *
 * @example
 * import { difference, pipe } from 'es-toolkit/fp';
 *
 * pipe([1, 2, 3], difference([2, 4]));
 * // => [1, 3]
 */
export function difference<T>(secondArray: readonly T[]): (array: readonly T[]) => T[] {
  const secondSet = new Set(secondArray);

  function differenceEager(array: readonly T[]): T[] {
    return differenceToolkit(array, secondArray);
  }

  const differenceLazy = createLazyFunction<T, T>((value, _index, emit) => {
    if (!secondSet.has(value)) {
      emit(value);
    }
  });

  return combineEagerAndLazyFunctions(differenceEager, differenceLazy);
}
