// What a phone starts with: the menu, one button for the sky, the tray, and one small card while the first
// town grows. (There were seven buttons and three cards, one over the other.) Nothing overlaps anything.

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

const PHONES = [
  { width: 390, height: 844 },
  { width: 402, height: 569 }, // X's own browser on an iPhone
  { width: 360, height: 640 },
  { width: 320, height: 568 },
  { width: 844, height: 390 },
];
const open = async (size: { width: number; height: number }): Promise<{ page: Page; errors: string[] }> => {
  const { page, errors } = await app.open('/?seed=7', { ...size, hasTouch: true, isMobile: true, welcome: true });
  await page.waitForSelector('[data-ui="welcome"]', { timeout: 30_000 });
  return { page, errors };
};
const on = (page: Page, ui: string): Promise<boolean> => page.isVisible(`[data-ui="${ui}"]`);

describe('a phone, first visit', () => {
  test.each(PHONES)('$width x $height: few things, none over another, all on the screen', async (size) => {
    const { page, errors } = await open(size);
    for (const ui of ['time', 'season', 'weather', 'undo', 'redo', 'guide-button', 'banner']) expect(await on(page, ui), ui).toBe(false);
    for (const ui of ['menu-button', 'sky', 'fly', 'welcome']) expect(await on(page, ui), ui).toBe(true);
    expect(await page.locator('.lc-stats').isVisible()).toBe(false);
    const boxes = await page.evaluate(() =>
      ['.lc-corner-left', '.lc-corner-right', '[data-ui="welcome"]', '.lc-tabs'].map((q) => {
        const r = document.querySelector(q)!.getBoundingClientRect();
        return { q, l: r.left, t: r.top, r: r.right, b: r.bottom };
      }),
    );
    for (const a of boxes) {
      expect(a.l >= 0 && a.t >= 0 && a.r <= size.width + 0.5 && a.b <= size.height + 0.5, a.q).toBe(true);
      for (const b of boxes) if (a !== b) expect(a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b, `${a.q} over ${b.q}`).toBe(false);
    }
    // The words and buttons fit their card.
    expect(await page.evaluate(`(() => { const c = document.querySelector('[data-ui="welcome"]'); return c.scrollWidth <= c.clientWidth; })()`)).toBe(true);
    expect(errors).toEqual([]);
    await page.context().close();
  });

  test('Skip finishes the town, the card says it is yours, and a press on the town takes it away', async () => {
    const { page, errors } = await open(PHONES[0]!);
    await page.tap('[data-ui="welcome-skip"]');
    await page.waitForFunction('!window.__lc.ui.growth.active', undefined, { timeout: 30_000 });
    expect(await page.textContent('[data-ui="welcome"]')).toContain('Tap to build');
    expect(await on(page, 'undo')).toBe(true);
    await page.touchscreen.tap(195, 420);
    await page.waitForFunction(`!document.querySelector('[data-ui="welcome"]')`);
    expect(errors).toEqual([]);
    await page.context().close();
  });

  test('the sky button opens to the three; the menu has the guide and the stats, off until asked for, and remembered', async () => {
    const { page, errors } = await open(PHONES[1]!);
    await page.tap('[data-ui="welcome-empty"]');
    await page.tap('[data-ui="sky"]');
    for (const ui of ['time', 'season', 'weather']) expect(await on(page, ui), ui).toBe(true);
    expect(await on(page, 'fly')).toBe(false);
    await page.tap('[data-ui="sky"]');
    expect(await on(page, 'time')).toBe(false);
    expect(await on(page, 'fly')).toBe(true);
    await page.tap('[data-ui="menu-button"]');
    expect(await page.textContent('[data-menu="stats"]')).toContain('off');
    await page.locator('[data-menu="stats"]').scrollIntoViewIfNeeded();
    await page.tap('[data-menu="stats"]');
    await page.waitForSelector('.lc-stats', { state: 'visible' });
    await page.locator('[data-menu="guide"]').scrollIntoViewIfNeeded();
    await page.tap('[data-menu="guide"]');
    await page.waitForFunction('window.__lc.ui.guide.isOpen');
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('.lc-stats', { state: 'visible', timeout: 30_000 });
    expect(errors).toEqual([]);
    await page.context().close();
  });
});

test('a desktop is as it was: every button, and the stats', async () => {
  const { page } = await app.open('/?seed=7');
  await page.waitForFunction('window.__lc !== undefined');
  await page.waitForSelector('.lc-stats', { state: 'visible', timeout: 30_000 });
  for (const ui of ['time', 'season', 'weather', 'undo', 'redo', 'guide-button']) expect(await on(page, ui), ui).toBe(true);
  expect(await on(page, 'sky')).toBe(false);
});
