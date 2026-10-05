// @corpus class=refuse expect=refuse code=mutable-capture
// @corpus note=reads and writes a module-level `let`; the result depends on call history, so it is not a function of its arguments

let counter = 0;

/**
 * Generates sequential identifiers such as "user-1", "user-2", ...
 *
 * @param prefix - the identifier prefix
 * @returns `${prefix}-${n}` where n counts all calls so far
 */
export function nextId(prefix: string): string {
  counter = counter + 1;
  return `${prefix}-${counter}`;
}
