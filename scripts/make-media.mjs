// Records the BUILT showcase (apps/showcase/dist) replaying a real recording and encodes a GIF and an MP4 with ffmpeg.
// Not part of the build or the test suite (needs Chrome and ffmpeg).
//
//   node scripts/make-media.mjs [recording.json] [--allow-dev-sample] [--speed <1|2|4|8|16|64>] [--fps <n>]
//                               [--out-dir <dir>] [--build | --use-existing-dist] [--keep-frames]
//
//   recording.json   a recording under apps/showcase/public/recordings (default: .../dev-sample.json)
//   --allow-dev-sample  allow a recording whose notes begin with "DEV SAMPLE"; outputs get the suffix -dev-sample
//   --speed          uniform replay speed (play): one of 1, 2, 4, 8, 16, 64 (the speeds the replay bar's `s` key cycles).
//                    Without it (default) the replay is PACED: the script steps the replay one event at a time (the
//                    bar's Step key `.`) on a schedule that compresses long waits and lingers on decisions
//                    (candidate.decided, proof.done, incumbent.changed, deliver.done), scaled to about 30 s.
//   --zoom           CSS zoom applied to the document for the capture (default 0.75), so more of each stage fits in
//                    the 1280x720 frame. The UI and the recording are not changed.
//   --fps            capture rate in frames per second (default 10). Frames are placed on a fixed clock: a slow
//                    screenshot repeats the previous frame, so playback time matches wall time.
//   --out-dir        default docs/media. Outputs: faithful-demo[-dev-sample].gif and .mp4
//   --build          rebuild the showcase (pnpm --filter @faithful/showcase build) when dist is missing or stale;
//                    without it the script prints the command and exits 2.
//   --use-existing-dist  record the existing dist even when sources changed after it was built (warns; the
//                    recording itself must still be in dist and identical).
//   --keep-frames    keep the captured PNGs (path printed) instead of deleting them.
//
// Refuses: files outside apps/showcase/public/recordings, files that are not schema-1 recordings, anything marked as a
// fixture / TEST-ONLY, and DEV SAMPLE recordings without --allow-dev-sample.
// Serves dist/ with `python3 -m http.server` and drives installed Chrome headless (1280x720, scale 1), like
// apps/showcase/scripts/check.mjs.
import { createRequire } from 'node:module';
import { spawn, spawnSync } from 'node:child_process';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const showcase = join(repo, 'apps/showcase');
const recDir = join(showcase, 'public/recordings');
const dist = join(showcase, 'dist');
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SPEEDS = [1, 2, 4, 8, 16, 64]; // apps/ui/src/adapters/replay.ts; the showcase starts at 8
const START_SPEED = 8;
const TARGET_S = 30;
const CAP_S = 35;
const TAIL_MS = 1500;
const GIF_MAX = 8 * 1024 * 1024;

function die(msg, code = 1) {
  console.error(`make-media: ${msg}`);
  process.exit(code);
}

// ---- arguments
const argv = process.argv.slice(2);
const opt = { recording: null, allowDev: false, speed: null, zoom: 0.75, fps: 10, outDir: 'docs/media', build: false, useDist: false, keepFrames: false };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  const val = () => {
    const v = argv[++i];
    if (v === undefined) die(`${a} needs a value`);
    return v;
  };
  if (a === '--allow-dev-sample') opt.allowDev = true;
  else if (a === '--speed') opt.speed = Number(val());
  else if (a === '--fps') opt.fps = Number(val());
  else if (a === '--zoom') opt.zoom = Number(val());
  else if (a === '--out-dir') opt.outDir = val();
  else if (a === '--build') opt.build = true;
  else if (a === '--use-existing-dist') opt.useDist = true;
  else if (a === '--keep-frames') opt.keepFrames = true;
  else if (a === '-h' || a === '--help') {
    console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\nimport ')[0]);
    process.exit(0);
  } else if (a.startsWith('--')) die(`unknown option ${a}`);
  else if (opt.recording) die(`more than one recording given (${opt.recording}, ${a})`);
  else opt.recording = a;
}
if (opt.speed !== null && !SPEEDS.includes(opt.speed)) die(`--speed must be one of ${SPEEDS.join(', ')} (the speeds the replay bar offers)`);
if (!(opt.fps > 0 && opt.fps <= 30)) die('--fps must be in (0, 30]');
if (!(opt.zoom >= 0.5 && opt.zoom <= 1)) die('--zoom must be in [0.5, 1]');

// ---- the recording: where it is and what it is
const recPath = resolve(opt.recording ?? join(recDir, 'dev-sample.json'));
if (!existsSync(recPath)) die(`no such file: ${recPath}`);
const realRec = realpathSync(recPath);
const realDir = realpathSync(recDir);
if (!realRec.startsWith(realDir + sep) || dirname(realRec) !== realDir || !realRec.endsWith('.json') || basename(realRec) === 'index.json') {
  die(`refusing ${relative(repo, recPath)}: only recordings in apps/showcase/public/recordings/*.json can be recorded (fixtures and test data cannot)`);
}
const recText = readFileSync(realRec, 'utf8');
let rec;
try {
  rec = JSON.parse(recText);
} catch (e) {
  die(`${relative(repo, realRec)}: not JSON (${e.message})`);
}
// Mirrors validateRecording in apps/showcase/src/site/recording.ts.
const first = rec?.stampedEvents?.[0]?.event;
if (rec?.schema !== 1 || typeof rec.fn !== 'string' || !rec.fn || !Array.isArray(rec.stampedEvents) || first?.kind !== 'session.started' || first.fn !== rec.fn || typeof rec.source !== 'string' || !rec.toolchain) {
  die(`refusing ${relative(repo, realRec)}: not a schema-1 recording (schema, fn, source, toolchain, stampedEvents starting with session.started)`);
}
if (rec.fixture || /TEST[- ]ONLY|TEST FIXTURE/i.test(recText) || /fixture/i.test(String(rec.notes ?? ''))) {
  die(`refusing ${relative(repo, realRec)}: it is marked as a fixture / TEST-ONLY`);
}
const notes = String(rec.notes ?? '');
const isDev = /^DEV SAMPLE/.test(notes);
if (isDev && !opt.allowDev) {
  die(`refusing ${relative(repo, realRec)}: its notes begin with "DEV SAMPLE" (a development sample, not a curated showcase recording). Pass --allow-dev-sample to record it anyway; outputs are then named faithful-demo-dev-sample.*`);
}
const name = basename(realRec, '.json');
const suffix = isDev ? '-dev-sample' : '';
const events = [...rec.stampedEvents].sort((a, b) => a.seq - b.seq);
const durationMs = events.at(-1).t - events[0].t;
const paced = opt.speed === null;
const speed = opt.speed ?? START_SPEED;
// Paced schedule: capture time (ms after start) at which event k (1-based) is stepped in. Each event gets the recorded
// gap before it divided by 64, clamped to [120 ms, 1,000 ms]; then a fixed hold after decisions. The un-held part is
// scaled so the whole replay lasts about TARGET_S.
const HOLD = { 'candidate.decided': 3200, 'proof.done': 900, 'incumbent.changed': 1200, 'spec.agreed': 900, 'translate.done': 900, 'deliver.done': 0 };
const START_HOLD = 1800; // the "replayed" heading and event 0 stay on screen first
const stepAt = (() => {
  const gaps = events.map((e, i) => (i === 0 ? 0 : Math.min(1000, Math.max(120, (e.t - events[i - 1].t) / 64))));
  const holds = events.map((e) => HOLD[e.event.kind] ?? 0);
  const sum = (a) => a.reduce((x, y) => x + y, 0);
  const budget = TARGET_S * 1000 - TAIL_MS - START_HOLD - sum(holds);
  const k = budget > 0 ? Math.min(3, budget / Math.max(1, sum(gaps))) : 0.3;
  const at = [];
  let t = START_HOLD;
  events.forEach((e, i) => {
    t += gaps[i] * k;
    at.push(Math.round(t));
    t += holds[i];
  });
  return at;
})();
console.log(`recording ${relative(repo, realRec)}: fn ${rec.fn}, ${events.length} events, ${(durationMs / 1000).toFixed(1)} s recorded; ${paced ? `paced replay (stepped event by event, holds on decisions) ≈ ${((stepAt.at(-1) + TAIL_MS) / 1000).toFixed(1)} s` : `replay at ${speed}x ≈ ${(durationMs / speed / 1000).toFixed(1)} s`}${isDev ? ' (DEV SAMPLE)' : ''}`);

// ---- tools
const which = (cmd) => spawnSync('which', [cmd], { encoding: 'utf8' }).stdout.trim();
const FFMPEG = which('ffmpeg');
const FFPROBE = which('ffprobe');
if (!FFMPEG || !FFPROBE) die('ffmpeg and ffprobe are required (not found on PATH). On macOS: brew install ffmpeg');
if (!existsSync(CHROME)) die(`Chrome not found at ${CHROME} (set CHROME=/path/to/chrome)`);

// ---- the built site: present, current, and containing this recording
function newestMtime(p) {
  if (!existsSync(p)) return 0;
  const st = statSync(p);
  if (!st.isDirectory()) return st.mtimeMs;
  let m = 0;
  for (const f of readdirSync(p)) if (f !== 'node_modules' && !/\.test\.[cm]?[jt]sx?$/.test(f)) m = Math.max(m, newestMtime(join(p, f)));
  return m;
}
function staleReason() {
  const idx = join(dist, 'index.html');
  if (!existsSync(idx)) return 'apps/showcase/dist is missing';
  const built = statSync(idx).mtimeMs;
  const distRec = join(dist, 'recordings', `${name}.json`);
  if (!existsSync(distRec) || readFileSync(distRec, 'utf8') !== recText) return `dist/recordings/${name}.json is missing or differs from public/recordings`;
  try {
    const heads = JSON.parse(readFileSync(join(dist, 'recordings/index.json'), 'utf8'));
    if (!heads.some((h) => h.name === name)) return `dist/recordings/index.json does not list ${name}`;
  } catch {
    return 'dist/recordings/index.json is missing or unreadable';
  }
  const inputs = ['apps/showcase/src', 'apps/showcase/public', 'apps/showcase/index.html', 'apps/showcase/vite.config.ts', 'apps/ui/src', 'packages/core/src', 'packages/session/src', 'packages/translate/src', 'packages/engine/src', 'packages/smt/src'];
  for (const p of inputs) {
    if (newestMtime(join(repo, p)) <= built) continue;
    if (!opt.useDist) return `${p} changed after the last build`;
    console.log(`warning: ${p} changed after the last build; recording the existing dist anyway (--use-existing-dist)`);
    break;
  }
  return null;
}
const BUILD_CMD = 'pnpm --filter @faithful/showcase build';
let stale = staleReason();
if (stale) {
  if (!opt.build) die(`the showcase build is not current (${stale}). Run \`${BUILD_CMD}\` from the repo root, or pass --build.`, 2);
  console.log(`building the showcase (${stale}): ${BUILD_CMD}`);
  const b = spawnSync('pnpm', ['--filter', '@faithful/showcase', 'build'], { cwd: repo, stdio: 'inherit' });
  if (b.status !== 0) die('showcase build failed');
  stale = staleReason();
  if (stale) die(`still stale after the build: ${stale}`);
}

// ---- record
const outDir = resolve(repo, opt.outDir);
mkdirSync(outDir, { recursive: true });
const gifPath = join(outDir, `faithful-demo${suffix}.gif`);
const mp4Path = join(outDir, `faithful-demo${suffix}.mp4`);
const frames = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'faithful-media-'));
const frameFile = (i) => join(frames, `f-${String(i).padStart(5, '0')}.png`);

const require = createRequire(join(repo, 'apps/ui/package.json'));
const { chromium } = require('playwright-core');

let server = null;
let browser = null;
let nFrames = 0;
let ended = false;
let failed = false;
const pageErrors = [];
try {
  const port = 8700 + Math.floor(Math.random() * 200);
  server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: dist, stdio: 'ignore' });
  const url = `http://127.0.0.1:${port}/`;
  let up = false;
  for (let i = 0; i < 50 && !up; i++) {
    try {
      up = (await fetch(url)).ok;
    } catch {}
    if (!up) await new Promise((r) => setTimeout(r, 100));
  }
  if (!up) throw new Error(`static server on ${url} did not come up`);

  browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1, colorScheme: 'light' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto(`${url}?r=${encodeURIComponent(name)}&paused`, { waitUntil: 'load' });
  // The COI service worker reloads the page once on the first visit; wait for that before touching the replay.
  await page.waitForFunction(() => window.crossOriginIsolated === true, null, { timeout: 20000 }).catch(() => {});
  await page.waitForSelector('.replay', { timeout: 20000 });
  const barText = () => page.textContent('.replay').then((t) => t ?? '');
  const total = events.length;
  if (!new RegExp(`event 0 of ${total}\\b`).test(await barText())) throw new Error(`replay bar does not show "event 0 of ${total}": ${await barText()}`);
  // Speed: the bar cycles 1,2,4,8,16,64 with `s` (starts at 8).
  for (let i = 0; i < SPEEDS.length && !(await barText()).includes(`${speed}× speed`); i++) {
    await page.keyboard.press('s');
    await page.waitForTimeout(50);
  }
  if (!(await barText()).includes(`${speed}× speed`)) throw new Error(`could not set replay speed ${speed}x: ${await barText()}`);
  // Zoom the document for the capture (more of each stage in frame), then put the replayed session at the top.
  await page.evaluate((z) => { document.documentElement.style.zoom = String(z); }, opt.zoom);
  await page.evaluate(() => document.getElementById('replay-h')?.scrollIntoView({ block: 'start' }));
  await page.mouse.move(0, 0);
  await page.waitForTimeout(300);

  const doneRe = new RegExp(`event ${total} of ${total}\\b`);
  // Keep the active content in frame: the newest candidate card, else the newest proof attempt, else the evidence
  // line (Deliver), else the replay heading. Instant scroll, re-applied before every frame.
  const follow = () =>
    page.evaluate(() => {
      const vis = (el) => el && el.getClientRects().length > 0;
      const last = (sel) => [...document.querySelectorAll(sel)].filter(vis).at(-1);
      const first = (sel) => [...document.querySelectorAll(sel)].filter(vis)[0];
      const el = last('.op-cands > li') ?? last('.pv-attempt') ?? first('.evidence') ?? document.getElementById('replay-h');
      if (!el) return;
      el.scrollIntoView({ block: 'start' });
      if (el.id !== 'replay-h') window.scrollBy(0, el.classList.contains('evidence') ? -110 : -70);
    });
  if (!paced) await page.keyboard.press('p');
  const t0 = Date.now();
  let stepped = 0;
  let endAt = null;
  let lastSlot = -1;
  while (true) {
    if (paced) {
      while (stepped < total && Date.now() - t0 >= stepAt[stepped]) {
        await page.keyboard.press('.');
        stepped++;
      }
    }
    if (Date.now() - t0 > START_HOLD) await follow().catch(() => {});
    const buf = await page.screenshot({ type: 'png' });
    const now = Date.now() - t0;
    const slot = Math.min(Math.round((now * opt.fps) / 1000), Math.round(CAP_S * opt.fps) - 1);
    // Fixed clock: this shot fills every slot up to now (repeats when a screenshot took longer than one frame).
    for (let s = lastSlot + 1; s <= slot; s++) writeFileSync(frameFile(s), buf);
    if (slot > lastSlot) lastSlot = slot;
    if (endAt === null && doneRe.test(await barText())) {
      ended = true;
      endAt = now + TAIL_MS;
    }
    if ((endAt !== null && now >= endAt) || now >= CAP_S * 1000) break;
    const next = ((lastSlot + 1) * 1000) / opt.fps;
    const wait = next - (Date.now() - t0);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  }
  nFrames = lastSlot + 1;
  if (nFrames < 2) throw new Error('captured fewer than 2 frames');
  await browser.close();
  browser = null;
  server.kill();
  server = null;
  console.log(`captured ${nFrames} frames at ${opt.fps} fps (${(nFrames / opt.fps).toFixed(1)} s); replay ${ended ? 'reached its last event' : `did not finish within the ${CAP_S} s cap`}`);
  if (pageErrors.length) console.log(`page errors during capture: ${pageErrors.slice(0, 5).join(' | ')}`);

  // ---- encode
  const ff = (args) => {
    const r = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`ffmpeg failed: ${r.stderr}`);
  };
  const input = ['-framerate', String(opt.fps), '-i', join(frames, 'f-%05d.png')];
  ff(['-threads', '2', ...input, '-vf', 'fps=30', '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4Path]);

  const palette = join(frames, 'palette.png');
  const gifTries = [
    { colors: 256, maxS: null },
    { colors: 128, maxS: null },
    { colors: 64, maxS: null },
    { colors: 64, maxS: 20 },
    { colors: 32, maxS: 15 },
  ];
  let gifOk = false;
  for (const t of gifTries) {
    const trim = t.maxS ? ['-t', String(t.maxS)] : [];
    ff(['-threads', '2', ...input, ...trim, '-vf', `fps=10,scale=960:-2:flags=lanczos,palettegen=max_colors=${t.colors}:stats_mode=diff`, palette]);
    ff(['-threads', '2', ...input, '-i', palette, ...trim, '-lavfi', 'fps=10,scale=960:-2:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle', '-loop', '0', gifPath]);
    const size = statSync(gifPath).size;
    if (size < GIF_MAX) {
      if (t !== gifTries[0]) console.log(`GIF retried to fit under 8 MB: ${t.colors} colors${t.maxS ? `, first ${t.maxS} s only` : ''}`);
      gifOk = true;
      break;
    }
    console.log(`GIF with ${t.colors} colors${t.maxS ? `, ${t.maxS} s` : ''} is ${(size / 1048576).toFixed(2)} MB (>= 8 MB), retrying smaller`);
  }
  if (!gifOk) throw new Error('could not get the GIF under 8 MB');

  // ---- summary
  const probe = (p) => {
    const r = spawnSync(FFPROBE, ['-v', 'error', '-count_frames', '-show_entries', 'format=duration:stream=nb_read_frames,width,height,codec_name,pix_fmt', '-of', 'json', p], { encoding: 'utf8' });
    const j = JSON.parse(r.stdout);
    const s = j.streams?.[0] ?? {};
    return { duration: Number(j.format?.duration), frames: Number(s.nb_read_frames), size: `${s.width}x${s.height}`, codec: s.codec_name, pix_fmt: s.pix_fmt };
  };
  console.log('\nsummary');
  console.log(`  source     ${relative(repo, realRec)} (${name}${isDev ? ', DEV SAMPLE' : ''}), ${paced ? 'paced (stepped event by event)' : `speed ${speed}x`}, zoom ${opt.zoom}, captured ${nFrames} frames at ${opt.fps} fps`);
  for (const p of [mp4Path, gifPath]) {
    const i = probe(p);
    console.log(`  ${relative(repo, p).padEnd(40)} ${String(statSync(p).size).padStart(10)} bytes  ${i.duration.toFixed(2)} s  ${i.frames} frames  ${i.size} ${i.codec}${i.pix_fmt ? ` ${i.pix_fmt}` : ''}`);
  }
} catch (e) {
  failed = true;
  console.error(`make-media: ${e?.stack ?? e}`);
} finally {
  await browser?.close().catch(() => {});
  server?.kill();
  if (opt.keepFrames) console.log(`frames kept in ${frames}`);
  else rmSync(frames, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
