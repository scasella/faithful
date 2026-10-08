/**
 * Refusal plumbing, spans, TypeScript-type -> subset-type mapping, and Lean name hygiene.
 */
import ts from 'typescript';
import type { RefusalCode, Span, Ty } from './contracts.js';
import { recordKey, type RecordDecl } from './ir.js';

/** Thrown inside the translator; caught at the API boundary and turned into a `TranslationRefused`. */
export class RefuseError extends Error {
  constructor(
    readonly code: RefusalCode,
    readonly reason: string,
    readonly at: ts.Node | { start: number; end: number },
  ) {
    super(`${code}: ${reason}`);
  }
}

export function refuse(code: RefusalCode, reason: string, at: ts.Node | { start: number; end: number }): never {
  throw new RefuseError(code, reason, at);
}

/** Exact span of a node: from its first token (leading trivia excluded) to its end. Line and column are 1-based. */
export function spanOf(at: ts.Node | { start: number; end: number }, sf: ts.SourceFile): Span {
  const start = 'kind' in at ? at.getStart(sf) : at.start;
  const end = 'kind' in at ? at.getEnd() : at.end;
  const lc = sf.getLineAndCharacterOfPosition(start);
  return { start, end, line: lc.line + 1, column: lc.character + 1 };
}

// ---------------------------------------------------------------------------------------------------------------
// TypeScript comment directives
// ---------------------------------------------------------------------------------------------------------------

/** `@ts-ignore` / `@ts-expect-error` (suppress the diagnostics of the next line) anywhere in a comment. */
export const TS_LINE_DIRECTIVE = /@ts-(ignore|expect-error)/;
/** `@ts-nocheck` (suppresses every semantic diagnostic of the file) anywhere in a comment. */
export const TS_FILE_DIRECTIVE = /@ts-nocheck/;

/**
 * Every comment in the trivia that starts at `pos` (a token's full start). TypeScript splits it into "trailing"
 * comments (on the line of the previous token) and "leading" ones (after the first line break); both are needed, or
 * `return x; // @ts-ignore` would be missed.
 */
function triviaComments(text: string, pos: number): ts.CommentRange[] {
  const out = [...(ts.getTrailingCommentRanges(text, pos) ?? [])];
  for (const c of ts.getLeadingCommentRanges(text, pos) ?? []) if (!out.some((o) => o.pos === c.pos)) out.push(c);
  return out;
}

/**
 * The first comment in `node` (including its leading trivia, i.e. from `node.pos`) whose text matches `re`, or null.
 * Every comment lies in the trivia before some token, so the comments are enumerated by walking the token leaves
 * (JSDoc nodes are skipped as nodes: their text is reached as a comment of the token they precede). Comments inside
 * string, template or regex literals are text of a token, never matched. Deliberately broader than TypeScript's own
 * directive recognition (which requires the directive at the start of the comment): broader means more refusals,
 * never a missed directive.
 */
export function findCommentMatching(sf: ts.SourceFile, node: ts.Node, re: RegExp): { start: number; end: number } | null {
  // the whole-file search is asked once per translated function and costs the whole file: remember it per tree
  if (node === sf) {
    let byRe = wholeFileComments.get(sf);
    if (!byRe) wholeFileComments.set(sf, (byRe = new Map()));
    const key = `${re.source}/${re.flags}`;
    if (!byRe.has(key)) byRe.set(key, searchComments(sf, node, re));
    return byRe.get(key) ?? null;
  }
  return searchComments(sf, node, re);
}
const wholeFileComments = new WeakMap<ts.SourceFile, Map<string, { start: number; end: number } | null>>();

function searchComments(sf: ts.SourceFile, node: ts.Node, re: RegExp): { start: number; end: number } | null {
  const text = sf.text;
  let found: { start: number; end: number } | null = null;
  const visit = (n: ts.Node): void => {
    if (found || (n.kind >= ts.SyntaxKind.FirstJSDocNode && n.kind <= ts.SyntaxKind.LastJSDocNode)) return;
    const kids = n.getChildren(sf);
    if (kids.length === 0) {
      for (const c of triviaComments(text, n.pos)) {
        if (re.test(text.slice(c.pos, c.end))) {
          found = { start: c.pos, end: c.end };
          return;
        }
      }
      return;
    }
    for (const k of kids) visit(k);
  };
  visit(node);
  return found;
}

/**
 * A `@ts-ignore` / `@ts-expect-error` comment that can hide a diagnostic of `node`: one inside `node` (leading comments
 * included), or one anywhere in the file whose next line (TypeScript's rule: the directive applies to the line after
 * the comment ends) lies within the lines of `node`. The second case catches a directive at the end of a line that a
 * previous statement shares with `node`'s first token (`g() { ... // @ts-ignore` then `} export function f ...`).
 */
export function findLineDirectiveFor(sf: ts.SourceFile, node: ts.Node): { start: number; end: number } | null {
  const inside = findCommentMatching(sf, node, TS_LINE_DIRECTIVE);
  if (inside) return inside;
  const first = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line;
  const last = sf.getLineAndCharacterOfPosition(node.getEnd()).line;
  for (const d of lineDirectives(sf)) if (d.next >= first && d.next <= last) return { start: d.start, end: d.end };
  return null;
}

/**
 * Every `@ts-ignore` / `@ts-expect-error` comment of the file in token order, with the line it applies to, computed once
 * per tree (a file with N functions is asked N times; walking every token each time made the whole translation of a
 * file quadratic).
 */
const lineDirectiveCache = new WeakMap<ts.SourceFile, Array<{ start: number; end: number; next: number }>>();
function lineDirectives(sf: ts.SourceFile): Array<{ start: number; end: number; next: number }> {
  const hit = lineDirectiveCache.get(sf);
  if (hit) return hit;
  const out: Array<{ start: number; end: number; next: number }> = [];
  const text = sf.text;
  const visit = (n: ts.Node): void => {
    if (n.kind >= ts.SyntaxKind.FirstJSDocNode && n.kind <= ts.SyntaxKind.LastJSDocNode) return;
    const kids = n.getChildren(sf);
    if (kids.length === 0) {
      for (const c of triviaComments(text, n.pos)) {
        if (TS_LINE_DIRECTIVE.test(text.slice(c.pos, c.end))) out.push({ start: c.pos, end: c.end, next: sf.getLineAndCharacterOfPosition(c.end).line + 1 });
      }
      return;
    }
    for (const k of kids) visit(k);
  };
  visit(sf);
  lineDirectiveCache.set(sf, out);
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Lean names
// ---------------------------------------------------------------------------------------------------------------

/**
 * Every identifier-shaped token of the Lean parser, as seen by the emitted model AND by a theorem file that replaces
 * `import Faithful.Core` with `import Faithful.Tactics` (Mathlib adds tokens such as `to`). A binder, record field or
 * function named like a token does not parse (red-team round 4, r4TokParam/Local/Field/FnName/TacticsTo: `using`,
 * `until`, `matches`, `repeat`, `to`). Dumped from the token table (`Lean.Parser.parserExtension` state `.tokens`)
 * with Lean 4.34.0 under `import Faithful.Tactics` and under `import Faithful.Core` + `import Lean` (union), filtered
 * to `[A-Za-z_][A-Za-z0-9_]*`; `lean.test.ts` re-dumps the table and checks that every such token is reserved.
 * Tactic names (`simp`, `omega`, ...) are not tokens (the tactic category reads leading identifiers as identifiers),
 * so they are legal binder names.
 */
const LEAN_TOKENS =
  'PiType Prop Sort StateRefT Type abbrev add_aesop_rules add_decl_doc alias assert_not_exists assert_not_imported ' +
  'assumeInstancesCommuteDummy at attribute axiom bif binder_predicate break builtin_cbv_simproc ' +
  'builtin_cbv_simproc_decl builtin_dsimproc builtin_dsimproc_decl builtin_grind_propagator builtin_initialize ' +
  'builtin_simproc builtin_simproc_decl by by_elab calc catch cbv_eval cbv_simproc cbv_simproc_decl class ' +
  'coinductive coinductive_fixpoint continue dbg_trace declare_aesop_rule_sets declare_bitwise_int_theorems ' +
  'declare_bitwise_uint_theorems declare_command_config_elab declare_command_config_elab_legacy ' +
  'declare_config_elab declare_config_elab_legacy declare_core_config_elab declare_eval_bin ' +
  'declare_eval_bin_bitwise declare_eval_bin_bool_pred declare_int_theorems declare_simp_like_tactic ' +
  'declare_sint_simprocs declare_syntax_cat declare_term_config_elab declare_uint_simprocs declare_uint_theorems ' +
  'decreasing_by def def_eval_config_item def_wanted deprecate deprecated_module deprecated_syntax deriving do ' +
  'docs_to_verso dsimproc dsimproc_decl elab elab_rules elab_stx_quot else end erase_aesop_rules eval_prec ' +
  'eval_prio example exists export extend_docs extends finally for forall from fun generalizing grind_annotated ' +
  'grind_pattern grind_propagator guard_min_heartbeats have haveI hiding idbg if import in include include_str ' +
  'inductive inductive_fixpoint inferInstanceAs infix infixl infixr init_grind_norm init_quot initialize ' +
  'initialize_simps_projections insert_to_additive_translation insert_to_dual_translation instance instance_wanted ' +
  'irreducible_def kerodon leading_parser lemma let letI let_delayed let_expr let_fun let_impl_detail let_tmp ' +
  'library_note local logNamedError logNamedErrorAt logNamedWarning logNamedWarningAt macro macro_rules match ' +
  'match_expr matches max_prec meta mk_iff_of_inductive_prop mod_cast mut mutual namespace nat_lit no_index nofun ' +
  'nomatch noncomputable nonrec norm_cast_add_elim notation notation3 omit opaque open partial partial_fixpoint ' +
  'postfix prefix private proof_wanted protected public recommended_spelling register_builtin_option ' +
  'register_error_explanation register_grind_attr register_hint register_label_attr register_linter_set ' +
  'register_option register_parser_alias register_simp_attr register_sym_dsimp register_sym_simp ' +
  'register_sym_simp_attr register_tactic_tag renaming repeat reprove return run_cmd run_elab run_meta says scoped ' +
  'seal section set_library_suggestions set_option show show_panel_widgets show_term show_term_elab simproc ' +
  'simproc_decl sorry stacks structure sudo suffices syntax tactic_alt tactic_extension tactic_name tactic_tag ' +
  'termination_by test_extern then theorem theorem_wanted throwError throwErrorAt throwNamedError ' +
  'throwNamedErrorAt to to_additive_name_hint to_dual_insert_cast to_dual_insert_cast_fun to_dual_name_hint ' +
  'trailing_parser try unif_hint universe unless unlock_limits unsafe unseal unset_option until using variable ' +
  'variables whatsnew where while with with_annotate_term with_weak_namespace without_expected_type';

/** Lean tokens (above), older keyword entries, and every head identifier the emitter writes unqualified or as a namespace root. */
const LEAN_RESERVED = new Set(
  (
    LEAN_TOKENS +
    ' at by calc deriving do else end example extends fun have if import in infix infixl infixr instance let local match ' +
    'mut namespace notation open partial prefix private protected return section structure termination_by then theorem ' +
    'universe unsafe variable where with from for unless break continue try catch finally axiom class def inductive ' +
    'abbrev opaque macro syntax set_option show suffices nomatch nofun noncomputable postfix attribute mutual ' +
    'decreasing_by export omit include forall exists Type Sort Prop lemma elab elab_rules macro_rules notation ' +
    'Faithful Model Int Nat List Char Bool String Except Option Unit Lean Min Max Prod decide pure some none true ' +
    'false id ok error throw default inferInstance Json toJson IO max min sorry this'
  ).split(/\s+/),
);

/** A Lean identifier for a TypeScript identifier: ASCII letters, digits, `_`; never a keyword or emitter head. */
export function leanIdent(name: string): string {
  let s = '';
  for (const ch of name) {
    if (/[A-Za-z0-9_]/.test(ch)) s += ch;
    else s += `_u${ch.codePointAt(0)!.toString(16)}`;
  }
  // `""` is a legal TypeScript field name (red-team round 2, r2EmptyFieldName); a Lean identifier must be non-empty.
  // Record fields keep the TypeScript name as their JSON key, and `Records.register` suffixes collisions (`v` vs `v_`).
  if (s === '' || s.startsWith('_') || /^[0-9]/.test(s)) s = `v${s}`;
  if (LEAN_RESERVED.has(s)) s = `${s}_`;
  return s;
}

/** Is `name` reserved (a Lean token or an emitter head)? For the token-table test in lean.test.ts. */
export function isLeanReserved(name: string): boolean {
  return LEAN_RESERVED.has(name);
}

/** Fresh-name supply for one Lean definition. */
export class Names {
  private used = new Set<string>();
  fresh(base: string): string {
    const b = leanIdent(base);
    if (!this.used.has(b)) {
      this.used.add(b);
      return b;
    }
    for (let i = 1; ; i++) {
      const c = `${b}_${i}`;
      if (!this.used.has(c) && !LEAN_RESERVED.has(c)) {
        this.used.add(c);
        return c;
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Type mapping
// ---------------------------------------------------------------------------------------------------------------

const F = ts.TypeFlags;

/** Registry of record shapes seen in one translation, so each shape gets one Lean structure. */
/** Field names that clash with what Lean generates for a structure (constructor, recursors, ...). */
const STRUCT_RESERVED = new Set(['mk', 'rec', 'recOn', 'casesOn', 'noConfusion', 'noConfusionType', 'below', 'brecOn', 'binductionOn', 'ibelow', 'sizeOf', 'toCtorIdx', 'ctorIdx', 'induct']);

export class Records {
  readonly byKey = new Map<string, RecordDecl>();
  private usedNames = new Set<string>();
  /** `fnLean`: the translated function's Lean name; structures never take it or a name derived from it. */
  constructor(private readonly fnLean = '') {}
  private taken(name: string): boolean {
    return this.usedNames.has(name) || (this.fnLean !== '' && (name === this.fnLean || name.startsWith(`${this.fnLean}_`)));
  }
  register(t: Extract<Ty, { k: 'record' }>, preferred: string | undefined): RecordDecl {
    const key = recordKey(t);
    const have = this.byKey.get(key);
    if (have) return have;
    let base = preferred ? leanIdent(preferred) : 'Rec';
    if (/^[a-z]/.test(base)) base = base[0]!.toUpperCase() + base.slice(1);
    let name = base;
    for (let i = 1; this.taken(name) || (!preferred && name === 'Rec'); i++) name = `${base}${i}`;
    this.usedNames.add(name);
    const fieldNames = new Set<string>();
    const decl: RecordDecl = {
      name,
      key,
      fields: t.fields.map((f) => {
        let lean = leanIdent(f.name);
        while (fieldNames.has(lean) || STRUCT_RESERVED.has(lean)) lean = `${lean}_`;
        fieldNames.add(lean);
        return { name: f.name, lean, ty: f.ty };
      }),
    };
    this.byKey.set(key, decl);
    return decl;
  }
  get(t: Extract<Ty, { k: 'record' }>): RecordDecl {
    const d = this.byKey.get(recordKey(t));
    if (!d) throw new Error(`internal: unregistered record ${recordKey(t)}`);
    return d;
  }
  all(): RecordDecl[] {
    return [...this.byKey.values()];
  }
}

export interface MapOpts {
  /** Allow `T | null` / `T | undefined` at the top (return types only). */
  allowOption: boolean;
  what: string;
}

const NAMED_REFUSALS: Record<string, [RefusalCode, string]> = {
  Map: ['map-set', 'Map'],
  Set: ['map-set', 'Set'],
  WeakMap: ['map-set', 'WeakMap'],
  WeakSet: ['map-set', 'WeakSet'],
  ReadonlyMap: ['map-set', 'ReadonlyMap'],
  ReadonlySet: ['map-set', 'ReadonlySet'],
  Date: ['date', 'Date'],
  RegExp: ['regex', 'RegExp'],
  RegExpMatchArray: ['regex', 'RegExpMatchArray'],
  Promise: ['async', 'Promise'],
  PromiseLike: ['async', 'Promise'],
};

/**
 * Map a checker type to a subset type, refusing with the most specific code. `at` is the node whose span a refusal
 * reports (an annotation when there is one).
 */
export function mapType(checker: ts.TypeChecker, t: ts.Type, at: ts.Node, records: Records, opts: MapOpts, stack: ts.Type[] = []): Ty {
  const f = t.flags;
  const what = opts.what;
  if (f & F.Any) refuse('unsupported-type', `${what} has type any; annotate it with a subset type`, at);
  if (f & F.Unknown) refuse('unsupported-type', `${what} has type unknown`, at);
  if (f & F.TypeParameter) refuse('generic', `${what} has a generic type parameter`, at);
  if (f & F.EnumLike) refuse('unsupported-type', `${what} is an enum; enums are outside subset v1`, at);
  if (f & F.NumberLiteral) {
    // A number literal type admits exactly one value; it must be an integer within ±2^53 (red-team round 1,
    // floatLiteralType: `1 | 2.5` was mapped to int and the int-bound precondition silently dropped half the domain).
    const v = (t as ts.NumberLiteralType).value;
    if (!Number.isInteger(v)) refuse('float', `${what} has the non-integer number literal type ${checker.typeToString(t)}; numbers are integers in subset v1`, at);
    if (Math.abs(v) > 2 ** 53) refuse('unsupported-type', `${what} has the number literal type ${checker.typeToString(t)}, outside ±2^53`, at);
    return { k: 'int' };
  }
  if (f & F.Number) return { k: 'int' };
  if (f & (F.String | F.StringLiteral)) return { k: 'string' };
  if (f & (F.Boolean | F.BooleanLiteral)) return { k: 'bool' };
  if (f & (F.BigInt | F.BigIntLiteral)) refuse('unsupported-type', `${what} is a bigint`, at);
  if (f & F.TemplateLiteral) refuse('unsupported-type', `${what} has a template literal type`, at);
  if (f & (F.Void | F.Undefined | F.Null | F.Never)) refuse('unsupported-type', `${what} is void/null/undefined/never; only \`T | null\` or \`T | undefined\` as a return type is supported`, at);
  if (f & (F.ESSymbol | F.UniqueESSymbol)) refuse('unsupported-type', `${what} is a symbol`, at);
  if (t.isUnion()) {
    const nullish = t.types.filter((u) => u.flags & (F.Null | F.Undefined | F.Void));
    const rest = t.types.filter((u) => !(u.flags & (F.Null | F.Undefined | F.Void)));
    if (nullish.length > 0) {
      if (!opts.allowOption) refuse('unsupported-type', `${what} can be null/undefined; null and undefined are supported only as a function's return type (T | null)`, at);
      if (rest.length === 0) refuse('unsupported-type', `${what} is only null/undefined`, at);
      const inner = unionOfRest(checker, rest, at, records, { allowOption: false, what }, stack);
      return { k: 'option', inner };
    }
    return unionOfRest(checker, rest, at, records, opts, stack);
  }
  if (t.flags & F.Intersection) refuse('unsupported-type', `${what} is an intersection type`, at);
  if (checker.isTupleType(t)) {
    const target = (t as ts.TypeReference).target as ts.TupleType;
    if (target.elementFlags.some((ef) => ef & (ts.ElementFlags.Optional | ts.ElementFlags.Rest | ts.ElementFlags.Variadic)))
      refuse('unsupported-type', `${what} is a tuple with optional or rest elements`, at);
    const args = checker.getTypeArguments(t as ts.TypeReference);
    if (args.length < 2) refuse('unsupported-type', `${what} is a tuple with fewer than two elements`, at);
    return { k: 'tuple', elems: args.map((a, i) => mapType(checker, a, at, records, { allowOption: false, what: `${what} element ${i}` }, stack)) };
  }
  if (checker.isArrayType(t)) {
    const [elem] = checker.getTypeArguments(t as ts.TypeReference);
    if (!elem) refuse('unsupported-type', `${what} is an array of unknown element type`, at);
    if (elem.flags & F.Never) refuse('missing-annotation', `${what} is an empty array literal whose element type TypeScript cannot infer; annotate it (e.g. \`const xs: number[] = []\`)`, at);
    return { k: 'array', elem: mapType(checker, elem, at, records, { allowOption: false, what: `${what} element` }, stack) };
  }
  if (f & F.Object) {
    const sym = t.getSymbol() ?? t.aliasSymbol;
    const named = sym ? NAMED_REFUSALS[sym.getName()] : undefined;
    if (named) refuse(named[0], `${what} is a ${named[1]}; ${named[1]} is outside subset v1`, at);
    if (checker.getIndexInfosOfType(t).length > 0)
      refuse('dictionary', `${what} is a dictionary object (index signature / Record<string, ...>); dictionaries are outside subset v1`, at);
    if (t.getCallSignatures().length > 0 || t.getConstructSignatures().length > 0)
      refuse('unsupported-type', `${what} is a function type; function values are outside subset v1`, at);
    if (stack.includes(t)) refuse('unsupported-type', `${what} is a recursive record type; recursive types are outside subset v1`, at);
    const props = checker.getPropertiesOfType(t);
    if (props.length === 0) refuse('unsupported-type', `${what} is an empty object type`, at);
    const fields: Array<{ name: string; ty: Ty }> = [];
    for (const p of props) {
      if (p.flags & ts.SymbolFlags.Optional) refuse('unsupported-type', `${what} has an optional field \`${p.getName()}\``, at);
      // In an object literal, `__proto__: v` (bare or quoted key) sets the prototype instead of creating a field, while
      // JSON.parse and the Lean model treat it as a field (red-team round 2, r2ProtoFieldLiteral / r2ProtoFieldStringKey).
      // Refused at the type, so record literals, projections and generated inputs never meet it.
      if (p.getName() === '__proto__')
        refuse('unsupported-type', `${what} has a field named \`__proto__\`: in an object literal that key sets the prototype instead of creating a field; it is outside subset v1`, at);
      if (p.flags & (ts.SymbolFlags.Method | ts.SymbolFlags.Accessor | ts.SymbolFlags.GetAccessor | ts.SymbolFlags.SetAccessor))
        refuse('unsupported-type', `${what} has a method or accessor \`${p.getName()}\``, at);
      const pt = checker.getTypeOfSymbolAtLocation(p, at);
      fields.push({ name: p.getName(), ty: mapType(checker, pt, at, records, { allowOption: false, what: `field \`${p.getName()}\` of ${what}` }, [...stack, t]) });
    }
    const rec = { k: 'record' as const, fields };
    const alias = t.aliasSymbol?.getName();
    const symName = sym && !sym.getName().startsWith('__') ? sym.getName() : undefined;
    records.register(rec, alias ?? symName);
    return rec;
  }
  refuse('unsupported-type', `${what} has type \`${checker.typeToString(t)}\`, which is outside subset v1`, at);
}

function unionOfRest(checker: ts.TypeChecker, rest: ts.Type[], at: ts.Node, records: Records, opts: MapOpts, stack: ts.Type[]): Ty {
  if (rest.length === 1) return mapType(checker, rest[0]!, at, records, opts, stack);
  if (rest.every((u) => u.flags & (F.NumberLiteral | F.Number))) {
    for (const u of rest) mapType(checker, u, at, records, opts, stack); // each literal must be an integer within ±2^53
    return { k: 'int' };
  }
  if (rest.every((u) => u.flags & (F.StringLiteral | F.String))) return { k: 'string' };
  if (rest.every((u) => u.flags & (F.BooleanLiteral | F.Boolean))) return { k: 'bool' };
  refuse('unsupported-type', `${opts.what} is a union of different types; unions are outside subset v1`, at);
}

/** Does a type mention `int`/`string` anywhere (for preconditions)? */
export function tyMentions(t: Ty, k: 'int' | 'string'): boolean {
  switch (t.k) {
    case 'int':
    case 'string':
      return t.k === k;
    case 'bool':
      return false;
    case 'array':
      return tyMentions(t.elem, k);
    case 'tuple':
      return t.elems.some((e) => tyMentions(e, k));
    case 'record':
      return t.fields.some((f) => tyMentions(f.ty, k));
    case 'option':
      return tyMentions(t.inner, k);
  }
}
