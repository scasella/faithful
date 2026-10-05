// @sample library=remeda path=packages/remeda/src/internal/heap.ts commit=8e6e78f6eaf66eaf0b4797d72cc3691823c91335 license=MIT
// Copyright (c) 2018 remeda; MIT License; see LICENSES/remeda.txt

import { hasAtLeast } from "../hasAtLeast";

/**
 * A compare function that is compatible with the native `Array.sort` function.
 *
 * @returns >0 if `a` should come after `b`, 0 if they are equal, and <0 if `a` should come before `b`.
 */
export type CompareFunction<T> = (a: T, b: T) => number;

/**
 * Insert an item into a heap if it's "smaller" (in regards to `compareFn`) than
 * the current head of the heap (which is the "largest" value in the heap). If
 * the item is inserted, the previous head of the heap is returned, otherwise
 * `undefined` is returned and the heap is unchanged.
 *
 * @param heap - A *mutable* array representing a heap (see `heapify`).
 * @param compareFn - The comparator used to order items in the heap. Use the.
 * @param item - The item to be inserted into the heap.
 * @returns `undefined` if the heap is unchanged, or the previous head of the
 * heap if the item was inserted.
 */
export function heapMaybeInsert<T>(
  // eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- Intentional!
  heap: T[],
  compareFn: CompareFunction<T>,
  item: T,
): T | undefined {
  if (!hasAtLeast(heap, 1)) {
    return undefined;
  }

  const [head] = heap;

  if (compareFn(item, head) >= 0) {
    // The item shouldn't be inserted into the heap, the heap is unchanged.
    return undefined;
  }

  heap[0] = item;
  heapSiftDown(heap, 0, compareFn);
  return head;
}
