# Library sample: translation results

Measured 2026-10-05, Node v25.8.1, TypeScript 5.9.3, `@faithful/translate` 0.1.0 (built with `pnpm exec tsc -b`), by
`measure.mjs` calling `translate(source, name)` on each unit in this directory. Sample and procedure: [README.md](README.md).
Raw output: [results.json](results.json). No model is involved; the translator is deterministic.

**In the subset: 0 of 20. Refused: 20 of 20. Translator crashes: 0.**

The translator reports the first refusal it meets, so each row names one reason; a function can have further ones behind it.
"Line" is the 1-based line in the unit file (two header lines included).

| # | name | library | result | code | reason (translator's words) | line |
|---|---|---|---|---|---|---|
| 1 | `difference` | es-toolkit | refused | unsupported-syntax | this top-level statement runs code when the module loads (...); subset v1 allows only function, type and constant declarations with literal or function initializers at module level. At: `import { difference as differenceToolkit } from '../../array/difference.ts';` | 4 |
| 2 | `unzipWith` | es-toolkit | refused | unsupported-syntax | overloaded functions are outside subset v1 | 22 |
| 3 | `stubA` | es-toolkit | refused | missing-annotation | the return type needs an annotation | 4 |
| 4 | `words` | es-toolkit | refused | unsupported-syntax | the function does not type-check: TS2304 Cannot find name 'CASE_SPLIT_PATTERN'. | 22 |
| 5 | `clamp` | es-toolkit | refused | unsupported-syntax | overloaded functions are outside subset v1 | 17 |
| 6 | `overArgs` | es-toolkit | refused | unsupported-syntax | top-level statement runs code when the module loads (same message as #1). At: `import { identity } from '../../function/identity.ts';` | 4 |
| 7 | `pullAll` | es-toolkit | refused | unsupported-syntax | overloaded functions are outside subset v1 | 34 |
| 8 | `range` | radash | refused | unsupported-syntax | top-level statement runs code when the module loads (same message as #1). At: `import { isArray, isFunction } from './typed'` | 4 |
| 9 | `alphabetical` | radash | refused | generic | generic functions are outside subset v1 | 9 |
| 10 | `trim` | radash | refused | unsupported-type | parameter `str` can be null/undefined; null and undefined are supported only as a function's return type (T \| null) | 18 |
| 11 | `tryit` | radash | refused | unsupported-syntax | top-level statement runs code when the module loads (same message as #1). At: `import { isArray, isPromise } from './typed'` | 4 |
| 12 | `objectify` | radash | refused | generic | generic functions are outside subset v1 | 8 |
| 13 | `lowerize` | radash | refused | generic | generic functions are outside subset v1 | 11 |
| 14 | `intersects` | radash | refused | generic | generic functions are outside subset v1 | 8 |
| 15 | `forEachObj` | remeda | refused | unsupported-syntax | overloaded functions are outside subset v1 | 53 |
| 16 | `binarySearchCutoffIndex` | remeda | refused | generic | generic functions are outside subset v1 | 18 |
| 17 | `firstBy` | remeda | refused | unsupported-syntax | overloaded functions are outside subset v1 | 54 |
| 18 | `floor` | remeda | refused | unsupported-syntax | overloaded functions are outside subset v1 | 24 |
| 19 | `hasSubObject` | remeda | refused | unsupported-syntax | overloaded functions are outside subset v1 | 82 |
| 20 | `heapMaybeInsert` | remeda | refused | unsupported-syntax | top-level statement runs code when the module loads (same message as #1). At: `import { hasAtLeast } from "../hasAtLeast";` | 4 |

## Refusal histogram

By refusal code (`refusalStats`):

| code | count |
|---|---|
| unsupported-syntax | 13 |
| generic | 5 |
| unsupported-type | 1 |
| missing-annotation | 1 |

By underlying cause (all 20; the 13 `unsupported-syntax` rows split by message):

| cause | count | functions |
|---|---|---|
| overloaded function | 7 | unzipWith, clamp, pullAll, forEachObj, firstBy, floor, hasSubObject |
| import of another library module | 5 | difference, overArgs, range, tryit, heapMaybeInsert |
| generic type parameters | 5 | alphabetical, objectify, lowerize, intersects, binarySearchCutoffIndex |
| reference to a module-level value not in the unit (type error) | 1 | words |
| nullable parameter | 1 | trim |
| missing return-type annotation | 1 | stubA |

## Observations

* Every sampled function is refused. With a sample of 20, 0 of 20 bounds the in-subset share of this pool loosely (the exact
  binomial 95% CI upper bound for 0/20 is about 0.17); it does not show the share is zero.
* Generics and overloads, together 12 of 20, are the dominant reasons. Both are ordinary in utility libraries: remeda's public
  API is uniformly an overloaded data-first/data-last wrapper whose body only forwards to `purry` (or `purryOrderRules`) and an
  unexported `*Implementation` helper, so the exported name never carries the logic itself.
* Imports are refused with the message for module-level side effects ("runs code when the module loads"). The refusal is right
  (subset v1 is single-file), but the wording describes an import as running code; a message naming imports would be clearer.
  Recorded here as a finding; the translator was not changed.
* `words` reached the type checker and was refused by it, because `CASE_SPLIT_PATTERN` (a module-level regex) is not in the unit
  (by the unit rules, module-level values are not copied).
