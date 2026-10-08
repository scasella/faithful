/**
 * Static showcase build. `base: './'` so dist/ works from any static server path.
 *
 * - The UI's screens are used from ../ui/src (not forked) via the `@ui` alias.
 * - Package sources are aliased so the live checks run the real engine / translator / SMT encoder in the browser;
 *   the few Node built-ins they touch are replaced by small shims (src/shims), and every import of the engine's
 *   Node sandbox host (packages/engine/src/sandbox/sandbox.ts) is redirected to the browser port
 *   (src/live/browserSandbox.ts). No package source is modified.
 * - `virtual:faithful-ts-libs`: the ES2023 lib .d.ts texts for the in-browser TypeScript compiler.
 * - recordings/index.json is generated from public/recordings/*.json (drop a recording there and rebuild).
 * - z3/: z3-solver's WASM build, copied from node_modules (not committed; 35 MB).
 */
import { defineConfig, type Plugin } from 'vite';
import preact from '@preact/preset-vite';
import { createRequire } from 'node:module';
import { copyFileSync, mkdirSync, readFileSync, readdirSync, existsSync, realpathSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const r = (p: string) => resolve(repo, p);
const require_ = createRequire(join(repo, 'packages/smt/package.json'));
const z3Pkg = dirname(require_.resolve('z3-solver/package.json'));
const z3Version = (JSON.parse(readFileSync(join(z3Pkg, 'package.json'), 'utf8')) as { version: string }).version;
const tsLibDir = dirname(createRequire(join(repo, 'packages/translate/package.json')).resolve('typescript/lib/lib.d.ts'));

/** `/// <reference lib="x" />` closure from the given roots. */
function libClosure(roots: string[]): Map<string, string> {
  const out = new Map<string, string>();
  const todo = [...roots];
  while (todo.length) {
    const name = todo.pop()!;
    if (out.has(name)) continue;
    const text = readFileSync(join(tsLibDir, name), 'utf8');
    out.set(name, text);
    for (const m of text.matchAll(/\/\/\/\s*<reference\s+lib="([^"]+)"\s*\/>/g)) todo.push(`lib.${m[1]!.toLowerCase()}.d.ts`);
  }
  return out;
}

function tsLibs(): Plugin {
  const id = 'virtual:faithful-ts-libs';
  return {
    name: 'faithful-ts-libs',
    resolveId: (s) => (s === id ? '\0' + id : null),
    load(i) {
      if (i !== '\0' + id) return null;
      // es2023 for the translator (program.ts), es2022 for the compile gate (COMPILE_OPTIONS.lib).
      const libs = libClosure(['lib.es2023.d.ts', 'lib.es2022.d.ts']);
      return `export default ${JSON.stringify(Object.fromEntries(libs))};`;
    },
  };
}

/** Redirect the engine's Node sandbox host to the browser port (same API). */
function browserSandbox(): Plugin {
  const target = r('apps/showcase/src/live/browserSandbox.ts');
  const engineSrc = r('packages/engine/src') + '/';
  return {
    name: 'faithful-browser-sandbox',
    enforce: 'pre',
    resolveId(source, importer) {
      if (!importer || !importer.startsWith(engineSrc)) return null;
      if (/(^|\/)sandbox\/sandbox(\.js|\.ts)?$/.test(source) || (/^\.\/sandbox(\.js|\.ts)?$/.test(source) && importer.includes('/sandbox/'))) return target;
      return null;
    },
  };
}

interface RecordingHead {
  name: string;
  file: string;
  fn: string;
  recordedAt: string;
  notes: string;
  lean: string | null;
  carveOuts: string[];
  specFaults: boolean;
}

interface RecEvent {
  kind: string;
  agreement?: { carveOuts?: { words: string }[] };
  run?: { disagreements?: { spec?: { tag?: string } }[] };
}

/** The last agreed spec's carve-out words, and whether a challenge run listed a spec fault (see site/recording.ts). */
function cautionsOf(events: { event: RecEvent }[]): { carveOuts: string[]; specFaults: boolean } {
  let carveOuts: string[] = [];
  let specFaults = false;
  for (const { event: e } of events) {
    if (e.kind === 'spec.agreed') carveOuts = (e.agreement?.carveOuts ?? []).map((c) => c.words);
    if (e.kind === 'challenge.run' && (e.run?.disagreements ?? []).some((d) => d.spec?.tag === 'fault')) specFaults = true;
  }
  return { carveOuts, specFaults };
}

function recordingsIndex(): RecordingHead[] {
  const dir = join(here, 'public/recordings');
  if (!existsSync(dir)) return [];
  const heads: RecordingHead[] = [];
  for (const f of readdirSync(dir).sort()) {
    if (!f.endsWith('.json') || f === 'index.json') continue;
    const j = JSON.parse(readFileSync(join(dir, f), 'utf8')) as { schema?: number; fn?: string; recordedAt?: string; notes?: string; stampedEvents?: { event: RecEvent }[] };
    if (j.schema !== 1 || typeof j.fn !== 'string') throw new Error(`public/recordings/${f}: not a schema-1 recording`);
    const name = f.slice(0, -5);
    heads.push({ name, file: `recordings/${f}`, fn: j.fn, recordedAt: j.recordedAt ?? '', notes: j.notes ?? '', lean: existsSync(join(dir, `${name}.lean`)) ? `recordings/${name}.lean` : null, ...cautionsOf(j.stampedEvents ?? []) });
  }
  return heads;
}

function staticExtras(): Plugin {
  const z3Files = ['z3-built.js', 'z3-built.wasm'];
  return {
    name: 'faithful-static-extras',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? '').split('?')[0]!;
        if (url.endsWith('/recordings/index.json')) {
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify(recordingsIndex()));
          return;
        }
        const m = /\/z3\/(z3-built\.(js|wasm))$/.exec(url);
        if (m) {
          res.setHeader('content-type', m[2] === 'js' ? 'text/javascript' : 'application/wasm');
          res.end(readFileSync(join(z3Pkg, 'build', m[1]!)));
          return;
        }
        next();
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'recordings/index.json', source: JSON.stringify(recordingsIndex(), null, 1) });
    },
    writeBundle(opts) {
      const out = join(opts.dir ?? join(here, 'dist'), 'z3');
      mkdirSync(out, { recursive: true });
      for (const f of z3Files) copyFileSync(join(z3Pkg, 'build', f), join(out, f));
      const lic = join(z3Pkg, 'LICENSE.txt');
      if (existsSync(lic) && statSync(lic).isFile()) copyFileSync(lic, join(out, 'LICENSE.txt'));
    },
  };
}

const shim = (n: string) => r(`apps/showcase/src/shims/${n}.ts`);

export default defineConfig({
  plugins: [browserSandbox(), tsLibs(), staticExtras(), preact()],
  base: './',
  define: { __Z3_VERSION__: JSON.stringify(z3Version) },
  resolve: {
    // One preact for the page, the UI's screens and @preact/signals (which pnpm links to its own preact copy).
    dedupe: ['preact'],
    alias: [
      // Undeclared here on purpose (no lockfile change): resolved from the UI app's dependencies.
      { find: /^@preact\/signals$/, replacement: realpathSync(r('apps/ui/node_modules/@preact/signals')) },
      { find: /^@ui\//, replacement: r('apps/ui/src') + '/' },
      { find: /^@faithful\/core\/tiers$/, replacement: r('packages/core/src/tiers.ts') },
      { find: /^@faithful\/core$/, replacement: r('packages/core/src/tiers.ts') },
      { find: /^@faithful\/session$/, replacement: r('packages/session/src/index.ts') },
      { find: /^@faithful\/translate$/, replacement: r('packages/translate/src/index.ts') },
      { find: /^@faithful\/engine$/, replacement: r('apps/showcase/src/live/engine.ts') },
      { find: /^@faithful-engine-src\//, replacement: r('packages/engine/src') + '/' },
      { find: /^@faithful-smt-src\//, replacement: r('packages/smt/src') + '/' },
      { find: /^node:fs$/, replacement: shim('fs') },
      { find: /^node:path$/, replacement: shim('path') },
      { find: /^node:module$/, replacement: shim('module') },
      { find: /^node:crypto$/, replacement: shim('crypto') },
      { find: /^node:worker_threads$/, replacement: shim('worker_threads') },
    ],
  },
  worker: { format: 'iife', plugins: () => [browserSandbox(), tsLibs()] },
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2022', chunkSizeWarningLimit: 6000 },
  server: { host: '127.0.0.1', fs: { allow: [repo] } },
  // Dev only: no dependency scan (it cannot see the virtual lib module); pre-bundle the CommonJS deps explicitly.
  optimizeDeps: { noDiscovery: true, include: ['typescript', 'z3-solver/build/low-level/wrapper.__GENERATED__.js'] },
});
