// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[[1,-2,3,0]],[[]],[[-1,-1]]]
// @redteam-note round 4: if/else-if join assigning both an outer variable and a body-local let
export function f(xs: number[]): string { let acc = 0; let log = ""; for (const x of xs) { let local = x; if (x < 0) { local = -x; acc -= 1; } else if (x === 0) { log = log + "z"; } log = log + local; } return log + ":" + acc; }
