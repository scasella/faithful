// @redteam area=arithmetic status=held expect=ok
// @inputs [[0],[1],[-1],[9007199254740992]]
// accepted although NOTES.md says literals not exactly representable are refused; TS normalizes the literal text, the model carries the JS value 2^53, so no semantic divergence (doc mismatch, see report)
export function unrepresentableLiteral(a: number): number { return a - 9007199254740993 + 0x20000000000001; }
