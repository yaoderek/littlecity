// The view in a real browser with WebGL: it draws ink on paper inside the
// draw-call budget, the dusk grade and lit windows work, lifting a
// structure and the ghost preview draw and undraw cleanly, and the
// half-resolution ink option gives the same picture with softer lines.

import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { Page } from 'playwright';
import { packRuin } from '@/world/damage';
import { startApp, type App } from '../../tests/helpers/browser';
import type { SweepResult } from './testing/flicker';
import type { FrameSummary } from './testing/probe';

let app: App;
let page: Page;
let errors: string[];

beforeAll(async () => {
  app = await startApp();
  ({ page, errors } = await app.open('/tools/shot/index.html', { width: 700, height: 460 }));
  await page.addScriptTag({ type: 'module', url: `${app.url}/src/render/testing/probe.ts` });
  await page.addScriptTag({ type: 'module', url: `${app.url}/src/render/testing/flicker.ts` });
  await page.waitForFunction('window.__look !== undefined && window.__flicker !== undefined');
});
afterAll(async () => {
  await app?.close();
});

const look = <T>(code: string): Promise<T> => page.evaluate(code) as Promise<T>;
/** A frame of the town at rest: the frame after a change also redraws the grounding map, this one does not. */
const settled = async (): Promise<FrameSummary> => {
  await look(`window.__look.frame()`);
  return look<FrameSummary>(`window.__look.frame()`);
};
/** As settled, once the grounding map has caught up with items shown or hidden (it follows them every fourth frame). */
const shaded = async (): Promise<FrameSummary> => {
  await look(`(() => { for (let i = 0; i < 4; i++) window.__look.frameOnly(); })()`);
  return settled();
};
const lum = (c: readonly number[]): number => 0.299 * c[0]! + 0.587 * c[1]! + 0.114 * c[2]!;
/** Mean absolute difference between two frames' thumbnails, 0–255. */
const differ = (a: FrameSummary, b: FrameSummary): number => a.thumb.reduce((sum, v, i) => sum + Math.abs(v - b.thumb[i]!), 0) / a.thumb.length;
/** Two packed ruins (src/world/damage.ts): a burnt-out shell, and cracked by a blast. */
const BURNT = packRuin({ stage: 3, cause: 'fire' });
const CRACKED = packRuin({ stage: 1, cause: 'blast' });
type Crater = { pending: number; moved: number; stayed: number };
type Placed = { pending: number; built: number; changed: number; touched: number };
/** Draws frames until no rebuild is waiting; returns how many it took. */
const drain = `(() => { let n = 0; while (window.__look.pending() > 0 && n < 1000) { window.__look.frameOnly(); n++; } return n; })()`;

describe('the view', () => {
  test('draws ink on paper, in a dozen draw calls', async () => {
    await look(`window.__look.open('look-island', { ink: 'full' })`);
    const f = await look<FrameSummary>(`window.__look.frame()`);
    expect(f.width).toBe(640);
    // Bare paper in the corners: the palette's cream, give or take the grain.
    for (const c of f.corners) {
      expect(Math.abs(c[0]! - 0xf2)).toBeLessThan(28);
      expect(Math.abs(c[1]! - 0xed)).toBeLessThan(28);
      expect(Math.abs(c[2]! - 0xe3)).toBeLessThan(28);
    }
    // Ink: some of the picture is line, most of it is not.
    expect(f.dark).toBeGreaterThan(0.003);
    expect(f.dark).toBeLessThan(0.2);
    // The sea is blue and the picture is not blank.
    expect(f.mean[2]).toBeGreaterThan(f.mean[0]);
    // The first frame also draws the grounding map (the town from above); after that, a dozen calls.
    expect(f.drawCalls).toBeLessThanOrEqual(28);
    expect(f.triangles).toBeGreaterThan(50_000);
    // The same moment drawn again is the same picture: the pen does not boil.
    const again = await look<FrameSummary>(`window.__look.frame()`);
    expect(again.thumb).toEqual(f.thumb);
    expect(again.drawCalls).toBeLessThanOrEqual(16);
    expect(errors).toEqual([]);
  });

  test('night darkens the page, keeps the line darker still, and lights the windows', async () => {
    await look(`window.__look.open('look-primitives', { ink: 'full', camera: 4 })`);
    const day = await look<FrameSummary>(`window.__look.frame()`);
    await look(`window.__look.time('dusk')`);
    const dusk = await look<FrameSummary>(`window.__look.frame()`);
    await look(`window.__look.time('night')`);
    const night = await look<FrameSummary>(`window.__look.frame()`);
    // On a page this dark, the only bright warm pixels are lit windows and lamps.
    expect(night.warm).toBeGreaterThan(300);
    expect(lum(night.mean)).toBeLessThan(lum(day.mean) * 0.6);
    expect(night.mean[2]).toBeGreaterThan(night.mean[0] * 1.3); // blue-violet
    expect(dusk.mean[0] / dusk.mean[2]).toBeGreaterThan(day.mean[0] / day.mean[2]); // warmer than day
    expect(night.dark).toBeGreaterThan(0.003); // the ink is still there
    expect(errors).toEqual([]);
  });

  test('a lifted structure moves without a rebuild and bakes back exactly', async () => {
    await look(`window.__look.open('look-primitives', { ink: 'full', camera: 5 })`);
    const before = await settled();
    expect(await look<boolean>(`window.__look.lift(2.5)`)).toBe(true);
    const up = await settled();
    expect(differ(up, before)).toBeGreaterThan(0.3);
    expect(up.drawCalls).toBe(before.drawCalls); // no extra mesh: its vertices were re-pointed at a slot
    await look(`window.__look.release()`);
    const after = await settled();
    expect(after.thumb).toEqual(before.thumb);
    // The same town again rebuilds nothing: counted, not timed (under load the old 8 ms budget failed with nothing wrong).
    expect(await look(`window.__look.rebuildWork()`)).toEqual({ structures: 0, vertices: 0 });
  });

  test('props are instances: hiding them changes the picture, showing them restores it', async () => {
    await look(`window.__look.open('look-primitives', { ink: 'full', camera: 4 })`);
    const before = await settled();
    expect(await look<number>(`window.__look.props(false)`)).toBeGreaterThan(3);
    const hidden = await settled();
    expect(differ(hidden, before)).toBeGreaterThan(0.02);
    await look(`window.__look.props(true)`);
    expect((await settled()).thumb).toEqual(before.thumb);
  });

  test('a prop that is never seen costs nothing: its mesh is made when it is first shown, and then it is the same picture', async () => {
    await look(`window.__look.open('look-primitives', { ink: 'full', camera: 4 })`);
    const seen = await settled();
    await look(`window.__look.open('look-primitives', { ink: 'full', camera: 4 })`);
    await look(`window.__look.props(false)`); // hidden before the first frame, as life hides the festival's lights
    const hidden = await shaded();
    expect(hidden.triangles).toBeLessThan(seen.triangles);
    await look(`window.__look.props(true)`);
    const shown = await shaded();
    expect(shown.thumb).toEqual(seen.thumb);
    expect(shown.triangles).toBe(seen.triangles);
  });

  test('the ghost preview is drawn over the page and clears without a trace', async () => {
    await look(`window.__look.open('look-primitives', { ink: 'full', camera: 5 })`);
    const before = await settled();
    await look(`window.__look.ghost(true)`);
    const ghost = await settled();
    expect(ghost.drawCalls).toBeGreaterThan(before.drawCalls);
    expect(ghost.drawCalls).toBeLessThanOrEqual(before.drawCalls + 2);
    expect(differ(ghost, before)).toBeGreaterThan(0.05);
    // The ghost is a pencil sketch: with its lines switched off (zero ink width) it is fainter.
    await look(`window.__look.style('look', 'inkWidth', 0.01)`);
    await look(`window.__look.style('look', 'inkWidthFar', 0.01)`);
    const unlined = await settled();
    await look(`window.__look.ghost(false)`);
    const unlinedBare = await settled();
    await look(`window.__look.style()`);
    await look(`window.__look.ghost(true)`);
    expect(differ(ghost, before)).toBeGreaterThan(differ(unlined, unlinedBare) * 1.1);
    await look(`window.__look.ghost(false)`);
    const after = await settled();
    expect(after.thumb).toEqual(before.thumb);
    expect(after.drawCalls).toBe(before.drawCalls);
    expect(errors).toEqual([]);
  });

  test('half-resolution ink (the phone option) draws the same picture with softer lines', async () => {
    await look(`window.__look.open('look-primitives', { ink: 'full', pixelRatio: 2 })`);
    const full = await settled();
    await look(`window.__look.open('look-primitives', { ink: 'half', pixelRatio: 2 })`);
    const half = await settled();
    expect(half.width).toBe(1280);
    expect(differ(half, full)).toBeLessThan(6);
    expect(half.dark).toBeGreaterThan(full.dark * 0.25);
    expect(half.drawCalls).toBe(full.drawCalls + 1); // the ink mask pass
    expect(errors).toEqual([]);
  });

  test('grounding: pieces sit in a soft shade of their own, at no cost once the town is still', async () => {
    // From the north-west, the shadow side faces the viewer.
    await look(`window.__look.open('look-primitives', { ink: 'full' })`);
    await look(`window.__look.camera({ yaw: 215, pitch: 30, zoom: 7.5, target: [21, 1.5, 24.5] })`);
    const grounded = await settled();
    await look(`window.__look.style('look', 'ground', 0)`);
    const bare = await settled();
    await look(`window.__look.style()`);
    // The shade darkens the picture a little overall and changes it visibly where pieces stand ...
    expect(differ(grounded, bare)).toBeGreaterThan(0.4);
    expect(lum(grounded.mean)).toBeLessThan(lum(bare.mean) - 0.5);
    // ... but gently: this is a pencilled tone, not a black shadow.
    expect(lum(grounded.mean)).toBeGreaterThan(lum(bare.mean) - 12);
    expect(grounded.dark).toBeLessThan(bare.dark * 1.25 + 0.002);
    // It is baked only when something changes: a still town draws the same dozen calls with it or without.
    expect(grounded.drawCalls).toBe(bare.drawCalls);
    // At dusk the light is low and the cast shade reaches further.
    await look(`window.__look.time('dusk')`);
    const dusk = await settled();
    await look(`window.__look.style('look', 'ground', 0)`);
    const duskBare = await settled();
    await look(`window.__look.style()`);
    expect(lum(duskBare.mean) - lum(dusk.mean)).toBeGreaterThan(lum(bare.mean) - lum(grounded.mean));
    expect(errors).toEqual([]);
  });

  test('a changed style value redraws the town (the tuning panel), and life keeps its handles', async () => {
    await look(`window.__look.open('look-primitives', { ink: 'full' })`);
    const before = await settled();
    // A palette colour is baked into the meshes: the view rebuilds them by itself, with no setTown.
    await look(`window.__look.style('palette', 'grass', '#e0503c')`);
    const red = await settled();
    expect(red.mean[0] - red.mean[1]).toBeGreaterThan(before.mean[0] - before.mean[1] + 15);
    // Props kept their slots through the rebuild: the handles life holds still work.
    expect(await look<number>(`window.__look.props(false)`)).toBeGreaterThan(3);
    const hidden = await settled();
    expect(differ(hidden, red)).toBeGreaterThan(0.01);
    await look(`window.__look.props(true)`);
    // Putting the value back gives exactly the first picture.
    await look(`window.__look.style()`);
    expect((await settled()).thumb).toEqual(before.thumb);
    // A value only the page reads (ink width) changes the picture too, with no rebuild at all.
    await look(`window.__look.style('look', 'inkWidth', 3)`);
    await look(`window.__look.style('look', 'inkWidthFar', 3)`);
    const thick = await settled();
    expect(thick.dark).toBeGreaterThan(before.dark * 1.2);
    await look(`window.__look.style()`);
    expect((await settled()).thumb).toEqual(before.thumb);
    expect(errors).toEqual([]);
  });

  test("a spread rebuild lands on the same picture as an immediate one, never in the edit's frame", async () => {
    await look(`window.__look.open('everything', { ink: 'full' })`);
    const before = await settled();
    const pending = await look<number>(`window.__look.ruinHouses(20, ${BURNT}, true)`);
    expect(pending).toBeGreaterThan(0);
    // The edit's frame only draws: the old drawing of what is waiting stays.
    await look(`window.__look.frameOnly()`);
    expect(await look<number>(`window.__look.pending()`)).toBe(pending);
    expect(await look<number>(drain)).toBeGreaterThan(0);
    const spread = await settled();
    expect(spread.thumb).not.toEqual(before.thumb); // the houses are in view
    await look(`window.__look.open('everything', { ink: 'full' })`);
    expect(await look<number>(`window.__look.ruinHouses(20, ${BURNT}, false)`)).toBe(0);
    expect(spread.thumb).toEqual((await settled()).thumb);
    expect(errors).toEqual([]);
  });

  test('two spread changes in a row land on the final picture', async () => {
    await look(`window.__look.open('everything', { ink: 'full' })`);
    expect(await look<number>(`window.__look.ruinHouses(20, ${BURNT}, true)`)).toBeGreaterThan(0);
    await look(`window.__look.ruinHouses(20, ${CRACKED}, true)`);
    await look(drain);
    const spread = await settled();
    await look(`window.__look.open('everything', { ink: 'full' })`);
    await look(`window.__look.ruinHouses(20, ${CRACKED}, false)`);
    expect(spread.thumb).toEqual((await settled()).thumb);
    expect(errors).toEqual([]);
  });

  test('a building the land carries down is redrawn in the edit, never left floating over the crater', async () => {
    await look(`window.__look.open('everything', { ink: 'full' })`);
    // Burnt houses waiting at the front of the queue, so houses carried down after them would wait too.
    expect(await look<number>(`window.__look.ruinHouses(10, ${BURNT}, true)`)).toBeGreaterThan(0);
    const dug = await look<Crater>(`window.__look.crater(10, ${BURNT}, 20, true)`);
    // Only what changed in place is left waiting: everything the land carried down was drawn at once.
    expect(dug.moved).toBeGreaterThanOrEqual(10);
    expect(dug.pending).toBeLessThanOrEqual(dug.stayed);
    expect(errors).toEqual([]);
  });

  test('a crater dressed before its rebuilds land ends on the same picture, props and all', async () => {
    await look(`window.__look.open('everything', { ink: 'full' })`);
    expect((await look<Crater>(`window.__look.crater(19, ${BURNT}, 1, true)`)).pending).toBeGreaterThan(0);
    expect(await look<number>(drain)).toBeGreaterThan(0);
    const spread = await settled();
    await look(`window.__look.open('everything', { ink: 'full' })`);
    expect((await look<Crater>(`window.__look.crater(19, ${BURNT}, 1, false)`)).pending).toBe(0);
    expect(spread.thumb).toEqual((await settled()).thumb);
    expect(errors).toEqual([]);
  });

  test("a drain that moves an anchor moves what stands on it and leaves life's other poses alone", async () => {
    // Burnt houses waiting at the front, so the crater's neighbours whose anchors move are drained later.
    await look(`window.__look.open('everything', { ink: 'full' })`);
    expect(await look<number>(`window.__look.ruinHouses(10, ${BURNT}, true)`)).toBeGreaterThan(0);
    await look(`window.__look.crater(10, ${BURNT}, 20, true)`);
    expect(await look<number>(`window.__look.holdItems()`)).toBeGreaterThan(3);
    expect(await look<number>(drain)).toBeGreaterThan(0);
    // Something stood on an anchor the drain moved: it was put in its new place (and hidden again here).
    expect(await look<number>(`window.__look.movedItems()`)).toBeGreaterThan(0);
    // Nothing else was shown again or put back.
    const held = await shaded();
    await look(`window.__look.props(false)`);
    await look(`window.__look.actors(false)`);
    expect(held.thumb).toEqual((await shaded()).thumb);
    // All shown, it is the town an immediate build gives.
    await look(`window.__look.props(true)`);
    await look(`window.__look.actors(true)`);
    const spread = await shaded();
    await look(`window.__look.open('everything', { ink: 'full' })`);
    await look(`window.__look.crater(10, ${BURNT}, 20, false)`);
    await look(`window.__look.props(true)`);
    await look(`window.__look.actors(true)`);
    expect(spread.thumb).toEqual((await shaded()).thumb);
    expect(errors).toEqual([]);
  });

  test("the player's own edit draws what it changed now and leaves mischief's waiting rebuilds waiting", async () => {
    await look(`window.__look.open('everything', { ink: 'full' })`);
    const waiting = await look<number>(`window.__look.ruinHouses(20, ${BURNT}, true)`);
    expect(waiting).toBeGreaterThan(0);
    const edit = await look<Placed>(`window.__look.place(20, ${BURNT}, 'waiting')`);
    // The block's building is drawn in its frame, and nothing more than the block changed.
    expect(edit.built).toBeGreaterThan(0);
    expect(edit.built).toBeLessThanOrEqual(edit.changed);
    expect(edit.pending).toBeGreaterThanOrEqual(waiting - edit.touched);
    expect(await look<number>(drain)).toBeGreaterThan(0);
    const spread = await settled();
    await look(`window.__look.open('everything', { ink: 'full' })`);
    expect((await look<Placed>(`window.__look.place(20, ${BURNT}, false)`)).pending).toBe(0);
    expect(spread.thumb).toEqual((await settled()).thumb);
    expect(errors).toEqual([]);
  });

  test('two spread changes in one frame spend one budget between them', async () => {
    await look(`window.__look.open('everything', { ink: 'full' })`);
    await look(`window.__look.frameOnly()`); // a fresh frame: the first change has its budget
    expect(await look<number>(`window.__look.ruinHouses(20, ${BURNT}, true)`)).toBeGreaterThan(0);
    // No frame between them (mending inside life.update, then the flush): the second only queues.
    const second = await look<Crater>(`window.__look.crater(20, ${CRACKED}, 0, true)`);
    expect(second.pending).toBe(second.stayed);
    expect(errors).toEqual([]);
  });

  test('an ordinary setTown after a spread one leaves nothing pending', async () => {
    await look(`window.__look.open('everything', { ink: 'full' })`);
    expect(await look<number>(`window.__look.ruinHouses(20, ${BURNT}, true)`)).toBeGreaterThan(0);
    expect(await look<number>(`window.__look.ruinHouses(20, ${BURNT}, false)`)).toBe(0);
    expect(errors).toEqual([]);
  });

  test('hatching belongs to the surface: it does not pop where its spacing halves as the view zooms in', async () => {
    // The stroke spacing halves each time the zoom doubles (here at 64 CSS pixels per unit: zoom 7.68 at
    // this size). Old strokes stay where they are and new ones fade in between, so a hair either side of
    // that zoom the picture is the same, just as it is for a hair's change anywhere else.
    await look(`window.__look.open('look-primitives', { ink: 'full' })`);
    const at = async (zoom: number): Promise<FrameSummary> => {
      await look(`window.__look.camera({ yaw: 215, pitch: 30, zoom: ${zoom}, target: [21, 1.5, 24.5] })`);
      return settled();
    };
    const across = differ(await at(7.675), await at(7.685));
    const elsewhere = differ(await at(7.2), await at(7.21));
    expect(across).toBeLessThan(elsewhere * 1.5 + 0.05);
  });

  test('line weight answers to zoom: up close the lines inside a shape are finer than its outline; far off nothing changes', async () => {
    await look(`window.__look.open('look-primitives', { ink: 'full', pixelRatio: 2 })`);
    const inkAt = async (zoom: number, inner: number | null): Promise<number> => {
      await look(`window.__look.style()`);
      if (inner !== null) await look(`window.__look.style('look', 'inkWidthInner', ${inner})`);
      await look(`window.__look.camera({ yaw: 45, pitch: 30, zoom: ${zoom}, target: [21, 1.5, 24.5] })`);
      return (await settled()).dark;
    };
    // Close (zoom 12: a house fills the view). With the interior as heavy as the outline there is clearly more ink.
    const fine = await inkAt(12, null), heavy = await inkAt(12, 1.5);
    expect(fine).toBeLessThan(heavy * 0.85);
    // The outline is still there: thinning the interior further removes little more.
    expect(await inkAt(12, 0.4)).toBeGreaterThan(fine * 0.6);
    // At the overview the interior width plays no part: the picture is inked exactly as before.
    expect(await inkAt(1.6, 0.4)).toBe(await inkAt(1.6, 1.5));
    await look(`window.__look.style()`);
    expect(errors).toEqual([]);
  });

  test('actors and spawned things move without redrawing the grounding picture; a moved prop redraws it', async () => {
    await look(`window.__look.open('look-primitives', { ink: 'full' })`);
    const rest = (await settled()).drawCalls;
    expect(await look<number>(`window.__look.spawn(60)`)).toBe(60);
    await settled();
    // Sixty things moving every frame: at most one more draw call (their pool) and nothing else, ever.
    // Since the life rules landed the scene already has actors (smoke, birds), so the pool may exist at rest.
    const walking = await look<{ ms: number; drawCalls: number }>(`window.__look.moving('spawned', 30)`);
    expect(walking.drawCalls).toBeGreaterThanOrEqual(rest);
    expect(walking.drawCalls).toBeLessThanOrEqual(rest + 1);
    // A prop stands in the picture (it throws shade), so moving one redraws it: every fourth frame since
    // the life-depth pass (it was every other frame), so the mean rises by a quarter of a scene pass or more.
    const sliding = await look<{ ms: number; drawCalls: number }>(`window.__look.moving('prop', 30)`);
    expect(sliding.drawCalls).toBeGreaterThan(rest + 1.5);
    expect(sliding.drawCalls).toBeLessThanOrEqual(rest + 1 + (rest + 2) / 2 + 1);
    expect(errors).toEqual([]);
  });

  test('flat ground and open sea never ink over, however far out or low the view (phone, half ink)', async () => {
    for (const ink of ['half', 'full']) {
      await look(`window.__look.open('look-isle-1', { ink: '${ink}', pixelRatio: 2, width: 390, height: 844 })`);
      await look(`window.__look.camera({ zoom: 0.01, pitch: 35, yaw: 45, target: [24, 1, 24] })`);
      const far = await look<FrameSummary>(`window.__look.frame()`);
      expect(far.dark, `${ink}, far`).toBeLessThan(0.02);
      await look(`window.__look.camera({ zoom: 0.8, pitch: 10, yaw: 100, target: [24, 1, 40] })`);
      const low = await look<FrameSummary>(`window.__look.frame()`);
      expect(low.dark, `${ink}, low`).toBeLessThan(0.05);
    }
    expect(errors).toEqual([]);
  });

  test('no stray ink along the edge of the frame where the sea runs off-screen', async () => {
    // The depth test reads either side of each pixel. At the frame's edge one side used to be missing,
    // which read as a jump in depth on any sloping surface and drew a row of scribble along the edge.
    // Here the whole frame is open sea: there is nothing to outline, so there must be no ink at all.
    for (const [ink, ratio] of [['full', 1], ['full', 2], ['half', 2]] as const) {
      await look(`window.__look.open('look-primitives', { ink: '${ink}', pixelRatio: ${ratio} })`);
      for (const pose of ['{ pitch: 32, yaw: 45 }', '{ pitch: 25, yaw: 225 }', '{ pitch: 75, yaw: 300 }']) {
        await look(`window.__look.camera({ ...${pose}, zoom: 9, target: [39, 0, 39] })`);
        const f = await look<FrameSummary>(`window.__look.frame(2)`);
        expect(f.border, `${ink} @${ratio}x ${pose}: frame edge`).toBeLessThan(0.002);
        expect(f.dark, `${ink} @${ratio}x ${pose}: whole frame`).toBeLessThan(0.002);
      }
    }
    expect(errors).toEqual([]);
  });

  test('turning the camera round a town does not make the ink flicker, and the pen does not crawl', async () => {
    // A third of a pixel of motion a frame (src/render/testing/flicker.ts), so anything that blinks or
    // pops, or a block of the picture that jumps in tone, is not the motion. Before steady ink (scores
    // per mille at this size: blink / pop / area), coplanar surfaces with different ink ids traded
    // pixels as the view turned and drew a scribble of seams that came and went (close orbit
    // 0.13 / 0.50 / 2.5, close tilt 0.07 / 0.27 / 1.7; now about 0.02 / 0.14 / 0.1 and 0.01 / 0.05 / 0.1).
    await look(`window.__look.open('everything', { ink: 'full' })`);
    const close = `{ yaw: 45, pitch: 28, zoom: 7.5, target: [24.5, 1.8, 31.5] }`;
    const sweep = (pose: string, motion: string): Promise<SweepResult> => look<SweepResult>(`window.__flicker.sweep(${pose}, '${motion}', 32, 640, 400)`);
    for (const [name, r] of [['orbit', await sweep(close, 'yaw')], ['tilt', await sweep(close, 'pitch')]] as const) {
      expect(r.blink, `close ${name}: blinks`).toBeLessThan(0.06);
      expect(r.pop, `close ${name}: pops`).toBeLessThan(0.3);
      expect(r.area, `close ${name}: areas changing tone at once`).toBeLessThan(0.8);
    }
    // At playing zoom (0.027 / 0.17 / 0.32 before; about 0.017 / 0.13 / 0.065 now).
    const playing = await sweep(`{ yaw: 45, pitch: 33, zoom: 3.4, target: [24, 1.5, 32] }`, 'yaw');
    expect(playing.area).toBeLessThan(0.2);
    expect(playing.pop).toBeLessThan(0.25);
    // The pen's wobble belongs to the drawing: orbiting, it adds no change of its own. (Fixed to the
    // screen it made the picture change about a quarter more than with the wobble off.)
    const wobbling = await sweep(close, 'yaw');
    await look(`window.__look.style('look', 'wobble', 0)`);
    const straight = await sweep(close, 'yaw');
    await look(`window.__look.style()`);
    expect(wobbling.change).toBeLessThan(straight.change * 1.08);
    expect(errors).toEqual([]);
  });

  test('orbit, pan and zoom glide: the pose moves toward the goal over a few frames', async () => {
    await look(`window.__look.open('look-primitives', { ink: 'full' })`);
    const still = await look<FrameSummary>(`window.__look.frame(0.1)`);
    await look(`window.__look.orbit(40, 0)`);
    const first = await look<FrameSummary>(`window.__look.frame(1 / 30)`);
    const settled = await look<FrameSummary>(`window.__look.frame(2)`);
    expect(differ(first, still)).toBeGreaterThan(0.2); // it has started to turn
    expect(differ(settled, first)).toBeGreaterThan(0.2); // and had further to go
    const rest = await look<FrameSummary>(`window.__look.frame(0)`);
    expect(differ(rest, settled)).toBeLessThan(0.01);
    await look(`window.__look.close()`);
    expect(errors).toEqual([]);
  });
});
