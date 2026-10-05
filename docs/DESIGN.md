# Faithful: design contract

This is the document every package is built against. Rationale for deviations from the original brief is at the end.
Date of measurements below: 2026-10-04. Toolchain: Node v25.8.1, Lean 4.34.0, Mathlib `5ed2965256430c3649e86755f9576b54eca72435`
(v4.34.0), Z3 via `z3-solver` 5.2.0 (WASM) or system z3 5.1.0, Codex CLI 0.159.2, model `gpt-6-luna` (effort `low` for spec and candidate calls; proof attempts default to `high`, see docs/PROOFS.md), macOS arm64.

## Non-negotiables

* The translator (`packages/translate`) is deterministic code. No model call anywhere in it. The model never translates TypeScript
  to Lean and never edits the Lean model; it writes specs for the user to agree to and proofs for Lean to check.
* Codex runs read-only in an empty temp directory, one subprocess per request, serialized. It never runs `lake`, never reads the repo.
  The prover package checks every proof itself.
* Labels are exact (`packages/core/src/tiers.ts`). A failed proof is a failed proof. No scores, grades or percentages anywhere
  (the phrase "95% CI" for a confidence interval is the only permitted percent sign in user-facing text).
* "Proved" is always accompanied by `provedSentence(N)` from core. Never "proved for all inputs" about TypeScript.
* Every reported number carries a date, a model id and toolchain versions (`Stamp` in core).
* Never modify the user's source files. Delivery is a patch.
* Nothing leaves the machine except prompts to Codex, shown verbatim under every proposal and attempt ("What the model saw").
* Do not widen the subset to improve numbers. Refusals are findings.

## Packages and dependency direction

```
core        (added; see Deviations) hashing, subprocess runner with process-group kill, tier vocabulary, toolchain snapshot, .faithful store
translate   TS -> Lean 4 model, deterministic. depends: typescript only
engine      sandbox worker, differential tester, mutation tester, benchmark, evidence line. depends: core, translate
smt         IR/model -> SMT-LIB, Z3 driver (WASM first, system fallback). depends: core, translate
prover      Lean project mgmt, check endpoint, axiom extraction, Codex driver, spec + proof generation. depends: core, translate
cli         faithful commands + local server. depends: all
apps/ui     Preact + Vite browser UI served by the CLI process
apps/showcase  static replay site
lean/       Lake project: Lean 4.34.0 + Mathlib pinned by commit; `Faithful` library (runtime support for generated models)
```

## Toolchain facts (measured)

* Lean is installed under `~/.elan` (not on PATH). `findBinary` / `envWithToolDirs` in core handle that.
* Calling `lean` directly with `LEAN_PATH` (from `loadLeanEnv`) avoids 1-2 s of `lake env` start-up. Bare file: 0.38 s.
  `import Mathlib.Tactic.Linarith` + `Ring`: 1.4 s warm. `import Mathlib.Tactic` (everything): 4-13 s. The top-level `Mathlib` module is not
  in the cache. Decision: models and spec evaluation import only `Faithful.Core` (no Mathlib); proofs import a slim tactic set
  (`Faithful.Tactics`: Linarith, Ring, NormNum, Positivity, Omega is core). Never `import Mathlib`.
* `lean --json` emits one JSON object per message: `{severity, pos, endPos, data, kind, fileName}`. Goal states are inside `data` of
  `Tactic.unsolvedGoals` errors (`⊢`). `#print axioms t` arrives as an `information` message: `'t' depends on axioms: [a, b]`.
* In Lean 4.34 `native_decide` produces the axiom `<thm>._native.native_decide.ax_<n>_<m>`, not `Lean.ofReduceBool`.
  `tierFromAxioms` treats both as "Proved (trusting the compiler)". `sorry` yields `sorryAx` and is rejected.
* Batch many `#eval`s into one Lean process (`evalBatch` in prover). Outputs come back as `information` messages keyed by line.
* Z3: the WASM build runs in a worker thread that is terminated on timeout; the system binary uses `-T:` plus a process-group kill.
* Codex: `codex exec -` with the full flag set works. Each call carries about 19k input tokens of Codex overhead; a trivial call is ~5 s.

## Value domain and outcomes

See `packages/translate/src/contracts.ts`. Both sides of every comparison (TypeScript in the sandbox, Lean `#eval`, the spec, Z3
models) speak the same JSON `Val`: int -> number, bool, string, array and tuple -> array, record -> object, option -> `null` or the
inner value. Lean prints results with `Lean.Json` `ToJson` (`Json.compress`), so output parsing is a `JSON.parse`.
`Outcome` is `ok | throw | range-violation | fault`. A `fault` is never agreement.

## Integer semantics (the part most likely to be wrong)

`number` is `Int` (unbounded in Lean) with the precondition that every intermediate value is an integer in [-2^53, 2^53].
JS integer operations map as follows; the translator must use these exactly:

| TypeScript | Lean | note |
|---|---|---|
| `a + b`, `a - b`, `a * b` | `a + b` ... on `Int` | result range-checked by `rangeOk` |
| `a % b` | `Int.tmod a b` | JS `%` is truncated (sign of dividend): `-7 % 3 === -1`. Lean's `%` is Euclidean (`-7 % 3 = 2`). Never emit `%` |
| `Math.floor(a / b)` | `Int.fdiv a b` | the only accepted division pattern; `b = 0` is excluded by `rangeOk` |
| `Math.ceil(a / b)` | `-(Int.fdiv (-a) b)` | |
| bare `a / b` | refused, code `float` | not provably integer-valued |
| `Math.abs/min/max` | `Int.natAbs`-based abs, `min`, `max` | |
| `a === b` etc. | `decide (a = b)` | `==` is treated as `===` only when both operand types are identical primitives |

`rangeOk` is a second, mechanical interpretation of the same IR: each emitted function has a twin `<name>_ok` returning `Bool` that
mirrors its control structure (loops recurse the same way) and conjoins "this intermediate is an integer within +-2^53",
"this index is in bounds", "this divisor is non-zero" for every operation that executes. The theorem precondition is
`inputBounds args && rangeOk args`. The TS side enforces the same predicate with `instrumentedTs`: every arithmetic, index and
division result wrapped in a check that makes the function return outcome `range-violation`. Generators draw inputs, the
instrumented original filters them, and the Lean `rangeOk` is checked against the instrumented TS in the translator's own tests.

## Strings and arrays

`string` is `List Char` restricted to the Basic Multilingual Plane: `s.length` is the UTF-16 code-unit count, equal to the Char count
only for BMP text. Astral characters (surrogate pairs) are outside the model; kind `bmp` precondition. `toLowerCase`/`toUpperCase`
map ASCII letters only (Lean core has no Unicode case mapping, JS uses full Unicode mapping, including length-changing ones such as
`ß`): kind `ascii` precondition on strings that reach them. Arrays are `List`; `sort` is `List.mergeSort` with the translated comparator
(stable, as is JS); only comparators the translator can read as a total preorder are accepted. `charAt` out of range is `""`;
`charCodeAt` out of range would be NaN, so `rangeOk` forbids it; `a[i]` out of range is `undefined`, so `rangeOk` forbids it too (the
model reads with a total `getD`).

## Files and persistence

Everything is files under `<repo>/.faithful/<fn>/`: JSON and Lean, git-friendly, content-hashed (`FaithfulStore`). No database.

## Lean project

`lean/` pins the toolchain in `lean-toolchain` and Mathlib in `lakefile.toml`/`lake-manifest.json`. `faithful setup` states the cost,
then runs elan install (opt-in), `lake exe cache get`, `lake build`. Measured: `lake exe cache get` 47 s with a warm local cache
(8,908 files), `.lake` is 7.0 GB of Mathlib build output. The generated model imports `Faithful.Core` (in `lean/Faithful/Core.lean`),
which holds the runtime support (`Faithful.tmod`, `Faithful.getD`, JSON printing, string helpers).

## Testing conventions

* vitest at the repo root (`pnpm test`). Lean-dependent tests use `describe.skipIf(!hasLean)`, where `hasLean` is false when
  `FAITHFUL_SKIP_LEAN` is set. Do not weaken an assertion to make a test pass.
* `pnpm build` (tsc -b, then app builds) must stay green after every phase.
* Real Codex runs are slow and serialized. Never stub or estimate a number that the brief says to measure; record it from logs.

## Deviations from the brief (kept current)

1. Added `packages/core`: tiers, toolchain snapshot, subprocess runner and store are needed by prover, smt, engine and cli at once;
   putting them in `engine` would make `prover` and `smt` depend on `engine`, and `engine` needs both.
2. SMT encodes the translator's IR (the same IR the Lean emitter consumes) rather than parsing Lean text. The Lean model and the SMT
   encoding are two renderings of one IR; the SMT sanity mode (Phase 4) checks the encoding against Lean `#eval` on the corpus.
