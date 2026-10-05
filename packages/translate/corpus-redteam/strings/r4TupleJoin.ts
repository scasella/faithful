// @redteam area=strings status=held expect=refuse code=unsupported-library
// Round 4 note: completeness note: `[string, string]` tuples are not joinable, refused (not a divergence).
export function f(a: string, b: string): string { const t: [string, string] = [a, b]; return t.join("-"); }
