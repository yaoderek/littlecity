/* global process, console, window */
// Is the packed target's picture the same as the plain one's? Draws the same scenarios both ways in one
// browser and counts the pixels that differ. node tools/wintest/diff.mjs [--out dir] [--glob pattern]
import fs from 'node:fs'; import path from 'node:path'; import zlib from 'node:zlib';
import { chromium, firefox } from 'playwright';
import { parseArgs, startServer } from '../lib/vite.mjs';
const { flags } = parseArgs(process.argv.slice(2));
const out = path.resolve(String(flags.out ?? '.context/diff')); fs.mkdirSync(out, { recursive: true });
const win = process.platform === 'win32';
const which = String(flags.browser ?? 'chrome');
const launch = which === 'firefox' ? () => firefox.launch(win ? { firefoxUserPrefs: { 'webgl.force-enabled': true, 'webgl.angle.force-warp': true } } : {})
  : win ? () => chromium.launch({ channel: 'chrome', args: ['--use-angle=d3d11', '--ignore-gpu-blocklist'] }) : () => chromium.launch({ channel: 'chromium', args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu'] });
const SHOTS = [['hello-town', {}], ['hello-town', { time: 'night' }], ['hello-town', { season: 'winter', weather: 'snow' }], ['hello-town', { season: 'autumn', weather: 'rain' }]];
// A PNG's pixels (8-bit RGB or RGBA, no interlace), enough for Playwright's screenshots.
function pixels(buf) {
  let p = 8, w = 0, h = 0, type = 0; const idat = [];
  while (p < buf.length) { const len = buf.readUInt32BE(p), tag = buf.toString('latin1', p + 4, p + 8), d = buf.subarray(p + 8, p + 8 + len); if (tag === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); type = d[9]; } if (tag === 'IDAT') idat.push(d); p += 12 + len; }
  const n = type === 6 ? 4 : 3, raw = zlib.inflateSync(Buffer.concat(idat)), px = Buffer.alloc(w * h * n), line = w * n;
  for (let y = 0; y < h; y++) { const f = raw[y * (line + 1)], src = y * (line + 1) + 1, dst = y * line;
    for (let x = 0; x < line; x++) { const a = x >= n ? px[dst + x - n] : 0, b = y ? px[dst - line + x] : 0, c = x >= n && y ? px[dst - line + x - n] : 0; let v = raw[src + x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1; else if (f === 4) { const q = a + b - c, pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      px[dst + x] = v & 255; } }
  return { w, h, n, px };
}
const server = await startServer(); let worst = 0;
try {
  const names = flags.glob ? null : SHOTS;
  for (const [i, [name, opts]] of (names ?? [[String(flags.glob), {}]]).entries()) {
    const shot = {};
    for (const draw of ['plain', 'packed', 'plain']) {
      const b = await launch(); const page = await (await b.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 })).newPage(); const errors = [];
      page.on('pageerror', (e) => errors.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
      await page.goto(`${server.url}/tools/shot/index.html?draw=${draw}`); await page.waitForFunction(() => window.__shot !== undefined, null, { timeout: 120_000 });
      const t = Date.now(); await page.evaluate(([n, o]) => window.__shot.show(n, 0, { settle: 2, ...o }), [name, opts]);
      const file = path.join(out, `${i}-${name}-${Object.values(opts).join('-') || 'day'}-${draw}${shot.plain && draw === 'plain' ? '2' : ''}.png`);
      await page.locator('#town').screenshot({ path: file }); const key = shot[draw] ? 'again' : draw; shot[key] = pixels(fs.readFileSync(file));
      if (errors.length) console.log(`  ${draw}: page errors: ${errors.slice(0, 3).join(' | ').slice(0, 300)}`);
      console.log(`  ${draw} drawn in ${Date.now() - t} ms`);
      await b.close();
    }
    const count = (a, c) => { let px = 0, max = 0; for (let k = 0; k < a.px.length; k += a.n) { let d = 0; for (let j = 0; j < 3; j++) d = Math.max(d, Math.abs(a.px[k + j] - c.px[k + j])); if (d) px++; max = Math.max(max, d); } return [px, max]; };
    const [d, m] = count(shot.plain, shot.packed), [d2, m2] = count(shot.plain, shot.again);
    worst = Math.max(worst, d);
    console.log(`${which} ${name} ${JSON.stringify(opts)}: ${shot.plain.w}x${shot.plain.h}, packed differs from plain in ${d} pixels (largest step ${m} of 255); plain differs from plain drawn again in ${d2} (${m2})`);
  }
} finally { await server.close(); }
console.log(worst === 0 ? 'IDENTICAL' : `DIFFERENT (${worst} pixels at most)`);
process.exit(0);
