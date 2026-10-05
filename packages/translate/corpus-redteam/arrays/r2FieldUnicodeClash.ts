// @redteam area=arrays status=held
// @redteam note=fields "é", "_ue9" and "e": the sanitizer maps é to _ue9 (then v-prefixed); names must stay distinct
// @redteam expect=ok
// @redteam inputs=[[[{"é":1,"v_ue9":2,"e":3}]]]
type R = { "é": number; v_ue9: number; e: number };
export function f(rs: R[]): number[] {
  return rs.map((r) => r["é"] * 100 + r.v_ue9 * 10 + r.e);
}
