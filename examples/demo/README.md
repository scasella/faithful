# Demo repository

Five small exported TypeScript functions to try Faithful on. They are copies of functions from the translator's test
corpus (`packages/translate/corpus`); the `// @corpus` comment lines at the top of each file are that corpus's labels and
Faithful ignores them.

| file | function | the translator |
|---|---|---|
| `src/aliquotSum.ts` | `aliquotSum(n)`: sum of the proper divisors of n | accepts it |
| `src/clamp.ts` | `clamp(value, lo, hi)`: restrict a value to [lo, hi]; throws when `lo > hi` | accepts it |
| `src/fibRecursive.ts` | `fibRecursive(n)`: the textbook recursive Fibonacci | accepts it |
| `src/sum.ts` | `sum(xs)`: sum of an array | accepts it |
| `src/medianMean.ts` | `medianMean(xs)`: median, the mean of the two middle elements for an even length | refuses it (code `float`, line 20: the bare `/ 2` is not provably an integer) |

## Run it

From the repository root, after `pnpm install` and `pnpm build`, with the Codex CLI installed and signed in and the Lean
toolchain set up (`node packages/cli/dist/bin.js setup --yes`):

```
node packages/cli/dist/bin.js --repo examples/demo
```

On macOS the browser opens by itself; on other systems open the URL it prints (it listens on 127.0.0.1 only).

The UI makes real calls to Codex (the model proposes the spec, the proofs and the faster rewrites) and runs real Lean
checks. It is not a replay and it may take minutes: a proof attempt alone has a default budget of 10 attempts or 12
minutes. For the recorded sessions, see the showcase in the top-level README.

The same functions from the command line, for example:

```
node packages/cli/dist/bin.js optimize src/clamp.ts --fn clamp --repo examples/demo
```

`src/clamp.ts` is resolved relative to `--repo`.

## What to expect for `medianMean`

`medianMean` is outside the translator subset, so it has no Lean model and no spec or proof can be made for it. Faithful
offers it the Tested path only: differential testing against the original plus a mutation check, so the best label it
can reach is Tested. On the command line that path is `optimize src/medianMean.ts --fn medianMean --repo examples/demo
--tested`.

## Where results go

Faithful writes under `examples/demo/.faithful/<function>/`: the session log while it runs and, when you deliver,
`patch.diff`, `<function>.provenance.json` and `VERIFY.md`; a function with an agreed spec also gets `spec.md`, and
`<function>.lean` when a proof exists. `.faithful/` is git-ignored. Faithful never modifies the files in `src/`; to apply a delivered
rewrite, run `git apply` on the `patch.diff` yourself, and to re-check a delivery without trusting it, run
`node packages/cli/dist/bin.js verify examples/demo/.faithful/<function>`.
