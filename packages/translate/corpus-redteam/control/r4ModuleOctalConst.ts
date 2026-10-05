// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[0],[3]]
// @redteam-note round 4: unread module-level `const K = 010` (a strict-mode SyntaxError in an ES module, so the real module cannot load). Accepted; the harness's transpiled plainTs runs. Same class as the documented module-load residual gap (NOTES 'Module scan': no claim about the function is observable when the module cannot be imported); recorded, not counted as a divergence
const K = 010;
export function f(n: number): number { return n + 1; }
