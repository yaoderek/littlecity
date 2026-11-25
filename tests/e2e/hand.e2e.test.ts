// The Mischief drawer's Hand in a real browser (design section 13b): a press
// on somebody picks them up, a drag carries them, letting go while moving
// throws them, a still release drops them, Escape puts them down; on a phone
// the same with one finger. Whoever is thrown gets back up and carries on.

import type { CDPSession, Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { startApp, type App } from '../helpers/browser';

let app: App;
beforeAll(async () => {
  app = await startApp();
});
afterAll(async () => {
  await app?.close();
});

const PHONE = { width: 390, height: 844, hasTouch: true, isMobile: true, scale: 2 };
const frames = (n: number): string => `new Promise((done) => { let k = ${n}; const f = () => (--k <= 0 ? done(true) : requestAnimationFrame(f)); requestAnimationFrame(f); })`;

async function holdHand(page: Page, tap = false): Promise<void> {
  await page.waitForFunction('window.__lc !== undefined && window.__lcThrown !== undefined');
  const press = (s: string): Promise<void> => (tap ? page.tap(s) : page.click(s));
  if ((await page.getAttribute('[data-drawer="mischief"]', 'aria-selected')) !== 'true') await press('[data-drawer="mischief"]');
  if ((await page.getAttribute('[data-item="hand"]', 'aria-pressed')) !== 'true') await press('[data-item="hand"]');
}

/** Somebody standing about in the town, with the camera brought close to them: their id. */
async function somebody(page: Page): Promise<string> {
  await page.waitForFunction(`(window.__lcPeople?.people ?? []).some((p) => p.visible && p.mode === 'linger' && !p.party)`, null, { timeout: 60_000 });
  const id = (await page.evaluate(`(() => {
    const p = window.__lcPeople.people.find((p) => p.visible && p.mode === 'linger' && !p.party);
    window.__lc.view.setCamera({ target: [p.x, p.y + 0.2, p.z], zoom: 10 });
    return p.id;
  })()`)) as string;
  await page.evaluate(frames(4));
  return id;
}

/** Where a person is on the page now (their middle). */
/**
 * Where a person is on the page now (their middle), with them held still and the camera on them first: a
 * walker read once and pressed later has walked on by then on a loaded machine.
 */
async function screenOf(page: Page, id: string): Promise<[number, number]> {
  await page.evaluate(`(() => {
    const p = window.__lcPeople.people.find((q) => q.id === ${JSON.stringify(id)});
    p.startled = Math.max(p.startled, 60);
    p.startledFace = p.heading;
    window.__lc.view.setCamera({ target: [p.x, p.y + 0.2, p.z] });
  })()`);
  await page.evaluate(frames(3));
  const [x, y] = (await page.evaluate(`(() => {
    const p = window.__lcPeople.people.find((q) => q.id === ${JSON.stringify(id)});
    return window.__lc.view.worldToScreen([p.x, p.y + 0.2, p.z]);
  })()`)) as [number, number];
  const box = (await page.locator('#town').boundingBox())!;
  return [box.x + x, box.y + y];
}

const phaseOf = (id: string): string => `(() => { for (const t of window.__lcThrown.thrower.thrown.values()) if (t.person.id === ${JSON.stringify(id)}) return t.body.phase; return null; })()`;
const backOnFeet = (id: string): string => `(() => { const p = window.__lcPeople.people.find((q) => q.id === ${JSON.stringify(id)}); return !!p && p.mode !== 'thrown' && !p.tumble; })()`;

async function touch(cdp: CDPSession, type: 'touchStart' | 'touchMove' | 'touchEnd', points: { x: number; y: number; id: number }[]): Promise<void> {
  await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y), id: p.id })) });
}

describe('the Hand', () => {
  test('mouse: press picks somebody up, a drag carries them over the roofs, a flick throws them; they get up and carry on', async () => {
    const { page, errors } = await app.open('/?seed=4242&mischief');
    await holdHand(page);
    const id = await somebody(page);
    const [x, y] = await screenOf(page, id);
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.waitForFunction(`${phaseOf(id)} === 'held'`);
    // Up off the ground at once, before the pointer has moved.
    const lifted = (await page.evaluate(`(() => { const p = window.__lcPeople.people.find((q) => q.id === ${JSON.stringify(id)}); return p.y; })()`)) as number;
    expect(lifted).toBeGreaterThan(0.5);
    // A drag, faster at the end: a flick.
    for (let i = 1; i <= 10; i++) {
      await page.mouse.move(x + i * i * 2.5, y + i * 3);
      await page.evaluate(frames(1));
    }
    await page.mouse.up();
    await page.waitForFunction(`${phaseOf(id)} !== 'held'`);
    expect(['fly', 'roll', 'lie', 'swim']).toContain(await page.evaluate(phaseOf(id)));
    // Up again, back on the walking graph, choosing what to do.
    await page.waitForFunction(backOnFeet(id), null, { timeout: 45_000 });
    expect(await page.evaluate(`window.__lcThrown.thrower.thrown.size`)).toBe(0);
    expect(errors).toEqual([]);
    await page.close();
  });

  test('a still release drops them where they hang; Escape puts them down; nothing is saved or undone', async () => {
    const { page, errors } = await app.open('/?seed=4242&mischief');
    await holdHand(page);
    const before = (await page.evaluate('window.__lc.game.canUndo')) as boolean;
    const id = await somebody(page);
    const [x, y] = await screenOf(page, id);
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.waitForFunction(`${phaseOf(id)} === 'held'`);
    await page.mouse.up();
    await page.waitForFunction(`${phaseOf(id)} !== 'held'`);
    const v = (await page.evaluate(`(() => { for (const t of window.__lcThrown.thrower.thrown.values()) if (t.person.id === ${JSON.stringify(id)}) return Math.hypot(t.body.vx, t.body.vz); return 0; })()`)) as number;
    expect(v).toBeLessThan(0.5);
    await page.waitForFunction(backOnFeet(id), null, { timeout: 45_000 });

    // Picked up again, and Escape: put down.
    const [x2, y2] = await screenOf(page, id);
    await page.mouse.move(x2, y2);
    await page.mouse.down();
    await page.waitForFunction(`${phaseOf(id)} === 'held'`);
    await page.keyboard.press('Escape');
    await page.waitForFunction(`${phaseOf(id)} !== 'held'`);
    await page.mouse.up();
    // Nothing for undo: throwing people about changes nothing saved.
    expect(await page.evaluate('window.__lc.game.canUndo')).toBe(before);
    await page.waitForFunction(backOnFeet(id), null, { timeout: 45_000 });
    expect(errors).toEqual([]);
    await page.close();
  });

  test('a drag that starts on nothing turns the view, as with every tool', async () => {
    const { page, errors } = await app.open('/?seed=4242&mischief');
    await holdHand(page);
    const yaw = (await page.evaluate('window.__lc.view.getCamera().yaw')) as number;
    // Out over the sea at the corner of the page: nobody there.
    await page.mouse.move(30, 120);
    await page.mouse.down();
    for (let i = 1; i <= 6; i++) await page.mouse.move(30 + i * 15, 120);
    await page.mouse.up();
    expect(await page.evaluate('window.__lc.view.getCamera().yaw')).not.toBe(yaw);
    expect(await page.evaluate('window.__lcThrown.thrower.thrown.size')).toBe(0);
    expect(errors).toEqual([]);
    await page.close();
  });

  test('phone: a finger on somebody picks them up, a drag carries them, lifting it throws them', async () => {
    const { page, errors } = await app.open('/?seed=4242&mischief', PHONE);
    const cdp = await page.context().newCDPSession(page);
    await holdHand(page, true);
    const id = await somebody(page);
    const [x, y] = await screenOf(page, id);
    await touch(cdp, 'touchStart', [{ x, y, id: 1 }]);
    await page.waitForFunction(`${phaseOf(id)} === 'held'`);
    for (let i = 1; i <= 8; i++) {
      await touch(cdp, 'touchMove', [{ x: x + i * i * 2, y: y - i * 2, id: 1 }]);
      await page.evaluate(frames(1));
    }
    await touch(cdp, 'touchEnd', []);
    await page.waitForFunction(`${phaseOf(id)} !== 'held'`);
    await page.waitForFunction(backOnFeet(id), null, { timeout: 45_000 });
    expect(errors).toEqual([]);
    await page.close();
  });

  test('a building: it lifts a little and wobbles while held, and settles back exactly where it was; nothing saved changes', async () => {
    const { page, errors } = await app.open('/?seed=4242&mischief');
    await holdHand(page);
    const before = (await page.evaluate('JSON.stringify([...window.__lc.world().blocks.entries()])')) as string;
    // The top of a house, close up.
    const at = (await page.evaluate(`(() => {
      const shape = window.__lc.shape();
      for (const [cell, kind] of shape.kinds) {
        if (kind !== 'house') continue;
        const x = cell & 63, z = (cell >> 6) & 63, y = cell >> 12;
        if (shape.kinds.get(cell + 4096) !== undefined) continue;
        window.__lc.view.setCamera({ target: [x + 0.5, y * 0.8 + 0.4, z + 0.5], zoom: 9 });
        return [x + 0.5, y * 0.8 + 0.8, z + 0.5];
      }
      return null;
    })()`)) as [number, number, number];
    await page.evaluate(frames(4));
    const [sx, sy] = (await page.evaluate(`window.__lc.view.worldToScreen(${JSON.stringify(at)})`)) as [number, number];
    const box = (await page.locator('#town').boundingBox())!;
    await page.mouse.move(box.x + sx, box.y + sy);
    await page.mouse.down();
    await page.waitForFunction('window.__lcThrown.thrower.shake !== null');
    await page.evaluate(frames(30));
    await page.mouse.up();
    await page.waitForFunction('window.__lcThrown.thrower.shake === null || window.__lcThrown.thrower.shake.let');
    await page.waitForFunction('window.__lcThrown.thrower.shake === null', null, { timeout: 20_000 });
    expect(await page.evaluate('JSON.stringify([...window.__lc.world().blocks.entries()])')).toBe(before);
    expect(errors).toEqual([]);
    await page.close();
  });
});

describe('the UFO', () => {
  test('a click with the UFO calls one, which comes for somebody', async () => {
    const { page, errors } = await app.open('/?seed=4242&mischief');
    await page.waitForFunction('window.__lc !== undefined && window.__lcUfo !== undefined');
    if ((await page.getAttribute('[data-drawer="mischief"]', 'aria-selected')) !== 'true') await page.click('[data-drawer="mischief"]');
    if ((await page.getAttribute('[data-item="ufo"]', 'aria-pressed')) !== 'true') await page.click('[data-item="ufo"]');
    const box = (await page.locator('#town').boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForFunction('window.__lcUfo.saucers.length === 1');
    await page.waitForFunction("window.__lcUfo.saucers.length === 0 || window.__lcUfo.saucers[0].phase !== 'in'", null, { timeout: 30_000 });
    expect(errors).toEqual([]);
    await page.close();
  });

  test('phone: a tap with the UFO calls one', async () => {
    const { page, errors } = await app.open('/?seed=4242&mischief', PHONE);
    await page.waitForFunction('window.__lc !== undefined && window.__lcUfo !== undefined');
    if ((await page.getAttribute('[data-drawer="mischief"]', 'aria-selected')) !== 'true') await page.tap('[data-drawer="mischief"]');
    await page.locator('[data-item="ufo"]').scrollIntoViewIfNeeded();
    if ((await page.getAttribute('[data-item="ufo"]', 'aria-pressed')) !== 'true') await page.tap('[data-item="ufo"]');
    const box = (await page.locator('#town').boundingBox())!;
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height * 0.4);
    await page.waitForFunction('window.__lcUfo.saucers.length === 1');
    expect(errors).toEqual([]);
    await page.close();
  });
});
