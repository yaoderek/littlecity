#!/usr/bin/env node
/* global performance, requestAnimationFrame, setTimeout, HTMLCanvasElement */
// node tools/perf.mjs [scenario ...] [--seconds 20] [--size 1280x800] [--scale 2] [--query "weather=rain"]
//                     [--play house|pan|orbit] [--click-ms 700] [--profile] [--worst 4] [--depth 16] [--incl 40] [--passes] [--gl] [--heap] [--url http://...] [--swallow posthog] [--top 25] [--vsync] [--windows 4] [--json out.json] [--cpu 6] [--angle swiftshader] [--phone]
//
// The real game page (index.html, the frame loop in src/app/main.ts) with a scenario open, played for
// some seconds with the display's frame-rate cap taken off, so the numbers show how long a frame
// really takes (`npm run bench` draws a town at rest through the shot page: no crowd, no interface).
//
// Two ways to run it, for two questions:
//   cap off (the default)  how much room a frame has: frames a second at rest, by size and sharpness.
//                          Do NOT read stalls from it: with the cap off the graphics card is always
//                          behind, and every upload (bufferSubData, texSubImage2D) waits for it, so an
//                          edit looks like a 300 ms to 1 s freeze that no player gets.
//   --vsync                what a player gets: missed frames and their causes (--profile --worst 5),
//                          while building (--play house) or on a first visit (fresh --welcome).
//
// A weak device, stood in for on a strong one: --cpu 6 slows the page's JavaScript six times (a cheap phone
// or an old laptop); --angle swiftshader draws with no graphics card at all (far slower than any real
// one, and what a player with hardware acceleration off gets); --phone is a touch screen's page. The
// governor is off under automation: add --query quality=auto to see what it does.
//
// Prints, per scenario: frames a second and the frame gaps (median, 95th, 99th, worst) for each
// window of the run (a town that gets slower as it runs shows as falling windows), how many frames
// ran over 20 ms and 40 ms (a missed refresh, and two, at 60 Hz), what the renderer drew, and the memory it holds at the start and the
// end. --profile adds where the JavaScript time went (Chromium's sampling profiler): by source file
// and by function.

import { chromium } from 'playwright';
import fs from 'node:fs';
import { parseArgs, startServer } from './lib/vite.mjs';

const { flags, positional } = parseArgs(process.argv.slice(2));
const names = positional.length ? positional : ['bench-2000'];
const seconds = Number(flags.seconds ?? 20);
const windows = Number(flags.windows ?? 4);
const [width, height] = String(flags.size ?? '1280x800').split('x').map(Number);
const scale = Number(flags.scale ?? 2);
const top = Number(flags.top ?? 25);

const ARGS = ['--ignore-gpu-blocklist', '--enable-gpu', `--use-angle=${flags.angle ?? 'metal'}`, '--enable-unsafe-swiftshader', '--enable-precise-memory-info'];
if (!flags.vsync) ARGS.push('--disable-frame-rate-limit', '--disable-gpu-vsync');

const sorted = (xs) => [...xs].sort((a, b) => a - b);
const pct = (xs, p) => (xs.length ? sorted(xs)[Math.min(xs.length - 1, Math.floor(xs.length * p))] : NaN);
const f = (x, d = 2) => x.toFixed(d);

const server = flags.url ? { url: String(flags.url), close: async () => {} } : await startServer();
const browser = await chromium.launch({ headless: true, args: ARGS });
const out = [];
try {
  for (const name of names) {
    const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: scale, ...(flags.phone ? { isMobile: true, hasTouch: true } : {}) });
    // --welcome: a first visit (the page name `fresh` with it is what a new player gets: a town growing by itself).
    if (!flags.welcome) await ctx.addInitScript(() => {
      try {
        globalThis.localStorage.setItem('lc:welcomed', '1');
      } catch {
        // no storage here
      }
    });
    // --gl: every upload to the graphics card timed (how many, how many bytes, how long, the slowest).
    if (flags.gl) {
      await ctx.addInitScript(() => {
        const log = (globalThis.__gl = { on: false, calls: [] });
        const P = globalThis.WebGL2RenderingContext?.prototype;
        if (!P) return;
        const bytesOf = (a) => (a && typeof a === 'object' && 'byteLength' in a ? a.byteLength : 0);
        const wrap = (name, size) => {
          const real = P[name];
          P[name] = function (...args) {
            if (!log.on) return real.apply(this, args);
            const t = performance.now();
            const r = real.apply(this, args);
            const took = performance.now() - t;
            log.calls.push([name, size(args, this), took, t]);
            return r;
          };
        };
        // bufferSubData(target, dstByteOffset, srcData, srcOffset, length): length is in elements of srcData.
        wrap('bufferSubData', (a) => [a[4] ? a[4] * (a[2].BYTES_PER_ELEMENT ?? 1) : bytesOf(a[2]), 0, a[1]]);
        wrap('bufferData', (a) => [typeof a[1] === 'number' ? a[1] : bytesOf(a[1]), 0, 0]);
        wrap('texSubImage2D', (a) => [bytesOf(a[8]), 0, 0]);
        wrap('texImage2D', (a) => [bytesOf(a[8]), 0, 0]);
        wrap('linkProgram', () => [0, 0, 0]);
        wrap('getProgramInfoLog', () => [0, 0, 0]);
        wrap('getProgramParameter', () => [0, 0, 0]);
      });
    }
    // --swallow <text>: requests to hosts with this in their name are answered here instead of sent on
    // (POSTs with an empty 200; everything else goes through), and counted. For measuring the page with
    // analytics on (--url of a production build, --query analytics=on, --swallow posthog) without
    // sending anything to it.
    const swallowed = [];
    const fetched = [];
    if (flags.swallow) {
      // What a recorder does to the page: pictures taken of a canvas (createImageBitmap, toDataURL, toBlob), workers started.
      await ctx.addInitScript(() => {
        const log = (globalThis.__snaps = { bitmaps: [], workers: 0, other: 0 });
        const real = globalThis.createImageBitmap;
        globalThis.createImageBitmap = function (...args) {
          const t = performance.now();
          const p = real.apply(this, args);
          const sync = performance.now() - t;
          const src = args[0];
          p.then(() => log.bitmaps.push([t, sync, performance.now() - t, src?.width ?? 0, src?.height ?? 0]), () => {});
          return p;
        };
        const RealWorker = globalThis.Worker;
        globalThis.Worker = class extends RealWorker {
          constructor(...a) {
            super(...a);
            log.workers++;
          }
        };
        for (const name of ['toDataURL', 'toBlob']) {
          const was = HTMLCanvasElement.prototype[name];
          HTMLCanvasElement.prototype[name] = function (...a) {
            log.other++;
            return was.apply(this, a);
          };
        }
      });
      ctx.on('request', (req) => {
        const u = new URL(req.url());
        if (u.hostname.includes(String(flags.swallow)) && req.method() === 'GET') fetched.push(u.pathname.replace(/phc_[A-Za-z0-9]+/, '<key>'));
      });
      await ctx.route((url) => url.hostname.includes(String(flags.swallow)), async (route) => {
        const req = route.request();
        if (req.method() !== 'POST') return route.continue();
        swallowed.push([new URL(req.url()).pathname, req.postDataBuffer()?.length ?? 0, Date.now()]);
        // PostHog asks its server whether to record the session: say yes, so the recorder runs as it does for a real visitor.
        const config = /\/(flags|decide)\b/.test(req.url()) ? { flags: {}, featureFlags: {}, errorsWhileComputingFlags: false, supportedCompression: ['gzip', 'gzip-js'], sessionRecording: { endpoint: '/s/', recorderVersion: 'v2', scriptConfig: { script: 'lazy-recorder' } } } : {};
        await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': req.headers().origin ?? '*', 'access-control-allow-credentials': 'true' }, body: JSON.stringify(config) });
      });
    }
    const page = await ctx.newPage();
    if (flags.cpu) await (await ctx.newCDPSession(page)).send('Emulation.setCPUThrottlingRate', { rate: Number(flags.cpu) });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e?.stack ?? e)));
    const q = [name === 'fresh' ? '' : `scenario=${name}`, flags.query ? String(flags.query) : ''].filter(Boolean).join('&');
    await page.goto(`${server.url}/index.html${q ? `?${q}` : ''}`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__lc !== undefined, null, { timeout: 120_000 });
    // Let the dressing arrive and the shaders compile before anything is counted.
    await page.waitForTimeout(Number(flags.warm ?? 4000));

    const cdp = await ctx.newCDPSession(page);
    // Heap readings are taken after a forced collection: what is still held, not what is waiting to be freed.
    await cdp.send('HeapProfiler.enable');
    const collect = async () => {
      for (let i = 0; i < 3; i++) await cdp.send('HeapProfiler.collectGarbage');
    };
    await collect();
    const before = await page.evaluate(() => ({ blocks: window.__lc.world().blocks.size, heap: performance.memory?.usedJSHeapSize ?? 0, nodes: document.querySelectorAll('*').length, info: window.__lc.view.stats?.() ?? null }));
    if (flags.profile) {
      await cdp.send('Profiler.enable');
      await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
      await cdp.send('Profiler.start');
    }
    // --play <piece>: a player building. The piece picked from the tray, the pointer wandering over
    // the middle of the town (the ghost preview follows it), a click every so often (--click-ms, 0 for
    // none). --play pan: the camera dragged round instead.
    let playing = true;
    const play = (async () => {
      if (!flags.play) return;
      const item = String(flags.play);
      const every = Number(flags['click-ms'] ?? 700);
      const cx = width / 2, cy = height / 2;
      if (item === 'orbit') {
        // The camera turned by a left drag that sweeps side to side for the whole run.
        await page.mouse.move(cx, cy);
        await page.mouse.down();
        const t0 = Date.now();
        while (playing) {
          const t = (Date.now() - t0) / 1000;
          await page.mouse.move(cx + Math.sin(t * 1.1) * width * 0.3, cy + Math.sin(t * 0.7) * height * 0.08);
          await new Promise((r) => setTimeout(r, 4));
        }
        await page.mouse.up();
        return;
      }
      if (item === 'pan') {
        await page.mouse.move(cx, cy);
        await page.mouse.down({ button: 'right' });
      } else await page.click(`[data-item="${item}"]`);
      const t0 = Date.now();
      let lastClick = t0;
      while (playing) {
        const t = (Date.now() - t0) / 1000;
        await page.mouse.move(cx + Math.sin(t * 0.9) * width * 0.22, cy + Math.sin(t * 1.3 + 1) * height * 0.2);
        if (item !== 'pan' && every > 0 && Date.now() - lastClick > every) {
          lastClick = Date.now();
          await page.mouse.down();
          await page.mouse.up();
        }
        await new Promise((r) => setTimeout(r, 16));
      }
      if (item === 'pan') await page.mouse.up({ button: 'right' });
    })();
    // --heap: which code allocated the memory that is still held at the end of the run.
    if (flags.heap) await cdp.send('HeapProfiler.startSampling', { samplingInterval: 32768 });
    if (flags.gl) await page.evaluate(() => void (window.__gl.on = true));
    const run = await page.evaluate(
      (ms) =>
        new Promise((resolve) => {
          const gaps = [];
          const at = [];
          // A named busy loop the profiler will see: lines the profile up with the frame times.
          const mark = performance.now();
          (function __perfMarker() {
            while (performance.now() - mark < 12);
          })();
          const start = performance.now();
          let last = start;
          // The sharpness level, whenever the governor changes it.
          const levels = [];
          const tick = (now) => {
            gaps.push(now - last);
            at.push(now - start);
            last = now;
            const level = window.__lc.quality?.()?.level ?? 0;
            if (!levels.length || levels[levels.length - 1][1] !== level) levels.push([now - start, level]);
            if (now - start < ms) requestAnimationFrame(tick);
            else resolve({ gaps, at, mark, start, levels });
          };
          requestAnimationFrame(tick);
        }),
      seconds * 1000,
    );
    // The split of a frame's drawing between the passes, taken while the play still goes on.
    let passes = null;
    const passesRaw = flags.passes ? await page.evaluate(
        (ms) =>
          new Promise((resolve) => {
            const view = window.__lc.view;
            if (!view.profileLive) return resolve(null);
            view.profileLive(true);
            setTimeout(() => resolve(view.profileLive(false)), ms);
          }),
        Number(flags.passes === true ? 4000 : flags.passes),
      ) : null;
    playing = false;
    await play;
    let profile = null;
    if (flags.profile) profile = (await cdp.send('Profiler.stop')).profile;
    const uncollected = await page.evaluate(() => performance.memory?.usedJSHeapSize ?? 0);
    await collect();
    let held = null;
    if (flags.heap) {
      const { profile: hp } = await cdp.send('HeapProfiler.stopSampling');
      const self = new Map(), incl = new Map();
      const name = (cf) => `${cf.functionName || '(anonymous)'} ${(cf.url || '').replace(/^https?:\/\/[^/]+/, '').replace(/\?.*$/, '').replace(/.*\/node_modules\//, 'node_modules/')}:${cf.lineNumber + 1}`;
      const walk = (n, stack) => {
        const key = name(n.callFrame);
        const mine = !stack.includes(key);
        const next = mine ? [...stack, key] : stack;
        let total = n.selfSize;
        for (const c of n.children ?? []) total += walk(c, next);
        if (n.selfSize) self.set(key, (self.get(key) ?? 0) + n.selfSize);
        if (mine) incl.set(key, (incl.get(key) ?? 0) + total);
        return total;
      };
      const total = walk(hp.head, []);
      const topOf = (m) => [...m].filter(([k]) => !k.startsWith('(root)')).sort((a, b) => b[1] - a[1]).slice(0, Number(flags.top ?? 25));
      held = { total, self: topOf(self), incl: topOf(incl) };
    }
    const after = await page.evaluate(() => ({ blocks: window.__lc.world().blocks.size, heap: performance.memory?.usedJSHeapSize ?? 0, nodes: document.querySelectorAll('*').length, info: window.__lc.view.stats?.() ?? null, quality: window.__lc.quality?.() ?? null }));

    const gaps = run.gaps.slice(1);
    const at = run.at.slice(1);
    console.log(`\n${name}${flags.query ? ` (${flags.query})` : ''}: ${width} × ${height} at ${scale}×, ${seconds} s${flags.vsync ? ', frame rate capped by the display' : ', frame-rate cap off'}`);
    console.log(`  window        frames/s   median    95th      99th      worst     over 20 ms     over 40 ms`);
    const rows = [];
    for (let w = 0; w <= windows; w++) {
      const lo = w === windows ? 0 : (seconds * 1000 * w) / windows;
      const hi = w === windows ? Infinity : (seconds * 1000 * (w + 1)) / windows;
      const g = gaps.filter((_, i) => at[i] > lo && at[i] <= hi);
      if (!g.length) continue;
      const total = g.reduce((a, b) => a + b, 0);
      const row = { window: w === windows ? 'whole run' : `${f(lo / 1000, 0)}-${f(hi / 1000, 0)} s`, fps: (g.length / total) * 1000, median: pct(g, 0.5), p95: pct(g, 0.95), p99: pct(g, 0.99), worst: Math.max(...g), over16: g.filter((x) => x > 20).length, over33: g.filter((x) => x > 40).length, frames: g.length };
      rows.push(row);
      console.log(`  ${row.window.padEnd(13)} ${f(row.fps, 1).padEnd(10)} ${f(row.median).padEnd(9)} ${f(row.p95).padEnd(9)} ${f(row.p99).padEnd(9)} ${f(row.worst).padEnd(9)} ${String(row.over16).padEnd(14)} ${row.over33}`);
    }
    const mb = (b) => `${f(b / 1048576, 1)} MB`;
    console.log(`  JS heap held ${mb(before.heap)} -> ${mb(after.heap)} (${mb(uncollected)} before collecting); page elements ${before.nodes} -> ${after.nodes}; blocks ${before.blocks} -> ${after.blocks}`);
    if (after.info) console.log(`  renderer: ${JSON.stringify(before.info)} -> ${JSON.stringify(after.info)}`);
    if (run.levels.length > 1 || run.levels[0]?.[1] > 0) console.log(`  sharpness level over the run: ${run.levels.map(([t, l]) => `${l} from ${f(t / 1000, 1)} s`).join(', ')}`);
    if (after.quality) console.log(`  quality level ${after.quality.level} of ${after.quality.levels.length}: ${JSON.stringify(after.quality.levels[after.quality.level])}`);
    if (errors.length) console.log(`  page errors: ${errors.slice(0, 3).join(' | ')}`);

    if (flags.swallow) {
      const paths = new Map();
      for (const [path, bytes] of swallowed) {
        const e = paths.get(path) ?? { n: 0, bytes: 0 };
        e.n++; e.bytes += bytes;
        paths.set(path, e);
      }
      console.log(`  requests swallowed (${flags.swallow}): ${[...paths].map(([k, e]) => `${e.n} × ${k} (${f(e.bytes / 1024, 0)} KB)`).join(', ') || 'none'}`);
      console.log(`  fetched from it: ${[...new Set(fetched)].join(', ') || 'nothing'}`);
      const snaps = await page.evaluate(() => globalThis.__snaps);
      const inRun = snaps.bitmaps.filter((b) => b[0] >= run.start);
      console.log(`  pictures taken of a canvas in the run: ${inRun.length} by createImageBitmap${inRun.length ? ` (${inRun[0][3]} × ${inRun[0][4]}; the call itself ${f(pct(inRun.map((b) => b[1]), 0.5))} ms median, ${f(Math.max(...inRun.map((b) => b[1])))} worst; ready after ${f(pct(inRun.map((b) => b[2]), 0.5))} ms median, ${f(Math.max(...inRun.map((b) => b[2])))} worst)` : ''}; ${snaps.other} by toDataURL or toBlob since the page opened; ${snaps.workers} workers started`);
      // The frames in which a picture was taken, against the rest.
      if (inRun.length) {
        const hit = new Set(inRun.map((b) => run.at.findIndex((t) => run.start + t > b[0])));
        const near = (i) => hit.has(i) || hit.has(i - 1) || hit.has(i - 2);
        const withPic = run.gaps.filter((_, i) => i > 0 && near(i)), without = run.gaps.filter((_, i) => i > 0 && !near(i));
        console.log(`    frames at or just after a picture: ${withPic.length}, median ${f(pct(withPic, 0.5))} ms, worst ${f(Math.max(...withPic))}, over 20 ms: ${withPic.filter((g) => g > 20).length}; the other ${without.length} frames: worst ${f(Math.max(...without))}, over 20 ms: ${without.filter((g) => g > 20).length}`);
      }
    }
    if (held) {
      console.log(`  memory allocated in the run and still held at its end: ${mb(held.total)} (sampled)`);
      console.log(`    by the function that allocated it:`);
      for (const [k, v] of held.self) console.log(`      ${mb(v).padStart(10)}  ${k}`);
      console.log(`    by the functions it was allocated under:`);
      for (const [k, v] of held.incl) console.log(`      ${mb(v).padStart(10)}  ${k}`);
    }
    if (flags.gl) {
      const calls = await page.evaluate(() => {
        window.__gl.on = false;
        return window.__gl.calls;
      });
      const kb = (b) => `${f(b / 1024, 0)} KB`;
      console.log(`  uploads to the graphics card over ${gaps.length} frames:`);
      for (const name of [...new Set(calls.map((c) => c[0]))]) {
        const cs = calls.filter((c) => c[0] === name);
        const ms = cs.reduce((a, c) => a + c[2], 0);
        const bytes = cs.reduce((a, c) => a + c[1][0], 0);
        console.log(`    ${name.padEnd(20)} ${String(cs.length).padStart(6)} calls   ${kb(bytes).padStart(10)}   ${f(ms, 1).padStart(8)} ms in all   slowest ${f(Math.max(...cs.map((c) => c[2])), 1)} ms`);
      }
      const slow = calls.filter((c) => c[2] > 8).sort((a, b) => b[2] - a[2]).slice(0, 8);
      if (slow.length) console.log(`    the slowest: ${slow.map((c) => `${c[0]} ${kb(c[1][0])}${c[0] === 'bufferSubData' ? ` at ${kb(c[1][2])}` : ''} took ${f(c[2], 1)} ms`).join('\n                 ')}`);
      // The frames with the most separate buffer writes.
      const perFrame = new Map();
      for (const c of calls) {
        if (c[0] !== 'bufferSubData') continue;
        const k = run.at.findIndex((t) => run.start + t > c[3]);
        const e = perFrame.get(k) ?? { n: 0, bytes: 0, ms: 0 };
        e.n++; e.bytes += c[1][0]; e.ms += c[2];
        perFrame.set(k, e);
      }
      const busy = [...perFrame.values()].sort((a, b) => b.ms - a.ms).slice(0, 5);
      if (busy.length) console.log(`    buffer writes in the five heaviest frames: ${busy.map((e) => `${e.n} writes, ${kb(e.bytes)}, ${f(e.ms, 1)} ms`).join('; ')}`);
    }

    // The split of a frame's drawing between the passes (each waited for, so the frames run slower than real).
    if (flags.passes) {
      passes = passesRaw;
      if (passes) {
        const n = passes['frames#'] || 1;
        console.log(`  drawing, by pass (ms each time it ran; how often; ms a frame), over ${n} frames:`);
        for (const [k, v] of Object.entries(passes)) {
          if (k.endsWith('#')) continue;
          const times = passes[`${k}#`] || 1;
          console.log(`    ${k.padEnd(10)} ${f(v / times).padStart(7)} ms   ${f((times / n) * 100, 0).padStart(3)} % of frames   ${f(v / n).padStart(7)} ms a frame`);
        }
      }
    }

    let byFile = null, byFn = null;
    if (profile) {
      const self = new Map(profile.nodes.map((n) => [n.id, 0]));
      const dts = profile.timeDeltas;
      profile.samples.forEach((id, i) => self.set(id, self.get(id) + (dts[i] ?? 0)));
      const total = [...self.values()].reduce((a, b) => a + b, 0);
      const files = new Map(), fns = new Map();
      for (const n of profile.nodes) {
        const t = self.get(n.id);
        if (!t) continue;
        const cf = n.callFrame;
        let file = cf.url ? cf.url.replace(/^https?:\/\/[^/]+/, '').replace(/\?.*$/, '') : `(${cf.functionName || 'native'})`;
        if (file.includes('/node_modules/')) file = file.replace(/.*\/node_modules\/((?:@[^/]+\/)?[^/]+).*/, 'node_modules/$1');
        files.set(file, (files.get(file) ?? 0) + t);
        const fn = `${cf.functionName || '(anonymous)'}  ${file}:${cf.lineNumber + 1}`;
        fns.set(fn, (fns.get(fn) ?? 0) + t);
      }
      const frames = gaps.length;
      const show = (m) => [...m].sort((a, b) => b[1] - a[1]).slice(0, top).map(([k, v]) => ({ name: k, share: v / total, msPerFrame: v / 1000 / frames }));
      byFile = show(files);
      byFn = show(fns);
      // The worst frames: what ran in each (time including whatever each function called).
      const byId = new Map(profile.nodes.map((n) => [n.id, n]));
      const parent = new Map();
      for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
      const label = (n) => `${n.callFrame.functionName || '(anonymous)'} ${(n.callFrame.url || '').replace(/^https?:\/\/[^/]+/, '').replace(/\?.*$/, '').replace(/.*\/node_modules\//, 'node_modules/')}:${n.callFrame.lineNumber + 1}`;
      const times = [];
      let tAt = profile.startTime;
      for (let i = 0; i < profile.samples.length; i++) {
        tAt += dts[i] ?? 0;
        times.push(tAt);
      }
      const markerNode = profile.nodes.find((n) => n.callFrame.functionName === '__perfMarker');
      const firstMarker = markerNode ? profile.samples.findIndex((id) => id === markerNode.id) : -1;
      if (firstMarker < 0) console.log('  (the profile could not be lined up with the frames: no marker sample)');
      if (firstMarker >= 0) {
        // Profile microseconds at page time run.mark.
        const origin = times[firstMarker] - (dts[firstMarker] ?? 0);
        const toProfile = (pageMs) => origin + (pageMs - run.mark) * 1000;
        const worstN = Number(flags.worst ?? 4);
        const order = run.gaps.map((g, i) => [g, i]).slice(1).sort((a, b) => b[0] - a[0]).slice(0, worstN);
        console.log(`  the ${order.length} worst frames, and what ran in them (ms, including what each called):`);
        for (const [gap, i] of order) {
          const lo = toProfile(run.start + run.at[i - 1]), hi = toProfile(run.start + run.at[i]);
          const incl = new Map();
          for (let k = 0; k < times.length; k++) {
            if (times[k] < lo || times[k] > hi) continue;
            const seen = new Set();
            for (let id = profile.samples[k]; id !== undefined; id = parent.get(id)) {
              const n = byId.get(id);
              const key = label(n);
              if (seen.has(key)) continue;
              seen.add(key);
              incl.set(key, (incl.get(key) ?? 0) + (dts[k] ?? 0));
            }
          }
          console.log(`    ${f(gap, 1)} ms at ${f(run.at[i] / 1000, 2)} s:`);
          for (const [k, v] of [...incl].filter(([k]) => !k.startsWith('(root)')).sort((a, b) => b[1] - a[1]).slice(0, Number(flags.depth ?? 16))) console.log(`      ${f(v / 1000, 1).padStart(7)}  ${k}`);
        }
      }
      // --incl: the whole run by function, counting what each called (the frame loop's parts, top down).
      if (flags.incl) {
        const incl = new Map();
        for (let k = 0; k < profile.samples.length; k++) {
          const seen = new Set();
          for (let id = profile.samples[k]; id !== undefined; id = parent.get(id)) {
            const key = label(byId.get(id));
            if (seen.has(key)) continue;
            seen.add(key);
            incl.set(key, (incl.get(key) ?? 0) + (dts[k] ?? 0));
          }
        }
        console.log(`  the whole run by function, including what each called (ms in all; ms a frame):`);
        for (const [k, v] of [...incl].filter(([k]) => !k.startsWith('(root)') && !k.startsWith('(idle)') && !k.includes('node_modules/')).sort((a, b) => b[1] - a[1]).slice(0, Number(flags.incl === true ? 40 : flags.incl))) console.log(`    ${f(v / 1000, 0).padStart(7)}  ${f(v / 1000 / gaps.length, 2).padStart(6)}  ${k}`);
      }
      console.log(`  where the time went, by file (share of the run; ms a frame):`);
      for (const r of byFile) console.log(`    ${f(r.share * 100, 1).padStart(5)} %  ${f(r.msPerFrame, 3).padStart(7)}  ${r.name}`);
      console.log(`  by function:`);
      for (const r of byFn) console.log(`    ${f(r.share * 100, 1).padStart(5)} %  ${f(r.msPerFrame, 3).padStart(7)}  ${r.name}`);
    }
    out.push({ name, rows, before, after, passes, byFile, byFn });
    await ctx.close();
  }
} finally {
  await browser.close();
  await server.close();
}
if (flags.json) fs.writeFileSync(String(flags.json), JSON.stringify(out, null, 2));
