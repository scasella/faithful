// @redteam area=control status=held
// @redteam-expect refuse:non-bmp
// @redteam-note refused: this string literal contains characters outside the Basic Multilingual Plane (or a lone surrogate); strings are modeled as BMP text
export function f(n: number): number { if (n < 0) throw new Error("\uD800x"); return n; }
