// How sharp the page is drawn (src/render/quality.ts) in a real browser: a phone starts at its full
// pixel ratio with full-resolution ink (it used to be held at 2 with the ink at half resolution), and
// the view can step through every level and back, drawing the town at each, flying too.

import type { Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { startApp, type App } from '../helpers/browser';

let app: App;
beforeAll(async () => {
  app = await startApp();
});
afterAll(async () => {
  await app?.close();
});

type Q = { level: number; levels: { pixelRatio: number; superSample: number; halfInk: boolean; rough?: true }[] };
const quality = (page: Page): Promise<Q> => page.evaluate('window.__lc.quality()') as Promise<Q>;
const frames = (page: Page): Promise<unknown> => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
/** The canvas's size in device pixels. */
const drawn = (page: Page): Promise<{ w: number; h: number }> =>
  page.evaluate(() => {
    const c = (window as unknown as { __lc: { view: { canvas: HTMLCanvasElement } } }).__lc.view.canvas;
    return { w: c.width, h: c.height };
  });

describe('quality levels', () => {
  test('a 3x phone starts sharp: pixel ratio 3, ink at full resolution', async () => {
    const { page, errors } = await app.open('/?seed=7&gen=1', { width: 390, height: 844, scale: 3, hasTouch: true, isMobile: true });
    await page.waitForFunction('window.__lc !== undefined');
    const q = await quality(page);
    expect(q.level).toBe(0);
    expect(q.levels[0]).toEqual({ pixelRatio: 3, superSample: 1, halfInk: false });
    expect(q.levels.filter((l) => !l.rough).at(-1)!.halfInk).toBe(true);
    await frames(page);
    expect(await drawn(page)).toEqual({ w: 1170, h: 2532 });
    expect(errors).toEqual([]);
  });

  test('a big 1x screen starts a step below full super-sampling, and draws at every level (1.5 times too), flying as well', async () => {
    // 2560 x 1440 at 1x drawn at twice the size each way is 14.7 million pixels a frame: more than a
    // frame has time for on a laptop's graphics, and the picture juddered as the camera turned.
    const { page, errors } = await app.open('/?seed=7&gen=1&quality=auto', { width: 2560, height: 1440, scale: 1 });
    await page.waitForFunction('window.__lc !== undefined');
    const q = await quality(page);
    expect(q.levels.map((l) => l.superSample)).toEqual([2, 1.5, 1, 1, 1, 1]);
    expect(q.level).toBe(1);
    const visit = async (): Promise<void> => {
      for (const i of q.levels.keys()) {
        await page.evaluate((i) => (window as unknown as { __lc: { view: { setQuality(n: number): void } } }).__lc.view.setQuality(i), i);
        await frames(page);
        const pr = q.levels[i]!.pixelRatio;
        expect(await drawn(page)).toEqual({ w: Math.floor(2560 * pr), h: Math.floor(1440 * pr) });
      }
    };
    await visit();
    await page.evaluate('window.__lc.ui.fly.testHold(1)');
    await page.keyboard.press('f');
    await page.waitForFunction("window.__lc.ui.fly.phase === 'flying'");
    await visit();
    expect(errors).toEqual([]);
    await page.context().close();
    // A small 1x window starts at the sharpest.
    const small = await app.open('/?seed=7&gen=1&quality=auto', { width: 1280, height: 800, scale: 1 });
    await small.page.waitForFunction('window.__lc !== undefined');
    expect((await quality(small.page)).level).toBe(0);
    await small.page.context().close();
  });

  test('every level draws, the canvas following its pixel ratio, there and back, flying as well', async () => {
    const { page, errors } = await app.open('/?seed=7&gen=1', { width: 900, height: 600, scale: 2 });
    await page.waitForFunction('window.__lc !== undefined');
    const q = await quality(page);
    expect(q.levels.length).toBeGreaterThan(1);
    const visit = async (): Promise<void> => {
      for (const i of [...q.levels.keys(), ...[...q.levels.keys()].reverse()]) {
        await page.evaluate((i) => (window as unknown as { __lc: { view: { setQuality(n: number): void } } }).__lc.view.setQuality(i), i);
        await frames(page);
        expect((await quality(page)).level).toBe(i);
        const size = await drawn(page);
        expect(size.w).toBe(Math.round(900 * q.levels[i]!.pixelRatio));
      }
    };
    await visit();
    await page.evaluate('window.__lc.ui.fly.testHold(1)');
    await page.keyboard.press('f');
    await page.waitForFunction("window.__lc.ui.fly.phase === 'flying'");
    await visit();
    expect(errors).toEqual([]);
  });
});
