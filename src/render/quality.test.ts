// The quality levels and the governor that steps through them (src/render/quality.ts).

import { describe, expect, test } from 'vitest';
import { createGovernor, deviceLevel, GOVERNOR, qualityLevels, startLevel } from './quality';

describe('levels', () => {
  test('sharpest first: super-sampling goes first, then the pixel ratio toward 2, the half-resolution ink last', () => {
    expect(qualityLevels(3)).toEqual([
      { pixelRatio: 3, superSample: 1, halfInk: false },
      { pixelRatio: 2.5, superSample: 1, halfInk: false },
      { pixelRatio: 2, superSample: 1, halfInk: false },
      { pixelRatio: 2, superSample: 1, halfInk: true },
      { pixelRatio: 1.5, superSample: 1, halfInk: true },
      { pixelRatio: 1, superSample: 1, halfInk: false, rough: true },
      { pixelRatio: 0.7, superSample: 1, halfInk: false, rough: true },
    ]);
    expect(qualityLevels(2).map((q) => [q.pixelRatio, q.halfInk])).toEqual([[2, false], [2, true], [1.5, true], [1, false], [0.7, false]]);
    expect(qualityLevels(2.625).map((q) => q.pixelRatio)).toEqual([2.625, 2, 2, 1.5, 1, 0.7]);
    expect(qualityLevels(1)).toEqual([
      { pixelRatio: 1, superSample: 2, halfInk: false },
      { pixelRatio: 1, superSample: 1.5, halfInk: false },
      { pixelRatio: 1, superSample: 1, halfInk: false },
      { pixelRatio: 1, superSample: 1, halfInk: true },
      { pixelRatio: 0.75, superSample: 1, halfInk: false, rough: true },
      { pixelRatio: 0.5, superSample: 1, halfInk: false, rough: true },
    ]);
    // A 4x screen is drawn at 3 at most.
    expect(qualityLevels(4)[0]!.pixelRatio).toBe(3);
  });
});

describe('where a view starts', () => {
  test('a big 1x screen starts a step below full super-sampling: four times its pixels is more than a frame has time for', () => {
    // 2560 x 1440 drawn at twice the size each way is 14.7 million pixels a frame.
    expect(startLevel(qualityLevels(1), 2560, 1440)).toBe(1);
    expect(startLevel(qualityLevels(1), 2560, 1300)).toBe(1);
    // A laptop's 1x window is small enough to start at the sharpest.
    expect(startLevel(qualityLevels(1), 1440, 800)).toBe(0);
    expect(startLevel(qualityLevels(1), 1920, 1080)).toBe(0);
  });

  test('a screen with no super-sampling starts at its sharpest, as before (the governor finds out)', () => {
    expect(startLevel(qualityLevels(2), 2560, 1440)).toBe(0);
    expect(startLevel(qualityLevels(3), 390, 844)).toBe(0);
    expect(startLevel([{ pixelRatio: 1, superSample: 2, halfInk: false }], 2560, 1440)).toBe(0);
  });
});

/** Runs the governor for `seconds` on a device whose frame takes `costOf(level)` ms; returns the changes. */
function run(costOf: (level: number) => number, seconds: number, opts: { levels?: number; moving?: (t: number) => boolean } = {}) {
  const g = createGovernor(opts.levels ?? 5);
  const changes: { at: number; to: number }[] = [];
  let t = 0;
  while (t < seconds * 1000) {
    // A frame takes its cost, rounded up to the 60 Hz refresh, give or take a little.
    const cost = costOf(g.level);
    const gap = Math.ceil(cost / 16.67 - 0.02) * 16.67 + ((t * 7) % 3) * 0.1;
    t += gap;
    const to = g.frame(gap, opts.moving ? opts.moving(t) : true);
    if (to !== null) changes.push({ at: t, to });
  }
  return { changes, level: g.level };
}

describe('the governor', () => {
  test('a fast device stays at the sharpest level', () => {
    expect(run(() => 9, 120).changes).toEqual([]);
  });

  test('a slow device steps down a level at a time until frames keep up, and stays there', () => {
    // Levels 0 and 1 too slow (a frame every 33 ms), level 2 keeps up.
    const r = run((l) => (l < 2 ? 30 : 12), 300);
    expect(r.level).toBe(2);
    expect(r.changes.map((c) => c.to).slice(0, 2)).toEqual([1, 2]);
    // It tries level 1 again now and then, but not often: the waits double.
    const ups = r.changes.filter((c, i) => i >= 2 && c.to === 1);
    expect(ups.length).toBeLessThanOrEqual(4);
    for (let i = 1; i < ups.length; i++) expect(ups[i]!.at - ups[i - 1]!.at).toBeGreaterThan(GOVERNOR.backoff * 2 ** (i - 1));
  });

  test('a device that slows down later (a hot phone) steps down then; once fast again it comes back up', () => {
    let hot = true;
    const g = createGovernor(5);
    const seen: number[] = [];
    let t = 0;
    while (t < 200_000) {
      if (t > 60_000) hot = false;
      const gap = hot && g.level === 0 ? 33.3 : 16.7;
      t += gap;
      const to = g.frame(gap, true);
      if (to !== null) seen.push(to);
    }
    expect(seen[0]).toBe(1);
    expect(g.level).toBe(0);
  });

  test('a change waits for the picture to move (where it does not show), at most a few seconds', () => {
    // Still for the first 20 s, then moving.
    const still = run((l) => (l === 0 ? 30 : 10), 20, { moving: (t) => t > 20_000 });
    expect(still.changes[0]!.to).toBe(1);
    const at = still.changes[0]!.at;
    const moving = run((l) => (l === 0 ? 30 : 10), 20, { moving: () => true });
    expect(moving.changes[0]!.at).toBeLessThan(at);
    expect(at - moving.changes[0]!.at).toBeLessThanOrEqual(GOVERNOR.waitForMotion + 100);
  });

  test('a frame missed now and then is slow: one in three taking two refreshes is judder, though the median frame is on time', () => {
    // Level 0 a little over what a refresh allows: two frames on time, then one late. (The median is
    // 16.7 ms and no frame is longer than 34 ms: this used to be judged fine, for ever.)
    const g = createGovernor(4);
    const seen: number[] = [];
    let n = 0;
    for (let t = 0; t < 30_000; ) {
      const gap = g.level === 0 && n++ % 3 === 2 ? 33.3 : 16.7;
      t += gap;
      const to = g.frame(gap, true);
      if (to !== null) seen.push(to);
    }
    expect(seen[0]).toBe(1);
    expect(g.level).toBe(1);
  });

  test('the same on a 120 Hz screen: half the frames taking two refreshes is slow', () => {
    const g = createGovernor(4);
    let n = 0;
    for (let t = 0; t < 12_000; ) {
      const gap = g.level === 0 && n++ % 5 >= 3 ? 16.7 : 8.3;
      t += gap;
      g.frame(gap, true);
    }
    expect(g.level).toBe(1);
  });

  test('a steady 60 on a 120 Hz screen is left alone', () => {
    const g = createGovernor(4);
    let changed = false;
    // A few frames at 120 at the start, then a steady 60.
    for (let i = 0; i < 4000; i++) if (g.frame(i < 30 ? 8.3 : 16.7, true) !== null) changed = true;
    expect(changed).toBe(false);
  });

  test('a level that keeps up for a while and then does not is not gone back to at once: no going to and fro', () => {
    // Level 0 holds for its first 20 s each time, then misses one frame in four (a level right at the edge).
    const g = createGovernor(4);
    const ups: number[] = [];
    let since = 0, n = 0;
    for (let t = 0; t < 600_000; ) {
      const gap = g.level === 0 && t - since > 20_000 && n++ % 4 === 3 ? 33.3 : 16.7;
      t += gap;
      const to = g.frame(gap, true);
      if (to === 0) {
        ups.push(t);
        since = t;
      }
    }
    // Ten minutes: a handful of tries, each further from the last.
    expect(ups.length).toBeGreaterThanOrEqual(1);
    expect(ups.length).toBeLessThanOrEqual(5);
    for (let i = 1; i < ups.length; i++) expect(ups[i]! - ups[i - 1]!).toBeGreaterThan(GOVERNOR.backoff * 2 ** (i - 1));
  });

  test('the frames after an edit (the town rebuilt: the page was busy, not slow to draw) are not slow frames', () => {
    const g = createGovernor(4);
    let changed = false;
    // A town growing by itself: every sixth frame an edit lands, and the two frames after it are long.
    for (let i = 0; i < 6000; i++) {
      const busy = i % 6 < 2;
      if (g.frame(busy ? 50 : 16.7, true, busy) !== null) changed = true;
    }
    expect(changed).toBe(false);
  });

  test('pauses (a hidden tab, a rebuild of a few hundred ms) are not slow frames', () => {
    const g = createGovernor(5);
    let changed = false;
    for (let i = 0; i < 6000; i++) if (g.frame(i % 100 === 0 ? 900 : 16.7, true) !== null) changed = true;
    expect(changed).toBe(false);
  });

  test('a device too slow to draw ten frames in a window is the slowest of all: it steps down, quickly, to the lowest level', () => {
    // 1.3 frames a second (no graphics card, a 1366 x 768 window): every gap is longer than a "pause",
    // and a window never held ten frames, so this was judged fine for ever (found 2026-11-24).
    for (const cost of [770, 300, 180]) {
      const g = createGovernor(6);
      let t = 0;
      let at = Infinity;
      while (t < 30_000) {
        const gap = cost * (1 - 0.1 * g.level);
        t += gap;
        g.frame(gap, false);
        if (g.level === 5) at = Math.min(at, t);
      }
      expect(g.level, `${cost} ms frames`).toBe(5);
      expect(at, `${cost} ms frames`).toBeLessThan(16_000);
    }
  });

  test('a device that is slow only while every frame is busy (a town growing by itself) is still found out', () => {
    const g = createGovernor(6);
    let t = 0;
    while (t < 20_000) {
      const gap = 150 - 18 * g.level;
      t += gap;
      // 30 ms of the gap was the page's own work; the rest is drawing.
      g.frame(gap, true, true, 30);
    }
    expect(g.level).toBeGreaterThan(2);
  });

  test('a page busy with its own work on a fast graphics card keeps its sharpness', () => {
    const g = createGovernor(6);
    let t = 0;
    while (t < 60_000) {
      t += 150;
      g.frame(150, true, true, 140);
    }
    expect(g.level).toBe(0);
  });

  test('a rough level (below the screen\'s own pixels) is only for frames that are really slow', () => {
    const levels = qualityLevels(1);
    const rough = levels.findIndex((q) => q.rough);
    expect(rough).toBeGreaterThan(0);
    const settle = (cost: number): number => {
      const g = createGovernor(levels.length, 0, (i) => levels[i]!.rough === true);
      for (let t = 0; t < 60_000; ) {
        const gap = cost * (1 - 0.06 * g.level);
        t += gap;
        g.frame(gap, true);
      }
      return g.level;
    };
    expect(settle(25)).toBe(rough - 1); // 40 a second: sharp at 40 is better than soft at 60
    expect(settle(60)).toBe(levels.length - 1);
  });
});

describe('a frame rate that has nothing to do with the drawing', () => {
  /** Runs a governor over a screen's levels; every change, and where it ends. */
  function play(dpr: number, gap: (level: number, t: number, n: number) => number, seconds: number, start = 0) {
    const levels = qualityLevels(dpr);
    const g = createGovernor(levels.length, start, (i) => levels[i]!.rough === true);
    const path: { at: number; to: number }[] = [];
    const spent = levels.map(() => 0);
    let rough = 0;
    for (let t = 0, n = 0; t < seconds * 1000; n++) {
      const d = gap(g.level, t, n);
      t += d;
      const to = g.frame(d, true);
      if (to !== null) path.push({ at: t, to });
      if (levels[g.level]!.rough) rough += d;
      // Where it settles: the level it spends the second half at (it tries the one above now and then).
      if (t > seconds * 500) spent[g.level]! += d;
    }
    return { level: g.level, settled: spent.indexOf(Math.max(...spent)), path, rough: rough / 1000, levels };
  }

  test('capped at 30 a second (Low Power Mode, a battery saver): never rough, and back to its sharpest for good', () => {
    // Found 2026-11-25 in the live numbers: M3 Max, M4 Pro and iPhones at a steady 31 a second, not one long frame, at the roughest levels.
    for (const dpr of [1, 2, 3]) {
      const r = play(dpr, (_l, t) => 33.3 + ((t * 7) % 3) * 0.1, 300);
      expect(r.level, `at ${dpr}x`).toBe(0);
      expect(r.rough, `at ${dpr}x`).toBe(0);
      expect(r.path.filter((c) => c.at > 60_000), `at ${dpr}x`).toEqual([]);
    }
  });

  test('capped at 30 and started low (remembered from last time): it climbs back', () => {
    for (const start of [3, 4, 6]) expect(play(3, () => 33.3, 300, start).level, `from ${start}`).toBe(0);
  });

  test('slow for its own work whatever the sharpness (45 ms a frame): sharp, as rough would buy nothing', () => {
    expect(play(3, () => 45, 200).level).toBe(0);
  });

  test('one frame in eight long for its own work, at every level: it keeps its sharpness', () => {
    expect(play(3, (_l, _t, n) => (n % 8 === 0 ? 40 : 16.7), 300).level).toBe(0);
  });

  test('a few seconds of stall (a lot happening at once): back to where it was within half a minute', () => {
    for (const hitches of [0, 25]) {
      const r = play(3, (_l, t, n) => (t > 20_000 && t < 25_000 ? 160 : hitches && n % hitches === 0 ? 40 : 16.7), 120);
      expect(r.level).toBe(0);
      expect(r.path.length === 0 || r.path.at(-1)!.at < 55_000, JSON.stringify(r.path)).toBe(true);
    }
  });

  test('two refreshes a frame until the third level (the screen rounds a frame up): it still finds it', () => {
    expect(play(1, (l) => (l < 2 ? 33.3 : 16.7), 300).settled).toBe(2);
  });

  test('a device that needs its rough level, and starts there, keeps it (it looks up once or twice, no more)', () => {
    const r = play(3, (l) => 160 - 18 * l, 600, 6);
    expect(r.settled).toBe(6);
    expect(r.path.length).toBeLessThanOrEqual(6);
  });

  test('a cap that is lifted (plugged in): it carries on as any device', () => {
    const r = play(3, (_l, t) => (t < 60_000 ? 33.3 : 16.7), 200);
    expect(r.level).toBe(0);
    const slow = play(3, (l, t) => (t < 60_000 ? 33.3 : l < 3 ? 60 : 16.7), 300);
    expect(slow.settled).toBe(3);
  });
});

describe('what the device says it is', () => {
  test('drawn by the processor: straight to the lowest level', () => {
    const l = qualityLevels(1);
    for (const gpu of ['Google SwiftShader', 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)))', 'llvmpipe (LLVM 15.0.7, 256 bits)', 'Microsoft Basic Render Driver'])
      expect(deviceLevel(l, { gpu })).toBe(l.length - 1);
  });
  test('a weak graphics chip or little memory starts without the super-sampling, or at twice a phone\'s pixels', () => {
    const l = qualityLevels(1);
    expect(l[deviceLevel(l, { gpu: 'ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)' })]!.superSample).toBe(1);
    expect(l[deviceLevel(l, { gpu: 'ANGLE (Intel, Intel(R) HD Graphics 4000)' })]!.superSample).toBe(1);
    const p = qualityLevels(3);
    for (const gpu of ['Mali-G52', 'Adreno (TM) 610', 'PowerVR Rogue GE8320']) expect(p[deviceLevel(p, { gpu })]!.pixelRatio).toBe(2);
    expect(p[deviceLevel(p, { gpu: '', memory: 2 })]!.pixelRatio).toBe(2);
    // None of these ever starts rough.
    expect(p[deviceLevel(p, { gpu: 'Mali-G52' })]!.rough).toBeUndefined();
  });
  test('anything else starts as before', () => {
    const l = qualityLevels(1);
    for (const gpu of ['', 'Apple GPU', 'ANGLE (Apple, ANGLE Metal Renderer: Apple M1)', 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060)', 'Adreno (TM) 750', 'Mali-G715']) expect(deviceLevel(l, { gpu })).toBe(0);
  });
});
