// @redteam area=control status=divergence input=[3] ts=module does not load (SyntaxError: Decimals with leading zeros are not allowed in strict mode; harness: "the original did not load in the sandbox") lean={"tag":"ok","value":27}
// @redteam-expect refuse:unsupported-syntax
// @redteam-note round 4: same as r4ModuleOctalConstRead with a legacy leading-zero decimal (`09`, TS1489) used as a loop bound. Inside the function `i < 09` is refused (r4LeadingZeroDecimal); read through a module constant it is accepted with K = 9 (the loop runs 9 times in the model) while the ES module cannot load.
const K = 09;
export function f(n: number): number { let s = 0; for (let i = 0; i < K; i++) s += n; return s; }
