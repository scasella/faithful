// @redteam area=control status=divergence input=[3] ts=module does not load (SyntaxError: Octal escape sequences are not allowed in strict mode) lean={"tag":"ok","value":6}
// @redteam-expect refuse:unsupported-syntax
// @redteam-note round 4: same root cause as r4ModuleOctalConstRead (diagnostics of module constants the function reads are not checked): a string constant with a legacy octal escape (`"a\1b"`, TS1487) is inlined as a 3-unit string. The ES module cannot load. Also reproduced (not filed separately): `const K = 1__0` (TS6189, model K = 10) and `const K = 010, J = 1` with the function reading only J (the statement is copied verbatim into plainTs; model n + 1).
const S = "a\1b";
export function f(n: number): number { return S.length + n; }
