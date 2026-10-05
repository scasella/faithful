// @corpus class=numeric expect=ok
// @corpus throws
// @corpus note=Sign-mixed trap: JS % truncates (-7 % 3 === -1) while the quotient uses Math.floor (Math.floor(-7 / 3) === -3); the ((a % b) + b) % b fix-up gives the floor modulus with the sign of b, so q * b + r === a. A translator that emits Lean's % (Euclidean) disagrees for b < 0.

/**
 * Python-style divmod: returns [q, r] with q = floor(a / b) and
 * r = a - q * b, where r has the sign of b (or is 0).
 */
export function floorDivMod(a: number, b: number): [number, number] {
  if (b === 0) {
    throw new Error("division by zero");
  }
  const q = Math.floor(a / b);
  const r = ((a % b) + b) % b;
  return [q, r];
}
