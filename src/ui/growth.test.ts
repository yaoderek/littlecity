import { describe, expect, test } from 'vitest';
import { createGame } from '@/app/game';
import { generateTerrain, initialWorld } from '@/terrain/terrain';
import { growTown } from '@/townmaker/index';
import { clearingEdits, createGrowth, dressDue, onlyStartingTrees, REST, RUN } from './growth';

function setup(seed = 3) {
  const terrain = generateTerrain(seed);
  const world = initialWorld(seed, terrain);
  let shows = 0;
  // No rules: playback is what is tested here, and a full resolve after each of ~700 edits was 11 s of it.
  const game = createGame({ world, terrain, resolve: { rules: [] } }, { show: () => void shows++ });
  return { game, terrain, world, edits: growTown(terrain, seed), shows: () => shows };
}

describe('growth playback', () => {
  test('plays about 25 edits a second, a few at most per frame, as one undo step', () => {
    const { game, world, edits } = setup();
    let done = 0;
    const growth = createGrowth(game, { onDone: () => done++, clock: () => 0 });
    growth.start(edits);
    expect(growth.active).toBe(true);
    expect(game.world.blocks.size).toBe(0); // the starting trees are cleared
    growth.tick(0);
    growth.tick(1000); // a second: capped at 3 in one frame
    expect(growth.left).toBe(edits.length - 3);
    for (let t = 1016; growth.active; t += 16) growth.tick(t);
    expect(done).toBe(1);
    expect(game.world.blocks.size).toBeGreaterThan(200);
    expect(game.canUndo).toBe(true);
    game.undo();
    expect(game.world).toBe(world);
    expect(game.canUndo).toBe(false);
  });

  test('skip puts the rest down at once and shows it once', () => {
    const { game, edits, shows } = setup();
    const growth = createGrowth(game, { clock: () => 0 });
    growth.start(edits);
    growth.tick(0);
    growth.tick(200);
    const before = shows();
    growth.skip();
    expect(shows()).toBe(before + 1);
    expect(growth.active).toBe(false);
    const full = setup();
    full.game.editAll(clearingEdits(full.game.world));
    full.game.editAll(edits);
    expect(game.world.blocks.size).toBe(full.game.world.blocks.size);
  });

  /** A device on which showing the town takes `ms`. */
  function slow(ms: number) {
    let t = 0;
    const terrain = generateTerrain(3);
    const world = initialWorld(3, terrain);
    const shows: number[] = [];
    const landed: number[] = [];
    const game = createGame({ world, terrain, resolve: { rules: [] } }, {
      show(_shape, edit, more) {
        t += ms;
        shows.push(t);
        landed.push(edit ? 1 + (more?.length ?? 0) : 0);
      },
    });
    const hurried = { n: 0 };
    const growth = createGrowth(game, { clock: () => t, onHurry: () => void hurried.n++ });
    return { game, growth, shows, landed, hurried, edits: growTown(terrain, 3), clock: () => t, pass: (by: number) => void (t += by) };
  }

  test('on a slow device the pieces land in runs with a rest between, about as many a second, and every one lands', () => {
    const d = slow(90);
    d.growth.start(d.edits);
    const from = d.clock();
    const first = d.shows.length;
    while (d.growth.active) {
      d.pass(16);
      d.growth.tick(d.clock());
    }
    const seconds = (d.clock() - from) / 1000;
    // No slower than a third off 25 a second, and at most about a quarter of the time spent on it.
    expect(d.edits.length / seconds).toBeGreaterThan(17);
    expect(((d.shows.length - first) * 90) / (seconds * 1000)).toBeLessThan(1 / (1 + REST) + 0.03);
    expect(Math.max(...d.landed)).toBeLessThanOrEqual(RUN);
    const full = setup();
    full.game.editAll(clearingEdits(full.game.world));
    full.game.editAll(d.edits);
    expect(d.game.world.blocks.size).toBe(full.game.world.blocks.size);
  });

  test('skip on a slow device: nothing is done inside the tap, the rest follows over frames, still one undo step', () => {
    const d = slow(90);
    const before = d.game.world;
    d.growth.start(d.edits);
    for (let i = 0; i < 40; i++) {
      d.pass(16);
      d.growth.tick(d.clock());
    }
    const shows = d.shows.length;
    d.growth.skip();
    expect(d.shows.length).toBe(shows);
    expect(d.hurried.n).toBe(1);
    expect(d.growth.active).toBe(true);
    d.growth.skip(); // a second tap changes nothing
    expect(d.hurried.n).toBe(1);
    let frames = 0;
    for (; d.growth.active && frames < 100; frames++) {
      d.pass(16);
      d.growth.tick(d.clock());
    }
    expect(frames).toBeGreaterThan(1);
    expect(frames).toBeLessThan(40);
    d.game.undo();
    expect(d.game.world).toBe(before);
  });

  test('knows an untouched island, and how to clear one', () => {
    const { game, terrain, world } = setup();
    expect(onlyStartingTrees(world, terrain)).toBe(true);
    game.edit({ type: 'placeFloor', cell: [...world.blocks.keys()][0]!, floor: 'garden' });
    expect(onlyStartingTrees(game.world, terrain)).toBe(false);
    const cleared = setup();
    cleared.game.editAll(clearingEdits(game.world));
    expect(clearingEdits(world).length).toBe(world.blocks.size);
  });
});

describe('growth frame budget', () => {
  test('stops putting edits down once the frame budget is spent', () => {
    const { game, edits } = setup();
    let t = 0;
    const growth = createGrowth(game, { budgetMs: 8, clock: () => (t += 5) }); // each edit "costs" 5 ms
    growth.start(edits);
    growth.tick(0);
    growth.tick(1000); // 25 due, 3 allowed, but the budget is gone after 2
    expect(growth.left).toBe(edits.length - 2);
  });

  test('still advances when one edit overruns the budget', () => {
    const { game, edits } = setup();
    let t = 0;
    const growth = createGrowth(game, { budgetMs: 8, clock: () => (t += 50) });
    growth.start(edits);
    growth.tick(0);
    growth.tick(1000);
    expect(growth.left).toBe(edits.length - 1);
    for (let now = 1016; growth.active; now += 16) growth.tick(now);
    expect(growth.left).toBe(0);
  });

  test('dressDue is immediate when not growing, and every 300 ms while growing', () => {
    expect(dressDue(1000, 990, false)).toBe(true);
    expect(dressDue(1000, 800, true)).toBe(false);
    expect(dressDue(1100, 800, true)).toBe(true);
  });
});

describe('dressings while mischief is busy', () => {
  test('are paced like growth: every 300 ms, not every frame', () => {
    // main passes growing || mischief.busy as `growing`
    expect(dressDue(1000, 900, true)).toBe(false);
    expect(dressDue(1200, 900, true)).toBe(true);
    expect(dressDue(1000, 990, false)).toBe(true);
  });
});
