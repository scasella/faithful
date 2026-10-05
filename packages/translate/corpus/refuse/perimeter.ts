// @corpus class=refuse expect=refuse code=this
// @corpus note=a method written as a standalone function with a `this` parameter; its input arrives through `this`, not through declared arguments

/**
 * Perimeter of a rectangle, meant to be attached to rectangle objects as a method.
 *
 * @returns 2 * (width + height) of the receiver
 */
export function perimeter(this: { width: number; height: number }): number {
  return 2 * (this.width + this.height);
}
