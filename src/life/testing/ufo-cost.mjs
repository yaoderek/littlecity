#!/usr/bin/env node
/* global console, window, performance, process */
// Frame cost of the UFO (design section 13b): the app's whole frame in a grown
// town, before it is called and while it hovers with its beam on and lifts
// somebody. Short on purpose (a headless browser here shares the graphics card).
//
//   node src/life/testing/ufo-cost.mjs [scenario] [--runs 2]

import { launchBrowser, openPage } from '../../../tools/lib/browser.mjs';
import { parseArgs, startServer } from '../../../tools/lib/vite.mjs';

const { flags, positional } = parseArgs(process.argv.slice(2));
const scenario = positional[0] ?? 'grown-town-1';
const runs = Number(flags.runs ?? 2);
const FRAME = 1000 / 60;
const q = (out, k) => [...out].sort((a, b) => a - b)[Math.floor((out.length - 1) * k)];
const server = await startServer();
const browser = await launchBrowser();
try {
  for (let run = 0; run < runs; run++) {
    const { page } = await openPage(browser, `${server.url}/?scenario=${encodeURIComponent(scenario)}`, { width: 1280, height: 800 });
    await page.waitForFunction(() => window.__lc !== undefined && window.__lcUfo !== undefined, null, { timeout: 60_000 });
    await page.clock.install({ time: 0 });
    await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 500);
    await page.evaluate(() => window.__lc.signals.hold('day'));
    await page.clock.runFor(15000);
    const time = async (n) => {
      const t = [];
      for (let i = 0; i < n; i++) {
        const t0 = performance.now();
        await page.clock.runFor(FRAME);
        t.push(performance.now() - t0);
      }
      return t;
    };
    const before = await time(150);
    await page.evaluate(() => window.__lcUfo.call(30.5, 0.8, 22.5));
    await page.clock.runFor(2700);
    const phase = await page.evaluate(() => window.__lcUfo.saucers[0]?.phase);
    const during = await time(150);
    console.log(`run ${run + 1}: before median ${q(before, 0.5).toFixed(1)} ms, p95 ${q(before, 0.95).toFixed(1)}; hovering (${phase}) median ${q(during, 0.5).toFixed(1)} ms, p95 ${q(during, 0.95).toFixed(1)}`);
    await page.close();
  }
} finally {
  await browser.close();
  await server.close();
}
