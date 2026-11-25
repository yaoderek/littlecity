// What a visit loads before the game appears. The scenarios (test towns) once came with it: some plan a
// whole town as their file loads, and together they were 3.3 of the 4.1 seconds a slow phone worked
// before its first picture, for players who never see one (found 2026-11-24 from the live numbers).

import { afterAll, beforeAll, expect, test } from 'vitest';
import { startApp, type App } from '../helpers/browser';

let app: App;
beforeAll(async () => {
  app = await startApp();
});
afterAll(async () => {
  await app?.close();
});

/** Every file a visit to this address fetches. (Not the browser's own list: that stops at 250, and the dev server has more.) */
async function fetched(path: string): Promise<string[]> {
  const { page, errors } = await app.open(path);
  const urls: string[] = [];
  page.on('request', (r) => urls.push(r.url()));
  await page.reload();
  await page.waitForFunction('window.__lc !== undefined');
  expect(errors).toEqual([]);
  return urls;
}
const towns = (urls: readonly string[]): string[] => urls.filter((u) => u.includes('/scenarios/core/') || u.includes('/src/scenario/discover'));

test('a visit loads no scenarios; asking for one loads them', async () => {
  const visit = await fetched('/?seed=7');
  expect(visit.some((u) => u.includes('/src/app/main.ts'))).toBe(true);
  expect(towns(visit)).toEqual([]);
  expect(towns(await fetched('/?scenario=bench-600')).length).toBeGreaterThan(0);
});
