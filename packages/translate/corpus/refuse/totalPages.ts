// @corpus class=refuse expect=refuse code=async
// @corpus note=the body is pure integer arithmetic; only the async signature (Promise result) is outside the subset

/**
 * Total page count of a book given the page count of each chapter.
 *
 * @param chapterPages - pages per chapter
 * @returns a promise of the sum; 0 for no chapters
 */
export async function totalPages(chapterPages: number[]): Promise<number> {
  let total = 0;
  for (const p of chapterPages) {
    total = total + p;
  }
  return total;
}
