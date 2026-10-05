// @redteam area=control status=held
// @redteam-expect refuse:unsupported-syntax
// @redteam-note round 4: lexical declaration in single-statement position (strict-mode SyntaxError): must be refused, never accepted with a model
export function f(n: number): number { if (n > 0) let x = 1; return n; }
