/* global process, console, document, window, performance, requestAnimationFrame, WebGL2RenderingContext, setTimeout */
// Where does the wait on Windows come from? Opens two local builds (as live, and with fix.patch) in fresh browsers,
// times every WebGL call the page waits in, then compiles each of the game's programs alone in a fresh browser.
// Nothing is sent anywhere: the builds carry no analytics key and posthog.com is blocked.
import fs from 'node:fs'; import http from 'node:http'; import path from 'node:path';
import { chromium, firefox } from 'playwright';
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const runs = Number(args.runs ?? 2);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png', '.woff2': 'font/woff2' };
const serve = (dir) => new Promise((ok) => { const s = http.createServer((q, r) => { let f = path.join(dir, decodeURIComponent(q.url.split('?')[0])); if (!fs.existsSync(f) && !f.endsWith(path.sep)) console.log('404', q.url); if (f.endsWith('/') || f.endsWith(path.sep)) f = path.join(f, 'index.html'); fs.readFile(f, (e, b) => { if (e) { r.writeHead(404); r.end(); } else { r.writeHead(200, { 'content-type': TYPES[path.extname(f)] ?? 'application/octet-stream' }); r.end(b); } }); }).listen(0, () => ok(`http://localhost:${s.address().port}/`)); });
const ff = { 'webgl.force-enabled': true, 'webgl.angle.force-warp': true, 'webgl.disabled': false };
const win = process.platform === 'win32';
const KINDS = win ? {
  'chrome-d3d11': () => chromium.launch({ channel: 'chrome', args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu'] }),
  'chrome-warp': () => chromium.launch({ channel: 'chrome', args: ['--use-angle=d3d11-warp', '--ignore-gpu-blocklist'] }),
  'chrome-swiftshader': () => chromium.launch({ channel: 'chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] }),
  'edge-d3d11': () => chromium.launch({ channel: 'msedge', args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu'] }),
  'firefox': () => firefox.launch({ firefoxUserPrefs: ff }),
} : { 'chrome-metal': () => chromium.launch({ channel: 'chromium' }), 'firefox': () => firefox.launch() };
const only = args.only?.split(',');

function spy() {
  const W = (window.__w = { calls: {}, slow: [], gaps: [], programs: [], first: null, frames: 0 });
  const P = WebGL2RenderingContext.prototype;
  const src = new WeakMap(), parts = new WeakMap(), ids = new WeakMap();
  for (const k of Object.getOwnPropertyNames(P)) {
    const d = Object.getOwnPropertyDescriptor(P, k); if (typeof d.value !== 'function') continue;
    const f = d.value;
    P[k] = function (...a) {
      const t = performance.now(); const r = f.apply(this, a); const ms = performance.now() - t;
      if (k === 'shaderSource') src.set(a[0], a[1]);
      if (k === 'attachShader') (parts.get(a[0]) ?? parts.set(a[0], []).get(a[0])).push(src.get(a[1]));
      if (k === 'linkProgram') { ids.set(a[0], W.programs.length); W.programs.push({ at: t, src: [...parts.get(a[0])] }); }
      if (k.startsWith('draw') && W.first === null) W.first = t;
      const c = (W.calls[k] ??= { n: 0, ms: 0 }); c.n++; c.ms += ms;
      if (ms > 40) W.slow.push([Math.round(t), k, Math.round(ms), a[0] && ids.has(a[0]) ? ids.get(a[0]) : null]);
      return r;
    };
  }
  // Is the page itself stuck (timers stop too), or only its picture (frames stop, timers go on)?
  W.timerGaps = []; W.long = []; let tl = performance.now();
  setInterval(() => { const n = performance.now(); if (n - tl > 250) W.timerGaps.push([Math.round(tl), Math.round(n - tl)]); tl = n; }, 20);
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.duration > 200) W.long.push([Math.round(e.startTime), Math.round(e.duration)]); }).observe({ entryTypes: ['longtask'] }); } catch { /* not in this browser */ }
  let last = performance.now();
  const tick = () => { const n = performance.now(); if (n - last > 250) W.gaps.push([Math.round(last), Math.round(n - last)]); last = n; W.frames++; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
}
const label = (s) => `fs ${s[1]?.length ?? 0} ` + ((/#define SHADER_NAME (\S+)/.exec(s[1] ?? '') ?? [])[1] ?? '') + ' ' + [...new Set([...(s[1] ?? '').matchAll(/^#define ([A-Z][A-Z_0-9]+)\b/gm)].map((m) => m[1]))].filter((x) => !/^(SHADER_|varying|texture|gl_|USE_|NUM_|saturate)/.test(x)).slice(0, 8).join(',');

async function visit(kind, url, programs, name) {
  const b = await KINDS[kind]();
  try {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 720 } });
    await ctx.route(/posthog\.com/, (r) => r.abort());
    const p = await ctx.newPage(); await p.addInitScript(spy);
    const errs = []; p.on('console', (m) => { if (m.type() === 'error' || /X\d{4}|Context|parallel/.test(m.text())) errs.push(m.text().slice(0, 160)); }); p.on('pageerror', (e) => errs.push('PAGE ' + e.message.slice(0, 160))); p.on('response', (r) => { if (r.status() >= 400) errs.push(`HTTP ${r.status()} ${r.url()}`); }); p.on('requestfailed', (r) => errs.push(`FAILED ${r.url()} ${r.failure()?.errorText}`));
    const t0 = Date.now(); await p.goto(`${base}?analytics=off&${url}`, { waitUntil: 'commit' });
    const card = await p.waitForSelector('.lc-welcome', { timeout: 90000 }).then(() => Date.now() - t0, () => null);
    const shown = await p.waitForFunction(() => { const l = document.querySelector('.lc-loading'); return !l || l.dataset.state === 'done'; }, null, { timeout: 150000 }).then(() => Date.now() - t0, () => null);
    await p.waitForTimeout(4000);
    const loaded = await p.evaluate(() => JSON.parse(JSON.stringify({ calls: window.__w.calls, timerGaps: window.__w.timerGaps, long: window.__w.long, gaps: window.__w.gaps, slow: window.__w.slow, first: window.__w.first, n: window.__w.programs.length, frames: window.__w.frames })));
    // the first moments of play: an empty island, a few pieces, then flying
    const click = async (l) => { const t = Date.now(); try { await l.click({ timeout: 30000 }); } catch { return null; } await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))); return Date.now() - t; };
    const acts = { empty: await click(p.getByText(/Empty island instead|Start empty/).first()) };
    await p.waitForTimeout(2500);
    let t = Date.now(); await p.mouse.move(640, 380); await p.mouse.click(640, 380); await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))); acts.piece = Date.now() - t;
    await p.waitForTimeout(2500); t = Date.now(); await p.keyboard.press('f'); await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))); acts.fly = Date.now() - t;
    await p.waitForTimeout(6000);
    const end = await p.evaluate(() => { const g = document.createElement('canvas').getContext('webgl2'); const d = g?.getExtension('WEBGL_debug_renderer_info'); return { gpu: g && String(g.getParameter(d ? d.UNMASKED_RENDERER_WEBGL : g.RENDERER)), par: !!g?.getExtension('KHR_parallel_shader_compile'), slow: window.__w.slow, gaps: window.__w.gaps, frames: window.__w.frames, programs: window.__w.programs }; });
    if (programs && !programs.length) programs.push(...end.programs.map((x) => x.src));
    if (args.shots) await p.screenshot({ path: path.join(args.out ?? '.', `${kind}-${name.replace(' ', '-')}.png`) }).catch(() => 0);
    return { card, shown, loaded, acts, gpu: end.gpu, par: end.par, slow: end.slow.map((s) => [...s, s[3] !== null ? label(end.programs[s[3]].src) : '']), gaps: end.gaps, frames: end.frames, programsAt: end.programs.map((x) => Math.round(x.at)), errs: [...new Set(errs)].slice(0, 6) };
  } finally { await b.close(); }
}
async function alone(kind, programs, url) {
  const b = await KINDS[kind]();
  try {
    const p = await b.newPage(); await p.goto(url + 'robots.txt').catch(() => p.goto('about:blank'));
    return await p.evaluate((list) => { const g = document.createElement('canvas').getContext('webgl2'); if (!g) return null; const out = [];
      for (const n of g.getSupportedExtensions()) g.getExtension(n);
      for (const [vs, fs] of list) { const t = performance.now(); const pr = g.createProgram(); for (const [ty, s] of [[g.VERTEX_SHADER, vs], [g.FRAGMENT_SHADER, fs]]) { const sh = g.createShader(ty); g.shaderSource(sh, s); g.compileShader(sh); g.attachShader(pr, sh); } g.linkProgram(pr); const ok = g.getProgramParameter(pr, g.LINK_STATUS); out.push([Math.round(performance.now() - t), ok, ok ? '' : String(g.getProgramInfoLog(pr)).slice(0, 120)]); }
      return out; }, programs);
  } finally { await b.close(); }
}

const base = await serve(args.build);
// The same build both ways: as the game draws now (?draw=plain), and as this change draws on Windows.
const builds = { 'as now': 'draw=plain', new: process.platform === 'win32' ? '' : 'draw=packed' };
const programs = []; const all = { visits: [], alone: {} };
for (let r = 0; r < runs; r++) for (const kind of Object.keys(KINDS)) if (!only || only.includes(kind)) for (const n of r % 2 ? Object.keys(builds).reverse() : Object.keys(builds)) {
  try {
    const v = await visit(kind, builds[n], null, n); all.visits.push({ kind, build: n, run: r, ...v });
    const c = Object.entries(v.loaded.calls).sort((a, z) => z[1].ms - a[1].ms).slice(0, 4).map(([k, x]) => `${k} ${Math.round(x.ms)}ms/${x.n}`).join(', ');
    console.log(`\n${kind} | ${n} | run ${r} | ${v.gpu} | parallel ${v.par}\n  welcome card ${v.card} ms, town on screen ${v.shown} ms, first draw ${Math.round(v.loaded.first)} ms, ${v.loaded.n} programs while loading, frames ${v.loaded.frames}\n  waiting in: ${c}\n  longest frozen: ${JSON.stringify([...v.loaded.gaps].sort((a, z) => z[1] - a[1]).slice(0, 5))} (start, ms)\n  page itself stuck (timers): ${JSON.stringify([...v.loaded.timerGaps].sort((a, z) => z[1] - a[1]).slice(0, 5))}; long tasks: ${JSON.stringify([...v.loaded.long].sort((a, z) => z[1] - a[1]).slice(0, 6))}\n  acts ${JSON.stringify(v.acts)}\n  slow calls: ${v.slow.sort((a, z) => z[2] - a[2]).slice(0, 8).map((s) => `@${s[0]} ${s[1]} ${s[2]}ms ${s[4]}`).join(' | ')}\n  ${v.errs.join(' || ')}`);
  } catch (e) { console.log(`\n${kind} | ${n} | run ${r} | FAILED ${String(e.message).slice(0, 300)}`); }
}
fs.writeFileSync(path.join(args.out ?? '.', 'result.json'), JSON.stringify(all));
process.exit(0);
