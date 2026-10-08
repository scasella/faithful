# Security: what Faithful isolates, what leaves the machine, and what it does not protect against

This describes the code as of 2026-10-05 (Node v25.8.1, macOS arm64, Codex CLI 0.159.2). Where this document and the code
differ, the code is what runs and this document is wrong. Probes quoted below were run on that date against the built
`packages/engine/dist` sandbox.

## Threat model

The model (Codex) is not adversarial, but it is untrusted for correctness: everything it writes (specs, proofs,
candidate rewrites) is treated as a proposal that Faithful's own checks must accept, and those checks never ask the
model whether it is right. The user's own code is trusted not to be malicious: Faithful runs it, and model-written
candidates of it, inside a worker thread that catches accidents (clock reads, randomness, I/O, mutation of shared
built-ins, runaway loops, memory blow-ups), not attacks. The person running Faithful, and anyone else who can run
processes as that user on the machine, is trusted. Nothing here is designed to contain hostile code.

## The execution sandbox is not a security boundary

`packages/engine/src/sandbox/` runs TypeScript functions (the user's original, instrumented copies of it, mutants,
model-written candidates, benchmark harnesses) in one Node `worker_threads` worker per `Sandbox`.

What it does:

* **Source preparation** (`source.ts`): the TypeScript is parsed; import declarations (except `import type`), re-exports,
  `export =` / `export default <expression>`, dynamic `import()` and `import.meta` are rejected before anything runs;
  types are erased with `ts.transpileModule` and export modifiers stripped. Probe: a function containing `import("fs")`
  failed to load with "dynamic import() is not allowed".
* **Realm hardening** (`hardenRealm` in `mask.ts`, once per worker, before any candidate code): the `constructor` of
  `Function.prototype`, and of the async, generator and async-generator function prototypes, becomes a trap; the global
  `eval` becomes a trap; `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `BroadcastChannel`, `MessageChannel`,
  `MessagePort`, `Request`, `Response`, `Headers`, `FormData`, `navigator`, `WebAssembly`, `SharedArrayBuffer` and
  `Atomics` are set to `undefined` on the real global object. This closes the escape the reference implementation
  documents, `(() => 0).constructor("return this")()`, and its async/generator/eval variants; `purity.test.ts` checks
  each one is trapped.
* **Purity mask** (`evalMasked`): candidate code is compiled with the real `Function` constructor (captured before
  hardening) as `new Function(<masked names>, '"use strict"; ...')`. Every name in `TRAPPED` (the global object under
  four names, `process`, `require`, `module`, `exports`, `__filename`, `__dirname`, `Buffer`, `console`, network and
  messaging globals, `performance`, `crypto`, timers, `queueMicrotask`, `WeakRef`, `FinalizationRegistry`, `Intl`,
  `SharedArrayBuffer`, `Atomics`, `WebAssembly`, `Function`) is shadowed by a Proxy whose every operation records an
  `ambient` violation and throws. `Date` is shadowed by a subclass that traps `Date.now()`, `new Date()` and `Date()`
  (explicit-argument dates still work); `Math` by a copy whose `random` traps. A trap records the violation even if the
  candidate catches the exception.
* **Intrinsic integrity** (`installMask`, `takeViolations`): own property descriptors of the core constructors and
  prototypes (Object, Array, String, Number, Boolean, BigInt, Symbol, Map, Set, Date, RegExp, Promise, Function, Error,
  TypeError, RangeError), `JSON`, `Reflect`, `Math`, the iterator prototypes and the masked `Date`/`Math` are snapshotted;
  after every call a change is recorded as an `intrinsic` violation and restored, and a key added to the real global
  object is recorded as `global-write` and deleted. Any `ambient`, `intrinsic` or `global-write` violation turns the
  call's outcome into `fault` ("impure: ...").
* **Arguments**: every call gets a fresh `structuredClone` of its arguments; after the call they are compared with the
  originals and a difference is reported as `input-mutation`. Results must be JSON values of the subset (integers within
  ±2^53, booleans, strings, arrays, plain records, null) or the call is a `fault`.
* **Resource limits** (`sandbox.ts` defaults): V8 old-generation heap 256 MB, young generation
  `min(64, max(8, floor(256 / 8)))` = 32 MB, worker stack 4 MB, 2,000 ms per call, 5,000 ms to evaluate a loaded
  source, 20,000 ms for a worker to start. Callers may pass other values (the benchmark uses 30,000 ms per trial).
* **Watchdog**: time is wall-clock, not CPU time. In a batch (`callBatch`, `checkPurity`), the worker publishes the
  index of the call in progress in a `SharedArrayBuffer` slot and the main thread polls it every
  `max(1, min(25, floor(perCallMs / 4)))` ms; a single `call` has one timer for its whole budget. On overrun the
  worker is terminated (`worker.terminate()`), the call's outcome is `fault` / `timeout`, a new worker is spawned and
  every previously loaded source is re-evaluated in it. A worker that dies on its own (heap limit) gives
  `fault` / `out of memory` and is replaced the same way.

Observed on 2026-10-05:

| Probe | Result |
|---|---|
| `for (;;) {}` with a 300 ms budget | `fault` / `timeout` after 325 ms wall-clock; the next call on the respawned worker returned normally |
| pushing 100,000 arrays of 10,000 elements | `fault` / `out of memory` after 142 ms; the next call returned normally |
| `new Uint8Array(1024 * 1024 * 1024)` (1 GB) | succeeded: `ArrayBuffer` backing stores are outside the V8 heap limit |
| setting `Error.prepareStackTrace` and reading `getThis()` / `getFunction()` of every call site | the hook ran during the call; every call site returned `undefined` for both (strict-mode frames); the call's outcome became `fault` with violation "modified Error.prepareStackTrace" (the post-call sweep, `verifyIntrinsics`, restores the snapshotted descriptor) |
| module-level `let` written in one call, read in the next | the value persisted between calls of the same load; only `checkPurity`'s two-calls-agree check (when it changes an outcome) and the purity gate notice this |
| `structuredClone`, `TextEncoder`, `Proxy`, `Reflect` | reachable (not trapped) |

Honest limits:

* A worker thread shares the process, the file system, the environment, and the network stack with the host. It is not
  an OS process, container or VM boundary.
* Shadowing is lexical and the integrity sweep runs after the call, so a determined program in the same V8 isolate
  can look for paths around it (the mask's own header names `Error.prepareStackTrace` tricks and prototype pollution
  between the check and the use). The probe above found no global through `prepareStackTrace` call sites; that is one
  probe, not a proof that no route exists. Anything that happens during a call, before the post-call sweep, has
  already happened when the violation is recorded.
* Memory: the 256 MB limit covers the V8 heap only; large `ArrayBuffer` / typed-array allocations are not capped by it.
* CPU: there is no CPU-time limit and no priority control. A running call uses a core until it returns or the
  wall-clock watchdog terminates the worker; the bound is the per-call or per-batch budget plus one polling tick.
* Run untrusted code in a separate OS process or container if that matters to you. Faithful does not.

## Extracted units (what the Tested tier runs as the original)

A function the translator refuses can still be optimized on the Tested tier, where the original function itself is the
reference. The original that runs in the sandbox is not the whole file but an EXTRACTED UNIT: the function plus only
the module-level declarations it needs (`extractUnit`, `packages/engine/src/sandbox/extract.ts`). Before extraction the
whole file ran, so an unrelated import, or top-level code that touched `console` or `Date.now`, blocked every function
in the file. The unit is exactly what `prepareSource` / `Sandbox.load` receive for the Tested preflight
(`testedPreflight`, `packages/cli/src/flow/testedOriginal.ts`), the run (`TestedOptimizer`: calibration, compile gate,
screening, differential, mutation check, benchmark), and `faithful verify`. Extraction only ever REMOVES top-level
statements of the user's file (and adds `export` to the target when it is missing), so it never widens what the sandbox
allows: the unit still goes through `prepareSource` and the purity mask (`extract.test.ts` checks every successful case
has no import, re-export, `export =` or dynamic import left).

Rules:

1. **Target.** A top-level `function` declaration with a body, with its JSDoc. `const f = () => ...` is refused with a
   reason: every other part of the Tested path (`inferSignature`, the compile gate, the mutation check, the patch
   splice) finds function declarations only. An OVERLOADED function is refused, for the unit and the whole file alike
   (`sameForWholeFile`: no fallback, rule 7): the patch splice and the signature-based input generator are built for one
   declaration, so an overload group would be delivered with only its first signature replaced and sampled from its
   first signature only.
2. **Closure.** Every identifier in an included declaration (bodies, initializers, class members, enum initializers,
   type annotations) is resolved by the TypeScript checker over this one in-memory file (no lib, no module resolution).
   A reference to a module-level binding includes the WHOLE statement that declares it (a multi-declarator or
   destructuring `const` is kept whole), transitively, in the original order. Parameters, locals, properties and
   anything that shadows a module-level name resolve to their own symbols and pull nothing in. The checker is used rather
   than a hand-written scope walk because hoisting, block, catch and loop scopes, destructuring, shorthand properties
   (`{ live }`) and `typeof X` in types all come from the binder.
3. **Refused, with a position.** The closure references an imported binding, as a value or only as a type (a dropped
   import would leave the name unresolved for the compile gate and the input generator); a namespace; an `import x =
   N.y` alias; a value only `declare`d in the file; an included declaration uses dynamic `import()`, `import.meta`, an
   `import(...)` type, or top-level `await`; a declaration the function uses reads a trapped ambient global (`console`,
   `process`, `window`, `globalThis`, timers, ...) in code that runs when the file loads; an included declaration calls
   `eval(...)` directly (a direct eval sees every name of the file, including the ones the unit leaves out, so
   `eval('n + cfg.k')` would behave differently; an aliased or indirect eval sees only the global scope); a name the
   function uses that another statement of the file declares with a NESTED `var` (`var x = 1; if (c) { var x = 100 }`,
   `for (var x of xs)`, `try { var x = 1 } catch {}`, or `if (c) { var x = 1 }` alone): such a `var` is a module-level
   variable whose declaration sits inside a statement the unit drops, so dropping it would change the value the
   function reads (or remove the variable). The same for the target's own name. A function that merely has a local
   `var` of the same name is not affected.
4. **Dropped.** Everything else at the top level: imports (type-only or not), re-exports, `export default <expr>`, other
   functions and classes, and top-level statements, including ones that would throw or touch ambient globals.
5. **Soundness guard.** Dropping a statement must not change what the function sees. Every dropped top-level statement
   other than a function declaration is LOAD-TIME CODE as a whole, including the bodies of function expressions and
   arrows in it (an IIFE, a callback handed to a call, an object-literal getter), computed keys, decorators and
   `extends` clauses. The only parts not treated as load-time code are ones that cannot run unless their binding is
   referenced from load-time code: the body of a function or arrow that is directly the initializer of a top-level
   `const` / `let` / `var`, and the method, accessor and constructor bodies and instance field initializers of a
   top-level class that runs nothing itself at load (no decorators, no static blocks, no static field initializers).
   A dropped declaration referenced from load-time code is checked in full, except when the reference only STORES it
   in the default export (`export default helper`, `export default { a, b: helper }`, `export default [helper]`, any
   nesting of object and array literals made of plain properties and elements): that evaluation creates an object and
   keeps a reference, it runs nothing of the function or class, and the object is bound to no name of this file, so no
   code of this file can call it while the file loads (another module can, after this one has finished loading: the
   honest limit below). `const api = { helper }; api.helper()`, `export default [helper].map((g) => g())` and
   `export default { v: helper() }` still reach it. (An INCLUDED function stored in the default export is refused when
   the closure holds mutable state and allowed when it does not, see the third bullet.) In that code:
   - a reference to an included binding is refused ("module-level code outside the function (line N) changes
     `counter`, which the function reads") when it assigns, increments or deletes the binding or a property of it,
     calls it or a method on it (`registry.set(...)`), or passes it on: as an argument, into an object, array or another
     variable, as a substitution of a TAGGED template (the tag receives it), or as the left side of `instanceof`
     (`Symbol.hasInstance` receives it);
   - a READ is allowed only of a binding whose reads cannot run code of the file: a `const` bound to a primitive literal
     (exempt from every rule), or PLAIN DATA (literals, arrays and object literals of plain data with plain keys and no
     methods, getters or spreads, `new Map()` / `new Set()` / typed arrays, an enum). Any other read, for example
     arithmetic on an object with its own `valueOf`, or a property of a class instance, is refused, because a getter or
     `valueOf` may run and change state;
   - running or passing on an included FUNCTION is allowed when the closure holds no mutable state: no `let` / `var`,
     no `const` bound to anything other than a primitive literal or a function, no class, and no included function used
     as anything other than a PLAIN callee, `h(x)` or a tagged template (`h.k`, `h['k']`, `(h as any).k`, `const a = h`,
     `xs.map(h)`, `new h()` and `h.call(...)` / `.apply` / `.bind` all count: an object can carry state attached by
     `Object.assign` or `Object.defineProperty`, `new h()` reads `h.prototype`, and `h.call` looks `call` up on `h`).
     Even then the function's own BODY is scanned like load-time code, because the whole file runs that call and the
     unit does not: `function patch() { Array.prototype.includes = ... } patch();` and `function M() { return Math }
     M().max = ...` are refused;
   - changing a BUILT-IN that every module shares is refused: assigning to, deleting or incrementing anything on a name
     the file does not declare (`Array.prototype.includes = ...`, `globalThis.x = ...`, `Math.max = ...`), calling a
     method on a prototype (`Array.prototype.push(1)`, `Object.prototype.__defineGetter__(...)`; `Object.prototype.
     hasOwnProperty.call(o, k)` and `.apply` / `.bind` only look the method up and are allowed), passing on a shared
     built-in itself (`Object.assign(Math, ...)`, `const A = Array`, a shorthand `{ Math }`) or any `prototype` /
     `__proto__` / `constructor` chain (`const AP = Array.prototype`), and changing, calling a method on or passing on a
     prototype reached without a name (`Object.getPrototypeOf([]).includes = ...`, `[].constructor.prototype`,
     `[].__proto__.push(7)`) or through a binding of the file (`o.__proto__.k = ...`, `a.constructor.prototype.x = ...`;
     `Foo.prototype.m = ...` on a function or class the file declares changes only that declaration and is allowed, for a
     declaration the function does not include; an included function used with `new` or `.call` counts as used as an
     object, above). `arguments` is the call's own object but its `__proto__` is the shared `Object.prototype`, so it is
     checked like a binding of the file: `arguments[0] = 1` is allowed, `arguments.__proto__.k = 1` is not. Before
     extraction such a file was refused at load ("impure at load"); now it is refused here. Four more ways to reach a shared built-in or code from a
     string without naming `eval`, `Function` or `X.prototype` are refused too: the GLOBAL OBJECT (`globalThis.x = ...`,
     `Object.defineProperty(globalThis, ...)`: the checker supplies a symbol for `globalThis` even with no library, which
     used to make it look like a binding of the file); a MEMBER that can be the Function constructor (`Array.constructor(...)`,
     `[].constructor.constructor(...)`, `globalThis.eval(...)`, `x['Function'](...)`), allowed only to compare it, take
     its `typeof` or read its `.name`; and `Object.getPrototypeOf(x)` / `Reflect.getPrototypeOf(x)`, whose result is a shared
     prototype when `x` is a built-in value, allowed only when the call's value is READ (compared, tested), never bound,
     passed on, called through or assigned to, and never used as a value itself (`const gp = Object.getPrototypeOf` is an
     alias, next paragraph); and a DESTRUCTURING pattern that picks `constructor`, `__proto__`, `prototype`, `eval` or
     `Function` by name (`const { constructor: C } = []`, `const { constructor: { prototype: AP } } = []`,
     `({ eval: ev } = globalThis)`), which makes an ordinary-looking local out of the member. A key built at run time
     (`Array[k]` read into a binding or passed on) counts like a prototype name.
   - A top-level `const X = eval;`, `const X = Function;` or `const X = Object.getPrototypeOf;` (or `Reflect.`) is an ALIAS of
     a global, and a dropped alias is not load-time code of its own: evaluating it only reads a global (no call, no change). It
     can matter only through code that runs while the file loads and uses the name, which is always a syntactic reference to
     a lexical binding, so rule 5 checks every such reference: ANY reference to an alias of `eval` / `Function` is refused
     (`const e = eval; e('cfg.k = 100')`: the string has no syntactic link to `cfg`), and a reference to an alias of
     `getPrototypeOf` must be the callee of a call whose result is only read. References from code that does not run
     at load are not examined, and a reference from the function's own closure makes the alias part of the unit (then
     rule 3 refuses `Function`, which the sandbox traps). Before this, `const RealFunction = Function;` anywhere in a file
     refused every function of that file (`packages/engine/src/sandbox/mask.ts`).
6. **Disclosure.** When a part that rule 5 does not treat as load-time code (the body of a dropped function
   declaration, a top-level `const f = () => ...`, or a method of an inert top-level class) can change included mutable
   state (the same uses as rule 5), extraction succeeds with a caveat: "other code in this file (lines 2, 4) can change
   live when it is called; nothing in the file calls it while the file loads and the comparison never called it, so the
   comparison saw only the starting value of live". The whole-file path saw the same starting value; the caveat is
   recorded in `tested.started`, the provenance and VERIFY.md.
7. **Fallback.** When extraction refuses but the whole file passes the same preflight, the whole file runs, as it did
   before extraction (`tested.started.original` = `'file'`). A function that was runnable then is not lost to a
   conservative extraction rule. Not for a refusal that holds for the whole file too (an overloaded target). The
   whole-file attempt is first checked with `prepareSource` (value imports, re-exports, ...), before the compile gate:
   the verdict and the reason are the same (`Sandbox.load` refuses the same source with the same problem, and the
   reason reported is the extraction's), and the compile gate on a large file costs seconds.

The preflight on the unit (the same checks, in this order, as the run makes before it measures anything): inputs from
the TypeScript signature; the compile gate on the original alone (strict, lib ES2022, no `@types`; an error on the
original's side would reject every candidate, so it is refused up front with the line of the user's file); the real
`Sandbox.load` in the `'js'` value domain; and the original on the first 50 inputs generated from the signature (seed
7001, the first candidate's seed): if it faults or exceeds 100 ms on every one, there is nothing to compare, and the
function is refused. Independently, a candidate whose differential compared zero inputs is rejected (never "no
difference on 0 inputs").

What is recorded: `tested.started` carries `original` (`'extracted'` or `'file'`) and `included` (the declaration names);
the provenance carries `testedOnly.original` (`scope`, the included declarations with kind and line, and the unit's
SHA-256); `faithful verify` re-extracts the unit from the recorded file, checks the hash, and re-runs the differential
on the unit. VERIFY.md and the UI say which declarations ran with the function.

Candidates: only the function is delivered (spliced into the user's file), so a candidate with any other top-level
statement (a copied constant, a helper, an import) is rejected at the compile stage ("it declares K outside the
function; only the function is delivered into your file ..."). A type or interface is allowed only when the original
declares one of the same name. Otherwise the candidate would be tested together with code that is not shipped.

Reproductions: `packages/engine/src/sandbox/extract.test.ts` ("soundness guard (review reproductions)") runs each shape
above (IIFEs, callbacks, getters, computed keys, decorators, static blocks, tagged templates, `instanceof`, `valueOf`,
properties attached to functions, built-in prototypes, overloads) and requires a refusal, and checks that the shapes
still allowed (plain-data reads, an uncalled arrow or class method that changes state, unrelated `console` use) behave
exactly like the whole file in the sandbox. The "relaxations and closed holes" tests evaluate the real file and the
unit the guard would have produced (a fresh `vm` context per evaluation, with its own intrinsics) and require that they
DIFFER on at least one input, so every refusal listed there is a refusal that was needed: `arguments.__proto__`, a
`var` nested in a block that re-declares or hoists a variable the function reads, a polyfill installer that only
load-time code calls, `new` and `.call` on an included function with a property or prototype attached, a shorthand
`{ Math }` / `{ eval }`, a method called on `Array.prototype` or `Object.prototype`, and destructuring that picks
`constructor`, `__proto__`, `prototype`, `eval` or `Function` by name.

Honest limits: the comparison is with the function as it behaves when its file is evaluated by itself. Code in OTHER
modules (including a module this file imports that imports it back and changes its exported objects) is not seen,
exactly as the whole-file path never saw it. Included code itself (the function's own closure) is not analysed
statically for changes to built-ins it makes when the FUNCTION calls it, and need not be: the unit and the whole file run
that code identically, and the sandbox's purity mask catches the change when it runs. (When the call exists only in
load-time code the unit leaves out, `patch();` at the top level, the two evaluations differ: rule 5 scans the body of
any included function that load-time code runs or passes on, so that shape is refused.) Every call that changes a built-in or the
global object faults ("impure: modified Array.prototype.includes", "impure: globalThis"), the built-in is restored, and
the differential excludes and counts those inputs as original faults; a function that does it on every input is refused
by the preflight with that reason (`extract.test.ts` pins four shapes, one of them a change made by an included helper).
The guard is a syntactic over-approximation: it refuses some files whose dropped code
is harmless (the whole-file fallback then applies). It does not follow code built from strings: dropped load-time code
that names `eval` or `Function` (or reaches them through `.constructor`, `.eval`, `.Function`) is refused outright. It
follows names, not values. A key built at run time that is called straight away is not caught (`Array[k]('...')()` with
`k = 'constructor'`; the same key read into a binding, passed on or assigned through IS refused; likewise `arguments[k]`
and a destructuring key `{ [k]: v }`). A `declare function polyfill(): void; polyfill();` at the top level is not examined
(the declared value comes from outside the file; the whole file would throw unless the host provides it). The guard is for
mistakes in ordinary code, not for code written to defeat it, and the sandbox says the same of its own mask.

## What leaves the machine

Only prompts to Codex. Faithful itself makes no other network request at run time. Faithful hands the `codex`
process the prompt (on stdin) and the answer schema (a file); whatever that process transmits itself (Codex's own
instructions and context, the output of any read-only command its agent chooses to run) is Codex's behaviour, not
something Faithful controls or records. (`faithful setup`, run once and only
with `--yes`, downloads the Lean toolchain and the Mathlib build cache; see "Supply chain".)

Every Codex call is recorded with its exact prompt (`CallRecord.prompt` in the session, `CodexCall.prompt` in the
prover) and shown verbatim in the UI under "What the model saw" for every proposal and attempt. The session files under
`.faithful/<fn>/` keep them.

### How Codex is run

`CodexClient` (`packages/prover/src/codex.ts`) runs one `codex exec -` subprocess per request, serialized (at most one at
a time), with the prompt on stdin and this argument list (`buildCodexArgs`):

```
exec - --model <model> --sandbox read-only --skip-git-repo-check --ephemeral --ignore-user-config
     -C <tmp>/faithful-codex-XXXX/empty --output-schema <tmp>/faithful-codex-XXXX/schema.json
     -o <tmp>/faithful-codex-XXXX/out.json --json -c model_reasoning_effort=<effort>
```

* The working directory is a freshly created, empty directory under the OS temp directory; the JSON schema for the
  answer and the answer file sit next to it. The whole temp directory is removed after the call.
* `--sandbox read-only` is Codex's policy for the shell commands its agent may run (no writes). It is enforced by Codex,
  not by Faithful. Nothing in Faithful prevents a read-only Codex agent from reading files elsewhere on the disk that the
  user can read; Faithful only never gives it the repository, never points it at the repository, and never asks it to
  read anything.
* `--ignore-user-config` skips `$CODEX_HOME/config.toml` (so user-level settings such as a different sandbox mode do not
  apply); authentication still uses `CODEX_HOME`. `--ephemeral` runs without persisting Codex session files to disk.
* The subprocess runs with the user's full environment, with tool directories appended to `PATH` (`envWithToolDirs`), and is killed with its
  process group on timeout or cancellation.
* Codex never runs `lake` or `lean`; Faithful compiles and checks everything the model writes.

### What each prompt contains

| Purpose | Contains | Built by |
|---|---|---|
| `spec-proposal` | the function name; its JSDoc (taken from the user's file); the function's own source text (the exported declaration only, not the rest of the file); the full Lean model from the translator (which inlines any module-level constants the function reads); the precondition words; the required `def spec` signature; instructions | `buildSpecPrompt`, `packages/prover/src/spec.ts` |
| `spec-revision` | everything in `spec-proposal`, plus the previous spec text, and for each input the user ruled "the spec is wrong": the input, the spec's outcome, the function's outcome, and the user's note if any | `buildSpecRevisionPrompt` |
| `proof-attempt` | the theorem file with `sorry` replaced by a placeholder: imports, the translator's model, the agreed spec, the theorem statement; the source of `lean/Faithful/Core.lean` (the runtime library); for a candidate, a reference proof (the accepted proof that the original meets the spec, with its statement); the last three failed attempts with their text, the rejection reasons or failure kind, and up to six Lean error messages with goal states | `buildProofPrompt`, `packages/prover/src/prove.ts` |
| `candidate` | the original function's source text; the agreed spec in English and Lean; the precondition and carve-out words; the incumbent's source and a timing string (median ms per pass with its 95% CI); the distribution name (which lists parameter names); the round number; for the previous candidate, its source and its rejection: stage, reason, at most one counterexample input with both outcomes, and a Lean goal if the proof failed | `buildCandidatePrompt`, `packages/cli/src/flow/candidate.ts` |

What Codex never sees from Faithful: the rest of the user's file beyond the function, its JSDoc and the constants the
model inlines; other files of the repository; the differential test inputs (apart from the single counterexample of a
rejected candidate and the inputs the user ruled on); the generated mutants; benchmark inputs; the session files; the
local server's token. The JSON schema of the expected answer is passed as a file via `--output-schema`.

## The local server

`faithful` serves the UI from `packages/cli/src/server.ts`:

* It listens on `127.0.0.1` only (never `0.0.0.0`), on the given port or an ephemeral one.
* `guard` (`packages/cli/src/hostGuard.ts`) runs on every request:
  * `Host` must be exactly `127.0.0.1:<port>`, `localhost:<port>` or `[::1]:<port>`, else 403. This defeats DNS
    rebinding: a page on an attacker's domain that resolves to 127.0.0.1 still sends its own host name.
  * If `Origin` is present it must be `http://` plus one of those hosts, else 403. If `Sec-Fetch-Site` is present it
    must be `same-origin` or `none`. This stops a web page you visit from driving the API (CSRF).
  * Every `/api/` route, including the GET routes and the event stream, needs the per-process token in the
    `x-faithful-token` header (24 random bytes from `crypto.randomBytes`, hex; compared with `timingSafeEqual`), else
    401. The UI reads the token from a `<meta>` tag the server substitutes into `index.html`, and reads the event stream
    with `fetch` because `EventSource` cannot send the header.
* Every response sent through `send` carries `Content-Security-Policy: default-src 'self'; style-src 'self'
  'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'`, plus `X-Content-Type-Options:
  nosniff`, `Referrer-Policy: no-referrer`, `Cross-Origin-Resource-Policy: same-origin` and `Cache-Control: no-store`.
  The event stream response sets its own headers (no CSP).
* No CORS: the server never sends `Access-Control-Allow-*` headers, so browsers do not let other origins read its
  responses.
* Static files are served only from the built UI directory (paths resolving outside it get 403); request bodies are
  limited to 4 MB.

## File writes

* The only files Faithful writes in the user's repository are under `<repo>/.faithful/<fn>/` (`FaithfulStore`,
  `packages/core/src/store.ts`): `events.jsonl` and `session.json` during a session, and at delivery `patch.diff`,
  `spec.md`, `<fn>.lean`, `<fn>.provenance.json`, `VERIFY.md`. `<fn>` must match `^[A-Za-z_$][\w$]*$`, so it cannot
  name a path outside that directory. Writes go to a temporary file that is then renamed.
* The user's source files are never modified. The optimized function is delivered as `patch.diff` for the user to apply
  with `git apply`.
* Temporary directories: `faithful-lean-*` (each Lean check) and `faithful-codex-*` (each Codex call) under the OS temp
  directory, removed in a `finally` block after use.
* `faithful setup --yes` runs `lake exe cache get` and `lake build` in the Lean project directory (`lean/`, or
  `FAITHFUL_LEAN_DIR`), and with `--install-elan` runs elan's official installer
  (`curl -sSfL https://elan.lean-lang.org/elan-init.sh | sh -s -- -y --default-toolchain none`), which installs under
  `~/.elan`. Without `--yes` it prints the cost and downloads nothing.

## Proof-text vetting, and why

The model supplies only two strings per proof attempt: `helpers` (placed before the theorem) and `proof` (the text after
`:=`). The model, the spec and the theorem statement are Faithful's. A proof is accepted only after all of
(`checkProof`, `packages/prover/src/proofFile.ts`):

1. **Text vetting** (`vetProofText`, on comment-stripped text). Refused: `sorry`, `admit` (not proofs); `axiom`
   (would add trust); `opaque`, `unsafe`, `implemented_by`, `extern`, `csimp` (would change what code means or how it
   runs); `macro`, `macro_rules`, `syntax`, `elab`, `elab_rules`, `notation`, `infix`/`infixl`/`infixr`, `prefix`,
   `postfix`, `declare_syntax_cat`, `initialize`, `builtin_initialize` (syntax extensions could change how the
   statement is read); `open`, `export`, `namespace`, `section`, `end`, `variable`, `universe`, `import`, `mutual` at
   the start of a line (could change name resolution); any `#` command such as `#eval` (would run code or print during
   checking); `set_option` other than `maxHeartbeats`, `maxRecDepth`, `linter.*`; redefining `Faithful.*` names;
   instance declarations and instance attributes (could change how the statement elaborates). The spec text is vetted
   with the same list except the line-start `open` / `namespace` / ... rule as a whole (a spec needs
   `namespace Spec ... end Spec`), plus its own refusals of `partial`, `import`, a missing `namespace Spec` / `def spec`,
   and any call of the model's own function (`vetSpecText`, `packages/prover/src/spec.ts`).
2. **Statement fingerprint.** `#check @<thm>` must print exactly what it prints for the same statement proved by
   `sorry` in the file without the model's helpers. This is the check that the theorem Lean accepted is the theorem
   Faithful wrote, whatever the text vetting missed.
3. **Axiom check.** `#print axioms <thm>` must list only `propext`, `Classical.choice`, `Quot.sound` (or nothing);
   `native_decide` axioms and `Lean.ofReduceBool` / `Lean.trustCompiler` downgrade the label to "trusting the
   compiler"; `sorryAx` or any other axiom means not a proof. docs/TIERS.md states the policy.

The vetting is a regular-expression list and could refuse harmless text or miss a construct it does not name; the
fingerprint and the axiom check do not depend on it.

## Supply chain

* Lean: `lean/lean-toolchain` is `leanprover/lean4:v4.34.0`.
* Mathlib: `lean/lakefile.toml` requires `rev = "5ed2965256430c3649e86755f9576b54eca72435"`; `lean/lake-manifest.json`
  records the same rev. Mathlib's own dependencies (plausible, LeanSearchClient, importGraph, proofwidgets, aesop, Qq,
  batteries, Cli) are recorded in the manifest with exact revs, resolved when the manifest was made from the `inputRev` recorded for each (`main` or `master`, and for Cli the
  Mathlib commit).
* Z3: `z3-solver` (WASM) is declared as the range `^5.2.0` in `package.json` and `packages/smt/package.json`; the
  lockfile (`pnpm-lock.yaml`) resolves it to 5.2.0. A system `z3` binary is used as a fallback when found; its version is
  whatever is installed. Which one ran is recorded in each artifact.
* Codex CLI: not pinned; its version is captured in the toolchain snapshot (`Stamp`) of every run.
* Node packages are pinned by `pnpm-lock.yaml`.

## Known gaps

* The sandbox is a worker thread, not a security boundary (above). `ArrayBuffer` memory is not capped; time is
  wall-clock only.
* Module-level mutable state persists between calls of one loaded source; a single call does not reveal it.
* Tested tier: the original runs as an extracted unit evaluated by itself (above); state that other code in the file or
  other modules would set at run time is seen only at its starting value (disclosed as a caveat when the file itself
  contains such code).
* Codex's read-only sandbox does not stop its agent from reading files outside its empty working directory; Faithful
  relies on Codex's own sandbox for that, and on never giving it the repository.
* The server's token protects against browsers, not against local processes: `GET /` needs no token and returns
  `index.html` with the token in it, so any process (or other user) on the machine that can connect to 127.0.0.1 can
  read the token and use every API route.
* `POST /api/lean/check` compiles arbitrary Lean source supplied by the token holder; Lean `#eval` can perform I/O.
* `POST /api/session/open` reads only files whose real path is inside the repository (`SessionRuntime.openFunction`
  refuses `..` paths, absolute paths elsewhere and symlinks that point outside; covered by
  `packages/cli/src/flow/openConfinement.test.ts`). Whatever it does read enters the session files and, through the
  spec, proof and candidate prompts, the parts listed above reach Codex.
* The proof-text vetting is a regular-expression list (above); the fingerprint and axiom checks are what make an
  accepted proof trustworthy.
* The z3-solver dependency is a semver range constrained by the lockfile, not an exact version in `package.json`.
