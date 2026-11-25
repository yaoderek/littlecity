// Playing a grown town (design section 15a): clear the island, then apply
// the generator's edits in order at about 25 a second, each one landing like
// a placed piece, so the town visibly builds itself district by district.
// skip() puts the rest down at once. The clearing and the whole growth are
// one undo step (the Game's batch). No DOM: the interface ticks it from the
// frame loop with the clock and wires skip to a click or a key.
//
// On a slow device (an edit costs more than SLOW) the edits go down several at a time with a rest
// between, at the same 25 a second: working the town out costs the same for one piece as for ten, and
// one at a time it left a phone at 5 frames a second for its whole first minute. And skip() there
// spreads the rest over a few frames: done inside the tap that asked for it, it was a 2 to 3 second freeze.

import { keyY } from '@/core/grid';
import type { Edit, Terrain, World } from '@/core/world';
import { initialWorld, terrainGenOf } from '@/terrain/terrain';
import type { Game } from '@/app/game';

export interface Growth {
  /** A growth is playing. */
  readonly active: boolean;
  /** Edits still to come. */
  readonly left: number;
  /** Clears the island and starts playing these edits (computed for an empty island). */
  start(edits: readonly Edit[]): void;
  /** Once per frame with the clock in milliseconds: puts down the edits that are due. */
  tick(now: number): void;
  /** Puts down everything that is left: at once, or over a few frames on a slow device (unless `now`). */
  skip(now?: boolean): void;
  /** Stops where it is (the town so far stays, as one undo step). */
  stop(): void;
}

export interface GrowthOptions {
  /** Edits a second. Default 25. */
  rate?: number;
  /** At most this many edits in one frame, so a slow frame never stalls the view. Default 3. */
  perFrame?: number;
  /** Milliseconds of edits to put down in one frame: the first due edit always goes, the rest wait once this is spent. Default 8. */
  budgetMs?: number;
  /** Milliseconds, to time the edits by (the budget, and whether this is a slow device). Default performance.now. */
  clock?(): number;
  /** The growth finished (played out, skipped or stopped). */
  onDone?(): void;
  /** skip() is being spread over the next frames. */
  onHurry?(): void;
}

/** Milliseconds an edit takes, above which they go down in runs. */
export const SLOW = 12;
/** After a run that took so long, a rest this many times as long. */
export const REST = 3;
/** ... and at least this long (ms) where a run is a frame or more lost: fewer hitches, not merely smaller ones. */
export const PAUSE = 450;
const HITCH = 25;
/** At most this many edits in a run. */
export const RUN = 24;
/** Skipping on a slow device: each frame's run aims to take about this long, ms. */
const HURRY = 100;

/** True if the island holds nothing but its starting trees (no confirmation is needed to grow over it). */
export function onlyStartingTrees(world: World, terrain: Terrain): boolean {
  if (world.floors.size > 0 || world.edges.size > 0) return false;
  const start = initialWorld(world.seed, terrain, terrainGenOf(world));
  for (const [cell, b] of world.blocks) if (b.kind !== 'tree' || start.blocks.get(cell)?.kind !== 'tree') return false;
  return true;
}

/** The edits that clear the island: edge pieces, floors, then blocks from the top down. */
export function clearingEdits(world: World): Edit[] {
  const out: Edit[] = [];
  for (const edge of world.edges.keys()) out.push({ type: 'eraseEdge', edge });
  for (const cell of world.floors.keys()) out.push({ type: 'eraseFloor', cell });
  const blocks = [...world.blocks.keys()].sort((a, b) => keyY(b) - keyY(a) || b - a);
  for (const cell of blocks) out.push({ type: 'eraseBlock', cell });
  return out;
}

/** How often the town is dressed while it grows: a whole-town dressing after every piece would swamp the frames. */
export const DRESS_WHILE_GROWING_MS = 300;

/** True if the town should be dressed this frame: always when it is not growing, else a few times a second. */
export function dressDue(now: number, lastDressed: number, growing: boolean): boolean {
  return !growing || now - lastDressed >= DRESS_WHILE_GROWING_MS;
}

export function createGrowth(game: Game, opts: GrowthOptions = {}): Growth {
  const rate = opts.rate ?? 25;
  const perFrame = opts.perFrame ?? 3;
  const budgetMs = opts.budgetMs ?? 8;
  const clock = opts.clock ?? (() => performance.now());
  let queue: Edit[] = [];
  let next = 0;
  let active = false;
  let last: number | null = null;
  let due = 0;
  /** What showing the town with one step's edits costs here (ms), of late. */
  let cost = 0;
  let rested = -Infinity;
  /** Skipping, spread over frames: how many edits to the next one (0: not skipping). */
  let hurry = 0;

  const finish = (): void => {
    if (!active) return;
    active = false;
    hurry = 0;
    queue = [];
    next = 0;
    game.end();
    opts.onDone?.();
  };
  /** Puts down the next n edits as one run; returns how long that took. */
  const run = (n: number): number => {
    const t = clock();
    game.editRun(queue.slice(next, next + n));
    next += n;
    const took = clock() - t;
    cost = took > cost ? took : cost + (took - cost) * 0.3;
    return took;
  };

  return {
    get active() {
      return active;
    },
    get left() {
      return active ? queue.length - next : 0;
    },
    start(edits) {
      finish();
      game.begin();
      const clear = clearingEdits(game.world);
      if (clear.length > 0) game.editAll(clear);
      queue = [...edits];
      next = 0;
      last = null;
      due = 0;
      hurry = 0;
      active = true;
      if (queue.length === 0) finish();
    },
    tick(now) {
      if (!active) return;
      if (last === null) last = now;
      due += (Math.max(0, now - last) / 1000) * rate;
      last = now;
      if (hurry > 0) {
        const took = run(hurry);
        if (took > HURRY * 1.4) hurry = Math.max(4, hurry >> 1);
        else if (took < HURRY * 0.6) hurry *= 2;
      } else if (cost > SLOW) {
        // (A device that stalls for seconds does not owe all of them at once.)
        due = Math.min(due, RUN);
        if (due < 1 || now - rested < Math.max(cost * REST, cost > HITCH ? PAUSE : 0)) return;
        const n = Math.floor(due);
        due -= n;
        rested = now + run(n);
      } else {
        let n = Math.min(Math.floor(due), perFrame);
        due -= Math.floor(due);
        // A slow frame drops its backlog rather than catching up, so growth never holds a frame for long.
        const began = clock();
        let at = began;
        while (n-- > 0 && next < queue.length) {
          game.edit(queue[next++]!);
          const t = clock();
          const took = t - at;
          at = t;
          cost = took > cost ? took : cost + (took - cost) * 0.3;
          if (t - began >= budgetMs) break;
        }
      }
      if (next >= queue.length) finish();
    },
    skip(now = false) {
      if (!active || (hurry > 0 && !now)) return;
      if (cost > SLOW && !now) {
        hurry = RUN;
        opts.onHurry?.();
        return;
      }
      game.editAll(queue.slice(next));
      next = queue.length;
      finish();
    },
    stop: finish,
  };
}
