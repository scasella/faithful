/**
 * The declared input distribution for benchmarking. The default is CALIBRATED: sizes are chosen by running the original
 * (instrumented, so every size stays inside the model) until one call takes about a millisecond. The distribution is shown
 * to the user with its sizes; it is never hidden behind "typical inputs".
 */
import { compilePreconditions, INSTRUMENTED_ENTRY, instrumentedSandboxSource, type BenchRng, type Distribution, type Sandbox } from '@faithful/engine';
import { mulberry32 } from '@faithful/engine';
import type { Precondition, Translation, Ty, Val } from '@faithful/translate';

function genVal(ty: Ty, size: number, rng: BenchRng): Val {
  const int = (lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1));
  switch (ty.k) {
    case 'int':
      return int(0, size);
    case 'bool':
      return rng() < 0.5;
    case 'string':
      return Array.from({ length: size }, () => String.fromCharCode(97 + int(0, 25))).join('');
    case 'array':
      return Array.from({ length: size }, () => genElem(ty.elem, size, rng));
    case 'tuple':
      return ty.elems.map((e) => genVal(e, size, rng));
    case 'record':
      return Object.fromEntries(ty.fields.map((f) => [f.name, genVal(f.ty, size, rng)]));
    case 'option':
      return genVal(ty.inner, size, rng);
  }
}
function genElem(ty: Ty, size: number, rng: BenchRng): Val {
  if (ty.k === 'int') return Math.floor(rng() * (2 * size + 1)) - size;
  return genVal(ty, Math.min(size, 4), rng);
}

export function describeDistribution(t: Translation): string {
  const parts = t.params.map((p) => `${p.name}: ${p.ty.k === 'int' ? 'integer in [0, n]' : p.ty.k === 'array' ? 'array of n values' : p.ty.k === 'string' ? 'n lowercase letters' : p.ty.k}`);
  return `${parts.join('; ')}`;
}

export interface Calibrated {
  distribution: Distribution;
  sizes: number[];
  note: string;
}

export async function calibrateDistribution(t: Translation, carveOuts: Precondition[], sb: Sandbox, opts: { targetMs?: number; maxSize?: number } = {}): Promise<Calibrated> {
  const targetMs = opts.targetMs ?? 1;
  const maxSize = opts.maxSize ?? 4096;
  const preds = compilePreconditions(t.params, [...t.preconditions, ...carveOuts]);
  const accepts = (args: Val[]) => preds.every((p) => p.test(args));
  const gen = (size: number, rng: BenchRng): Val[] => {
    for (let k = 0; k < 200; k++) {
      const args = t.params.map((p) => genVal(p.ty, size, rng));
      if (accepts(args)) return args;
    }
    return t.params.map((p) => genVal(p.ty, size, rng)); // last resort; range-violating inputs are screened in calibration
  };
  const id = `calib:${Math.random().toString(36).slice(2)}`;
  const loaded = await sb.load(id, instrumentedSandboxSource(t), INSTRUMENTED_ENTRY, { instrumented: true });
  if (!loaded.ok) throw new Error(`calibration: the original did not load: ${loaded.error}`);
  let best = 1;
  let note = 'sizes chosen by running the original';
  try {
    for (let size = 2; size <= maxSize; size *= 2) {
      const rng = mulberry32(7 + size);
      const sample = Array.from({ length: 6 }, () => gen(size, rng));
      const t0 = performance.now();
      const res = (await sb.callBatch(id, sample, { perCallMs: 5_000 })).results;
      const ms = (performance.now() - t0) / sample.length;
      if (res.some((r) => r.outcome.tag === 'range-violation' || r.outcome.tag === 'fault' || (r.outcome.tag === 'throw' && true))) {
        note = `sizes stop at ${best}: larger inputs leave the model's range or throw for this function`;
        break;
      }
      best = size;
      if (ms >= targetMs) {
        note = `sizes chosen so one call of the original takes about ${targetMs} ms at the largest size`;
        break;
      }
    }
  } finally {
    await sb.unload(id);
  }
  const sizes = [...new Set([Math.max(1, Math.floor(best / 4)), Math.max(1, Math.floor(best / 2)), best])];
  return { distribution: { name: `auto: ${describeDistribution(t)}`, sizes, gen }, sizes, note };
}
