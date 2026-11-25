// The first visit: on an empty island a town grows by itself a moment after the island appears, with a
// closable note beside the menu button that offers the empty island back. Once per browser, never over a town.
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { Page } from 'playwright';
import { startApp, type App } from '../helpers/browser';

let app: App;
beforeAll(async () => {
  app = await startApp();
});
afterAll(async () => {
  await app.close();
});

const blocks = `window.__lc.world().blocks.size`;

const growing = `window.__lc.ui.growth.active`;
const trees = (page: Page): Promise<number> => page.evaluate(blocks) as Promise<number>;

describe('the first visit', () => {
  test('a town grows by itself; the note sits beside the menu, clear of the town; it does not happen twice', async () => {
    const { page, errors } = await app.open('/?seed=7', { welcome: true });
    await page.waitForFunction('window.__lc !== undefined');
    const before = await trees(page);
    // The island is seen first, then the town begins.
    await page.waitForFunction(growing, undefined, { timeout: 30_000 });
    await page.waitForSelector('[data-ui="welcome"]');
    expect(await page.textContent('[data-ui="welcome"]')).toContain('Here is a town to start you off');
    const box = (await page.locator('[data-ui="welcome"]').boundingBox())!;
    // In the top-left corner, not over the middle of the town.
    expect(box.x + box.width).toBeLessThan(1280 * 0.35);
    expect(box.y + box.height).toBeLessThan(800 * 0.3);
    await page.waitForFunction(`${blocks} > ${before + 20}`, undefined, { timeout: 60_000 });
    await page.screenshot({ path: '.context/shots/welcome-desktop.png' });
    // The banner names the town, with Finish now, as any grown town.
    expect(await page.textContent('[data-ui="banner"]')).toContain('is growing.');
    await page.keyboard.press('Space');
    await page.waitForFunction(`!${growing}`);
    const grown = await trees(page);
    expect(grown).toBeGreaterThan(100);
    // A press on the town once it has grown: the note has been read.
    await page.mouse.click(640, 120);
    await page.waitForFunction(`!document.querySelector('[data-ui="welcome"]')`);
    // Again in the same browser: the saved town opens, nothing grows, no note.
    await page.waitForFunction(`localStorage.getItem('little-city.town.v1') !== null`, undefined, { timeout: 30_000 });
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction('window.__lc !== undefined');
    expect(await page.evaluate(growing)).toBe(false);
    expect(await page.locator('[data-ui="welcome"]').count()).toBe(0);
    expect(errors).toEqual([]);
    await page.context().close();
  });

  test('"Empty island instead" takes the town away again, and nothing grows on the next visit', async () => {
    const { page, errors } = await app.open('/?seed=7', { welcome: true });
    await page.waitForFunction('window.__lc !== undefined');
    const before = await trees(page);
    await page.waitForSelector('[data-ui="welcome"]', { timeout: 30_000 });
    await page.click('[data-ui="welcome-empty"]');
    await page.waitForFunction(`!${growing} && ${blocks} === ${before}`);
    expect(await page.locator('[data-ui="welcome"]').count()).toBe(0);
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction('window.__lc !== undefined');
    await page.evaluate('new Promise((done) => setTimeout(done, 1500))');
    expect(await page.evaluate(growing)).toBe(false);
    expect(await page.locator('[data-ui="welcome"]').count()).toBe(0);
    expect(errors).toEqual([]);
    await page.context().close();
  });

  test('a player who starts building at once is left alone: no town grows over their block', async () => {
    const { page, errors } = await app.open('/?seed=7', { welcome: true });
    await page.waitForFunction('window.__lc !== undefined');
    const before = await trees(page);
    await page.mouse.click(640, 400);
    await page.waitForFunction(`${blocks} > ${before}`);
    const mine = await trees(page);
    await page.evaluate('new Promise((done) => setTimeout(done, 1800))');
    expect(await page.evaluate(growing)).toBe(false);
    expect(await trees(page)).toBe(mine);
    expect(await page.locator('[data-ui="welcome"]').count()).toBe(0);
    expect(errors).toEqual([]);
    await page.context().close();
  });

  test('on a phone the note is one small card over the tray, with 44 px targets', async () => {
    const { page, errors } = await app.open('/?seed=7', { welcome: true, width: 390, height: 844, hasTouch: true });
    await page.waitForSelector('[data-ui="welcome"]', { timeout: 30_000 });
    await page.screenshot({ path: '.context/shots/welcome-phone.png' });
    const box = (await page.locator('[data-ui="welcome"]').boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    const tabs = (await page.locator('.lc-tabs').boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(tabs.y);
    expect(box.y).toBeGreaterThan(844 * 0.6);
    for (const sel of ['[data-ui="welcome-skip"]', '[data-ui="welcome-empty"]', '[data-ui="sky"]']) {
      const b = await page.locator(sel).evaluate((n) => [(n as HTMLElement).offsetWidth, (n as HTMLElement).offsetHeight]);
      expect(Math.min(...b), sel).toBeGreaterThanOrEqual(44);
    }
    expect(errors).toEqual([]);
    await page.context().close();
  });
});
