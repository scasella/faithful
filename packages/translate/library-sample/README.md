# Library sample (Phase 9)

20 exported functions drawn at random from three MIT-licensed TypeScript utility libraries, to measure how much real-world
utility code falls in the translator's verifiable subset. The draw does not depend on whether the translator accepts a function;
refusals are findings. Results: [TRANSLATION.md](TRANSLATION.md).

Date of the clones, the draw and the measurement: 2026-10-05. Node v25.8.1, TypeScript 5.9.3 (the translator's own copy),
translator `@faithful/translate` 0.1.0 built with `pnpm exec tsc -b`.

## Libraries

Each LICENSE file was read in full before use; all three are the standard MIT text. Copies are in `LICENSES/`.

| library | repo | commit (HEAD of `git clone --depth 1`, 2026-10-05) | commit date | license file | copyright line |
|---|---|---|---|---|---|
| es-toolkit | https://github.com/toss/es-toolkit | `43e1118884e07cebdf1e767038f6e7f697fa27ec` | 2026-10-01 | `LICENSE` | Copyright (c) 2024 Viva Republica, Inc. |
| radash | https://github.com/rayepps/radash | `4cab1900d08e0997abc4f17aec3cbfe18958d766` | 2025-06-17 | `LICENSE.md` | Copyright (c) 2022 radash |
| remeda | https://github.com/remeda/remeda | `8e6e78f6eaf66eaf0b4797d72cc3691823c91335` | 2026-10-04 | `LICENSE` | Copyright (c) 2018 remeda |

No optional fourth library (ts-belt) was used. Clones live in `/tmp/faithful-libs/<library>`, outside the repo.

## Selection procedure

Executable form: [`select.mjs`](select.mjs) (`node packages/translate/library-sample/select.mjs /tmp/faithful-libs --pool`).
Its full output, including every pool entry with its index, is [`draw.json`](draw.json). The script was run once; the draw below
is that first run, unchanged.

1. **Files.** Every `.ts`/`.tsx` file under the source root (`es-toolkit/src`, `radash/src`, `remeda/packages/remeda/src`),
   excluding `*.d.ts`, `*.test.ts`, `*.spec.ts`, `*.bench.ts`, `*.test-d.ts`, and directories named `test`, `tests`, `__tests__`,
   `__test__`, `bench`, `benchmark`, `benchmarks`. Internal helper directories (`_internal`, `internal`) and es-toolkit's `compat/`
   and `fp/` are source and are included.
2. **Candidates.** Parsed with the TypeScript compiler API. A candidate is a top-level statement that is either
   `export function name(...) { ... }` with a body (for an overloaded function, the implementation signature; one entry per name), or
   `export const name = (...) => ...` (an arrow function initializer; nothing is converted).
3. **Filters**, and only these (nothing about parameter types, generics or any subset feature):
   * body (the block, or the arrow's expression) spans at most 40 lines;
   * not `async`, and the statement text (signature and body, without leading comments) does not match `/\basync\b|\bawait\b/`;
   * the statement text does not match `/\bclass\b/`;
   * cheap purity screen: the statement text does not match
     `/\bconsole\b|\bfetch\b|\bprocess\b|Math\.random|\bDate\b|\bfs\b|\brequire\s*\(/`. This is textual, so it also rejects, for
     example, a type guard mentioning `Date`.
4. **Order.** The pool of each library is sorted by path (relative to the clone root) then by name (JS string `<`).
5. **Draw.** One mulberry32 stream with seed **20261005**, used for the libraries in the order es-toolkit (7), radash (7),
   remeda (6). For each library: `i = floor(rand() * poolSize)`, repeated, skipping an index already drawn for that library, until
   the quota is filled.

### Counts

| library | exported candidates | excluded: body > 40 lines | excluded: async | excluded: impure text | excluded: class | pool | raw draws | drawn indices |
|---|---|---|---|---|---|---|---|---|
| es-toolkit | 734 | 26 | 15 | 14 | 0 | 687 | 389, 182, 100, 671, 519, 210, 151 | same (no repeats) |
| radash | 92 | 1 | 6 | 4 | 0 | 81 | 17, 0, 70, 31, 16, 52, 9 | same |
| remeda | 178 | 5 | 0 | 3 | 0 | 171 | 37, 47, 32, 35, 44, 48 | same |

(A candidate can be excluded for more than one reason; the pool is the candidates with no reason.)

### Drawn functions

| library | index | path | name | form | body lines |
|---|---|---|---|---|---|
| es-toolkit | 389 | `src/fp/array/difference.ts` | `difference` | function | 15 |
| es-toolkit | 182 | `src/compat/array/unzipWith.ts` | `unzipWith` | function (overloaded) | 21 |
| es-toolkit | 100 | `src/compat/_internal/stubA.ts` | `stubA` | function | 3 |
| es-toolkit | 671 | `src/string/words.ts` | `words` | function | 3 |
| es-toolkit | 519 | `src/math/clamp.ts` | `clamp` | function (overloaded) | 7 |
| es-toolkit | 210 | `src/compat/function/overArgs.ts` | `overArgs` | function | 19 |
| es-toolkit | 151 | `src/compat/array/pullAll.ts` | `pullAll` | function (overloaded) | 7 |
| radash | 17 | `src/array.ts` | `range` | generator function | 9 |
| radash | 0 | `src/array.ts` | `alphabetical` | arrow const | 6 |
| radash | 70 | `src/string.ts` | `trim` | arrow const | 6 |
| radash | 31 | `src/async.ts` | `tryit` | arrow const | 25 |
| radash | 16 | `src/array.ts` | `objectify` | arrow const | 6 |
| radash | 52 | `src/object.ts` | `lowerize` | arrow const | 1 |
| radash | 9 | `src/array.ts` | `intersects` | arrow const | 9 |
| remeda | 37 | `packages/remeda/src/forEachObj.ts` | `forEachObj` | function (overloaded) | 3 |
| remeda | 47 | `packages/remeda/src/internal/binarySearchCutoffIndex.ts` | `binarySearchCutoffIndex` | function | 18 |
| remeda | 32 | `packages/remeda/src/firstBy.ts` | `firstBy` | function (overloaded) | 3 |
| remeda | 35 | `packages/remeda/src/floor.ts` | `floor` | function (overloaded) | 3 |
| remeda | 44 | `packages/remeda/src/hasSubObject.ts` | `hasSubObject` | function (overloaded) | 3 |
| remeda | 48 | `packages/remeda/src/internal/heap.ts` | `heapMaybeInsert` | function | 16 |

## Translation units (`<library>/<name>.ts`)

Each file is one self-contained unit, fed to `translate(source, name)` exactly as written (header included):

* Line 1: `// @sample library=<lib> path=<path> commit=<sha> license=MIT`; line 2: the copyright line and `see LICENSES/<lib>.txt`.
* The function exactly as in the source, from its leading JSDoc to its closing brace, including every overload signature in source
  order. Not fixed, simplified or reformatted.
* Imports, decided per import declaration of the function's own file:
  * dropped if none of its bindings is referenced by the unit;
  * kept verbatim if it imports a value the function uses (calls to other library functions are left as they are; the translator
    refuses them);
  * if it is used only for types, the referenced type aliases/interfaces are copied verbatim (with their JSDoc) from the library,
    transitively, when the whole closure lies inside the same library; otherwise (a type that depends on `type-fest`) the import
    line is kept verbatim.
* Type aliases from the function's own file that it needs are copied verbatim. For `hasSubObject` that includes the ambient
  `declare const BRAND_HAS_SUB_OBJECT: unique symbol;` its guard type refers to.
* Module-level values and same-file helper functions the function refers to are not copied (`words` -> `CASE_SPLIT_PATTERN`,
  `lowerize` -> `mapKeys`, `firstBy` -> `firstByImplementation`, `forEachObj` -> `forEachObjImplementation`,
  `hasSubObject` -> `hasSubObjectImplementation`, `heapMaybeInsert` -> `heapSiftDown`). These references dangle; that is a
  legitimate refusal.

Executable form: [`build-units.cjs`](build-units.cjs) (its table `P` lists, per unit, the import lines kept and the declarations
inlined; re-running it over the same clones reproduces the committed units byte for byte, checked 2026-10-05).

Deviation, found after the measurement and left in place: `remeda/hasSubObject.ts` keeps `import { isDeepEqual } from
"./isDeepEqual";`, although only the JSDoc and the not-copied `hasSubObjectImplementation` use it, so by the rule above the line
should have been dropped. It does not change that row: the unit is refused on its overloads (line 82), a check that runs before the
module-level statement scan (as in `unzipWith`, which also keeps imports and is refused on overloads).

Inlined types per unit: `overArgs` (Many), `pullAll` (Equals, MutableList, IsWritable, RejectReadonly), `lowerize`
(LowercasedKeys), `forEachObj` (ToString, EnumerableStringKeyOf; EnumerableStringKeyedValueOf stays an import because it needs
type-fest), `firstBy` (IterableContainer, NonEmptyArray, FirstBy; `OrderRule` stays in the kept `purryOrderRules` import line),
`hasSubObject` (its four local `HasSubObject*` types), `heapMaybeInsert` (CompareFunction).

## Measurement

`pnpm exec tsc -b`, then `node packages/translate/library-sample/measure.mjs` (imports `translate` and `refusalStats` from the built
`packages/translate/dist/index.js`; read-only). Raw output: [`results.json`](results.json). Table: [TRANSLATION.md](TRANSLATION.md).
Neither the translator nor the sample was changed after seeing the results.
