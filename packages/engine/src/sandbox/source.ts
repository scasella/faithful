/**
 * `moduleProblems` adapted from scasella/undefined packages/engine/src/gates/compile.ts, MIT, (c) 2026 Stephen Casella; changes: also
 * rejects import declarations, re-exports and `export =`, returns positions for line/column reporting. The rest is new.
 *
 * Turn a TypeScript translation unit into strict-mode script JS that `evalMasked` can run: types erased by
 * `ts.transpileModule`, `export` / `export default` modifiers stripped, `export { f }` lists dropped. Module syntax that
 * would load other code (import declarations, `import()`, `import.meta`, `require(...)` is trapped at run time) is
 * rejected here with a position, by walking the AST (so strings and comments containing "import" are not affected).
 */
import ts from 'typescript';

export interface PreparedSource {
  ok: true;
  js: string;
}

export interface SourceProblem {
  ok: false;
  /** `line N, column M: message` */
  error: string;
}

function where(sf: ts.SourceFile, pos: number): string {
  const lc = sf.getLineAndCharacterOfPosition(pos);
  return `line ${lc.line + 1}, column ${lc.character + 1}`;
}

/** Module-loading constructs that evalMasked must never see. */
export function moduleProblems(sf: ts.SourceFile): Array<{ pos: number; message: string }> {
  const out: Array<{ pos: number; message: string }> = [];
  for (const st of sf.statements) {
    if (ts.isImportDeclaration(st) || ts.isImportEqualsDeclaration(st)) {
      // `import type { X }` is erased and harmless.
      if (ts.isImportDeclaration(st) && st.importClause?.isTypeOnly) continue;
      out.push({ pos: st.getStart(sf), message: 'import declarations are not allowed: the function must be self-contained' });
    } else if (ts.isExportDeclaration(st) && st.moduleSpecifier) {
      out.push({ pos: st.getStart(sf), message: 're-exports from another module are not allowed' });
    } else if (ts.isExportAssignment(st)) {
      out.push({ pos: st.getStart(sf), message: '`export =` / `export default <expression>` is not allowed; export the function declaration' });
    }
  }
  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword) {
      out.push({ pos: n.getStart(sf), message: 'dynamic import() is not allowed' });
    } else if (ts.isMetaProperty(n) && n.keywordToken === ts.SyntaxKind.ImportKeyword) {
      out.push({ pos: n.getStart(sf), message: 'import.meta is not allowed' });
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

const stripExports: ts.TransformerFactory<ts.SourceFile> = (ctx) => (sf) => {
  const statements: ts.Statement[] = [];
  for (const st of sf.statements) {
    if (ts.isExportDeclaration(st)) continue; // `export { f }`, `export type { T }`
    if (ts.canHaveModifiers(st)) {
      const mods = ts.getModifiers(st);
      if (mods?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword || m.kind === ts.SyntaxKind.DefaultKeyword)) {
        const kept = mods.filter((m) => m.kind !== ts.SyntaxKind.ExportKeyword && m.kind !== ts.SyntaxKind.DefaultKeyword);
        statements.push(ts.factory.replaceModifiers(st, kept) as ts.Statement);
        continue;
      }
    }
    statements.push(st);
  }
  void ctx;
  return ts.factory.updateSourceFile(sf, statements);
};

export function prepareSource(source: string, fileName = 'unit.ts'): PreparedSource | SourceProblem {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const syntax = (sf as unknown as { parseDiagnostics?: ts.Diagnostic[] }).parseDiagnostics ?? [];
  const first = syntax[0];
  if (first) {
    return { ok: false, error: `${where(sf, first.start ?? 0)}: ${ts.flattenDiagnosticMessageText(first.messageText, '\n')}` };
  }
  const bad = moduleProblems(sf)[0];
  if (bad) return { ok: false, error: `${where(sf, bad.pos)}: ${bad.message}` };
  const out = ts.transpileModule(source, {
    fileName,
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      isolatedModules: true,
      verbatimModuleSyntax: false,
      newLine: ts.NewLineKind.LineFeed,
      removeComments: false,
    },
    transformers: { before: [stripExports] },
  });
  const err = (out.diagnostics ?? []).find((d) => d.category === ts.DiagnosticCategory.Error);
  if (err) {
    const pos = err.file && err.start !== undefined ? where(err.file, err.start) : 'line 1, column 1';
    return { ok: false, error: `${pos}: ${ts.flattenDiagnosticMessageText(err.messageText, '\n')}` };
  }
  // A module with every export stripped still gets the `export {};` marker from the emitter.
  const js = out.outputText.replace(/^export \{\};\s*$/gm, '');
  return { ok: true, js };
}
