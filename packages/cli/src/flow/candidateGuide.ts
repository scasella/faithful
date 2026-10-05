/**
 * Prompt text for candidate proofs (docs/PROOFS.md, "Candidate proofs"). Shown after the general proof guide. Nothing here
 * changes what is checked; it only tells the model what the obligations are and which strategies work. The worked example
 * is a SYNTHETIC function (not from the measured corpus); every Lean line in it was compiled against Lean 4.34.0 + the
 * pinned Mathlib with `Faithful.Tactics` (including `Faithful.Chk`) on models emitted by the translator.
 */
import type { CandidateTheorem } from './candidateProof.js';

/** Split mode without the candidate guide: only says which part this is. */
export const SPLIT_NOTE_EQ = `THIS THEOREM IS ONE OF TWO PARTS. The full claim about the optimized candidate (\`..._cand\`) is "it stays inside the model's range AND equals the spec"; this part is ONLY the equality with the spec (the range part is a separate theorem). Theorems under "already proved" in the file are checked and may be used.`;
export const SPLIT_NOTE_RANGE = `THIS THEOREM IS ONE OF TWO PARTS. The full claim about the optimized candidate (\`..._cand\`) is "it stays inside the model's range AND equals the spec"; this part is ONLY the range part: the candidate's precondition (\`..._cand_pre\`: its input bounds and its checked twin \`..._cand_chk\` never failing a range check) follows from the ORIGINAL's precondition. Theorems under "already proved" in the file are checked and may be used.`;

const SHAPES = String.raw`CANDIDATE PROOFS: WHAT IS IN THE FILE
- The file has the ORIGINAL model (\`Model.f\`, its loops \`Model.f_loopN\`, its checked twin \`Model.f_chk\` / \`Model.f_loopN_chk\`,
  \`Model.f_rangeOk\`, \`Model.f_pre\`) and the CANDIDATE model with the same shapes under \`Model.f_cand...\`. The hypotheses are
  the ORIGINAL's precondition (and the original's no-throw/carve-out conditions); the conclusion is about the CANDIDATE.
- \`original_meets_spec\` (when present under "already proved") is the checked proof that the original meets the spec.`;

const EQUALITY = String.raw`EQUALITY (\`Model.f_cand args = Spec.spec args\`)
- Prove one lemma per candidate loop for ARBITRARY loop state (no hypotheses if possible: a statement that holds for every
  state is easiest to induct on), then instantiate it at the initial state. Example (synthetic; compiled):
    -- candidate: let s = 0; let i = n; while (i > 0) { s = s + i; i = i - 1; } return s;   spec: Spec.tri n.toNat
    theorem cand_loop_eq : ∀ (s i : Int), (Model.sumTo_cand_loop1 s i).1 = s + Spec.tri i.toNat := by
      intro s i
      fun_induction Model.sumTo_cand_loop1 s i with
      | case1 s i h s_1 i_1 ih =>          -- binders of the MODEL loop: state, branch hyp, one per let, then ih
        rw [ih]
        simp only [s_1, i_1]
        have : i.toNat = (i - 1).toNat + 1 := by omega
        rw [this, Spec.tri]
        omega
      | case2 s i h =>
        have : i.toNat = 0 := by omega
        simp [this, Spec.tri]
    -- then:  simp only [Model.sumTo_cand, Spec.spec, cand_loop_eq]; omega
- An INDEX loop (\`i\` up to \`xs.length\`, reading \`Faithful.getD xs i\`) against a recursion or fold over the list: state the
  loop lemma for arbitrary state and \`0 ≤ i\` over the unvisited suffix, e.g.
  \`(Model.f_cand_loop1 xs n acc i).1 = (xs.drop i.toNat).foldl g acc\` with \`n = (xs.length : Int)\` as a hypothesis (the
  model binds \`n\` with a \`let\`); step it with \`Faithful.drop_eq_getD_cons xs h0 h1\` or \`Faithful.foldl_drop_step\`
  (\`0 ≤ i\`, \`i < xs.length\`), and close the exit case with \`Faithful.drop_toNat_of_length_le\`. At \`i = 1\` on
  \`x :: rest\`, \`(x :: rest).drop 1 = rest\` (\`simp\`).
- Strings: \`s.charCodeAt(i)\` is \`Faithful.charCodeAt s i\`; in bounds, \`Faithful.charCodeAt_of_lt\` gives
  \`((Faithful.getD s i).toNat : Int)\` and \`Faithful.charCodeAt_eq_iff\` turns a comparison of two codes into a comparison of
  the characters (\`Faithful.char_toNat_cast_inj\` is simp); \`s.charAt(i)\` is \`Faithful.charAt_of_lt\`.
- Alternative route: prove \`Model.f_cand args = Model.f args\` and finish with \`original_meets_spec\` (it needs the same
  hypotheses, which you have).`;

const RANGE = String.raw`RANGE (\`Model.f_cand_pre args = true\`)
- \`Model.f_cand_pre args\` is (input bounds) && \`Model.f_cand_rangeOk args\`; the input bounds are the same conjuncts as in
  \`Model.f_pre args\`. \`rangeOk\` is \`Faithful.rangeOkOf (Model.f_cand_chk args)\`: the checked twin is the same computation
  in \`Faithful.Chk\` with \`Faithful.ck (Faithful.inRange e) "..."\` before every operation whose result must stay within
  ±2^53 (and \`Faithful.inBounds\` for indices, \`decide (d ≠ 0)\` for divisors).
- Plan: (1) get a BOUND from the ORIGINAL's precondition: the original also stayed in range, so every value it computed is
  within ±2^53; (2) show every value the CANDIDATE computes is bounded by those values (or by the input bounds, or by a
  closed bound such as a monotone spec function); (3) prove a TRANSFER lemma per candidate loop:
  \`Model.f_cand_loopN_chk args st = Except.ok (Model.f_cand_loopN args st)\` for arbitrary state satisfying a bound
  invariant, then \`rw\` it and close with \`rfl\` (or \`Faithful.rangeOkOf_of_eq_ok\`).
- Library (Faithful.Chk): \`Faithful.rangeOkOf_ck_bind\` (simp): \`rangeOkOf (ck b d >>= f) = (b && rangeOkOf (f ()))\`;
  \`Faithful.rangeOkOf_of_bind x f : rangeOkOf (x >>= f) = true → rangeOkOf x = true\` (a passing run passed its loop);
  \`Faithful.rangeOkOf_bind_of_eq_ok (h : x = .ok a) f : rangeOkOf (x >>= f) = rangeOkOf (f a)\`; \`Faithful.ck_eq\`:
  \`ck b d = if b = true then .ok () else .error (.range d)\`; \`Faithful.rangeOkOf_of_eq_ok\`; \`Faithful.inRange_eq_true\` (simp).
- \`fun_induction F args\` (model loop or checked loop) ALREADY unfolds \`F args\` one step in every case: case1's goal shows the
  recursive call on the next state (so \`rw [ih]\` applies directly), case2's shows the returned state. Do NOT
  \`rw [F]\`/\`unfold F\` afterwards ("Failed to rewrite using equation theorems" / "motive is not type correct"); use
  \`simp only [lets..]\`, \`split\`, \`rw [ih ..]\`. To unfold a DIFFERENT function there (e.g. the model loop on the right of a
  transfer lemma) use \`rw [Model.g.eq_1]\`.
- \`fun_induction\` on a CHECKED loop (\`Model.f_loopN_chk\`): its case1 binds ONLY the state, the branch hypothesis and the
  induction hypothesis (the lets are inside the ih as \`have\`s), and the call in the goal/hypotheses is ALREADY unfolded one
  step (a \`do\` block): do not \`rw\` the definition again, read it with \`simp only [...] at h\`.
- Example (synthetic; compiled). Original: \`let s = 0; for (let i = 1; i <= n; i++) s = s + i; return s;\`, candidate as above.
    -- (1) what a passing run of the ORIGINAL's loop says
    theorem orig_loop_bound (n : Int) : ∀ (s i : Int), 1 ≤ i → i ≤ n → s = Spec.tri (i - 1).toNat →
        Faithful.rangeOkOf (Model.sumTo_loop1_chk n s i) = true → Spec.tri n.toNat ≤ 9007199254740992 := by
      intro s i
      fun_induction Model.sumTo_loop1_chk n s i with
      | case1 s i h ih =>
        intro h1 h2 hs hok
        simp only [Faithful.rangeOkOf_ck_bind, Bool.and_eq_true, Faithful.inRange_eq_true] at hok
        obtain ⟨⟨_, hle⟩, _, hrest⟩ := hok
        have hstep : s + i = Spec.tri i.toNat := by
          have : i.toNat = (i - 1).toNat + 1 := by omega
          rw [this, Spec.tri, hs]; omega
        by_cases hlast : i = n
        · subst hlast; omega
        · have hs' : s + i = Spec.tri (i + 1 - 1).toNat := by rw [show i + 1 - 1 = i by omega]; exact hstep
          exact ih (by omega) (by omega) hs' hrest
      | case2 s i h =>
        intro h1 h2; omega
    -- (3) the CANDIDATE's checked loop passes and computes the model's value
    theorem cand_chk_ok : ∀ (s i : Int), 0 ≤ s → i ≤ 9007199254740992 → s + Spec.tri i.toNat ≤ 9007199254740992 →
        Model.sumTo_cand_loop1_chk s i = Except.ok (Model.sumTo_cand_loop1 s i) := by
      intro s i
      fun_induction Model.sumTo_cand_loop1_chk s i with
      | case1 s i h ih =>
        intro hs hi hb
        have ht : Spec.tri i.toNat = Spec.tri (i - 1).toNat + i := by
          have : i.toNat = (i - 1).toNat + 1 := by omega
          rw [this, Spec.tri]; omega
        have hn := tri_nonneg (i - 1).toNat          -- a helper lemma, proved by induction
        rw [Model.sumTo_cand_loop1.eq_1]
        simp only [h, ite_true, Faithful.ck_eq, Faithful.inRange_eq_true,
          show -9007199254740992 ≤ s + i ∧ s + i ≤ 9007199254740992 by omega,
          show -9007199254740992 ≤ i - 1 ∧ i - 1 ≤ 9007199254740992 by omega]
        exact ih (by omega) (by omega) (by omega)
      | case2 s i h =>
        intro _ _ _
        rw [Model.sumTo_cand_loop1.eq_1]
        simp [h]
    -- (2)+(3) the range theorem
    theorem range_part : ∀ (n : Int), Model.sumTo_pre n = true → Model.sumTo_cand_pre n = true := by
      intro n h1
      simp only [Model.sumTo_pre, Model.sumTo_rangeOk, Model.sumTo_chk, Bool.and_eq_true, Faithful.inRange_eq_true] at h1
      obtain ⟨hn, hok⟩ := h1
      have hloop := Faithful.rangeOkOf_of_bind _ _ hok
      have hbound : Spec.tri n.toNat ≤ 9007199254740992 := by
        by_cases h : 1 ≤ n
        · exact orig_loop_bound n 0 1 (by omega) h (by simp [Spec.tri]) hloop
        · have : n.toNat = 0 := by omega
          simp [this, Spec.tri]
      simp only [Model.sumTo_cand_pre, Model.sumTo_cand_rangeOk, Model.sumTo_cand_chk, Bool.and_eq_true, Faithful.inRange_eq_true]
      refine ⟨hn, ?_⟩
      rw [cand_chk_ok 0 n (by omega) (by omega) (by omega)]
      rfl
- When the candidate computes the SAME values as the original (same state sequence), relate the two checked loops directly:
  prove by induction that a passing run of the original's loop from state st gives a passing run of the candidate's loop
  from the corresponding state (the same \`inRange\` facts discharge the candidate's checks).
- Unbounded recursion depth: the original's checked twin may also check a depth counter (\`τd < 500\`); that is a bound too.`;

const LENGTH_FACTS = String.raw`- The statement also has hypotheses \`(xs.length : Int) ≤ 4294967295\` (arrays) / \`(s.length : Int) ≤ 9007199254740991\`
  (strings): every JavaScript array and string satisfies them. Use them to bound loop indices and counters
  (\`i < xs.length\` gives \`i + 1 ≤ 4294967295\`).`;

export function candidateGuideText(kind: 'whole' | 'equality' | 'range', th: CandidateTheorem | null): string {
  const shapes = th?.lengthFacts ? `${SHAPES}\n${LENGTH_FACTS}` : SHAPES;
  if (kind === 'equality') return [SPLIT_NOTE_EQ, shapes, EQUALITY].join('\n\n');
  if (kind === 'range') return [SPLIT_NOTE_RANGE, shapes, RANGE].join('\n\n');
  return [
    'THE THEOREM HAS TWO OBLIGATIONS: the RANGE part (`Model.f_cand_pre args = true`) and the EQUALITY part (`Model.f_cand args = Spec.spec args`). Prove them as two helper theorems and combine them with `⟨range .., eq ..⟩`.',
    shapes,
    EQUALITY,
    RANGE,
  ].join('\n\n');
}
