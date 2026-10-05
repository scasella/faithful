// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[3,1,2,3,4,5,6,7,8],[0,0,0,0,0,0,0,0,0]]
export function f(example: number, axiom: number, omega: number, simp: number, decide: number, rfl: number, calc: number, show: number, have: number): number { for (let instance = 0; instance < example; instance++) { axiom = axiom + omega; } return axiom + simp + decide + rfl + calc + show + have; }
