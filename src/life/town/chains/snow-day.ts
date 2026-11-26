// L64 · A snow day (posts from L64.snow-day.rule.ts). Once snow lies deep, by
// day, the children of the town (and a grown-up or two) come running out to
// the square in their coats and woolly hats, build a snowman and have a
// snowball fight round it.
//
//   gather   up to SNOW_DAY.players, children first, living within reach,
//            come at a run and stand in a ring round the middle
//   build    two of them roll snowballs round and round, the balls growing
//            as they go; the big one is pushed into the middle (the body),
//            the second lifted on it, then a small one for the head; then
//            somebody (a grown-up if there is one) gives it a face, a carrot
//            nose, coal buttons and stick arms, and last a hat and a scarf.
//            The rest stand round cheering. (A snowman still standing from
//            before is not built again: straight to the fight.)
//   fight    they split into two sides, two cells either side of the
//            snowman, and throw: one stoops to scoop a snowball and lets fly,
//            it arcs over the snowman and bursts in a white puff on somebody
//            on the other side, who jumps; the sides take turns
//   home     each walks home; the snowman stays until the snow melts (it
//            slumps, its hat slipping and its nose falling, and then is gone
//            in a puff)
//
// Called off (everybody home) if the square goes, or a bomb falls near.
// Cost per step: a few comparisons per player and a matrix per ball rolling
// or in the air (three at most at once).

import { phrase } from '@/core/phrase';
import { keyX, keyZ, type CellKey } from '@/core/grid';
import { rand } from '@/core/rand';
import type { InstanceHandle } from '@/life/api';
import type { PoseName } from '@/parts/people/pose';
import { fortMesh, snowballMesh, snowmanMesh, SNOWMAN, type SnowmanStage } from '@/parts/people/snow';
import { PERSON } from '@/style/people';
import { SNOW_DAY } from '@/style/scenes';
import { fxOf } from '../../fx/fx';
import { mischiefOf } from '../../mischief/director';
import { place } from '../../motion/pose';
import type { Person } from '../../people/crowd';
import { type Board, type Chain, type Plan, type PlanStep, type Post } from '../board';
import { canWork, homeCell, reaches, unbusy } from '../hands';
import { scenesOf, type Scene } from '../scenes';

export type SnowPhase = 'none' | 'gather' | 'build' | 'fight';

/** The snowman is drawn this much bigger than snow.ts builds it (and the balls are rolled to match). */
const MAN_SCALE = 1.35;
/** Snowballs in the air: their radius, and how high they arc. */
const BALL = 0.07;
const ARC = 1.0;

interface Player {
  p: Person;
  side: 'a' | 'b';
  /** Their place in the ring round the snowman (angle), and on their side (across, along). */
  ring: number;
  spot: { x: number; z: number };
  /** A pose held until a life time (a throw, a jump when hit). */
  pose: PoseName | null;
  poseUntil: number;
  lost: boolean;
}

interface Snowman {
  x: number;
  y: number;
  z: number;
  stage: SnowmanStage;
  h: InstanceHandle | null;
  look: number;
  /** Life time it began to melt (Infinity while the snow lies). */
  melting: number;
}

interface Ball {
  x0: number;
  y0: number;
  z0: number;
  to: Player;
  t: number;
  h: InstanceHandle | null;
}

export interface SnowDayChain extends Chain {
  readonly phase: SnowPhase;
  readonly days: number;
  readonly players: readonly Player[];
  readonly snowmen: readonly Snowman[];
  /** Snowballs thrown so far today, and hits. */
  readonly thrown: number;
  readonly flying: number;
  /** Snow forts standing. */
  readonly forts: number;
  begin(board: Board): boolean;
}

export function snowDayChain(): SnowDayChain {
  let man: Post | undefined;
  let sides: { a: Post | undefined; b: Post | undefined } = { a: undefined, b: undefined };
  let phase: SnowPhase = 'none';
  let t = 0;
  let days = 0;
  let next = Infinity;
  let snowSince = -1;
  let players: Player[] = [];
  const snowmen: Snowman[] = [];
  /** The forts each side has packed up (they stand, and melt, with the snowman). */
  const forts: { x: number; y: number; z: number; yaw: number; h: InstanceHandle | null; melting: number }[] = [];
  const putFort = (board: Board, side: Post): void => {
    const c = board.centre(side.cell), m = centre(board);
    if (forts.some((f) => Math.hypot(f.x - c.x, f.z - c.z) < 0.6)) return;
    // Between the side and the snowman, curving round to face it.
    const dx = m.x - c.x, dz = m.z - c.z, d = Math.hypot(dx, dz) || 1;
    const f = { x: c.x + (dx / d) * 0.36, y: c.y, z: c.z + (dz / d) * 0.36, yaw: Math.atan2(dx, dz), h: null as InstanceHandle | null, melting: Infinity };
    f.h = board.stage ? board.stage.spawnMesh(fortMesh(), place(f.x, f.y, f.z, f.yaw)) : null;
    forts.push(f);
    puff(board, f.x, f.y + 0.05, f.z, 3, 0.2);
  };
  let building: Snowman | null = null;
  /** The balls being rolled (by the two rollers), and their size. */
  let rolling: { who: Player; r: number; h: InstanceHandle | null; a: number; which: number }[] = [];
  const balls: Ball[] = [];
  let thrown = 0;
  const nextThrow = { a: 0, b: 0 };
  let scene: Scene | null = null;
  let reassigning = false;
  let checkAt = 0;

  const puff = (board: Board, x: number, y: number, z: number, n = 2, size = 0.22): void => {
    if (!board.stage) return;
    for (let i = 0; i < n; i++) {
      const a = i * 2.3 + x;
      fxOf(board.stage).play({ actor: 'puff', variant: 'smoke' }, 0.5, (k, m) => place(x + Math.cos(a) * 0.06, y + k * 0.1, z + Math.sin(a) * 0.06, 0, size + k * size, size + k * size, size + k * size, m), { delay: i * 0.05 });
    }
  };
  const centre = (board: Board): { x: number; y: number; z: number } => board.centre(man!.cell);
  const standing = (board: Board): Snowman | undefined => {
    const c = centre(board);
    return snowmen.find((s) => s.stage !== -1 && Math.hypot(s.x - c.x, s.z - c.z) < 0.3);
  };
  const drawMan = (board: Board, s: Snowman): void => {
    s.h?.release();
    s.h = board.stage ? board.stage.spawnMesh(snowmanMesh(s.stage, s.look), place(s.x, s.y, s.z, 0, MAN_SCALE, MAN_SCALE, MAN_SCALE)) : null;
    puff(board, s.x, s.y + SNOWMAN.body[1], s.z, 2, 0.16);
  };

  const holdAt = (board: Board, pl: Player, cell: CellKey, tag: string): PlanStep => board.stepAt(cell, { spot: pl.spot, face: NaN, pose: 'stand', linger: 1e6, tag, brisk: true });
  const playing = (board: Board, pl: Player, tag?: string): boolean => !pl.lost && pl.p.mode === 'linger' && board.plans.get(pl.p)?.chain === chain && (tag === undefined || pl.p.goal?.errand?.tag === tag);

  const homePlan = (board: Board, p: Person): Plan | null => {
    const home = board.homeStep(p, { tag: 'snow:home', linger: 0.5, done: (q) => void (board.claimedBy(q) === chain && board.unclaim(q)) });
    return home ? { chain, at: 0, steps: [home] } : null;
  };

  const begin = (board: Board): boolean => {
    if (phase !== 'none' || !man || !sides.a || !sides.b || !board.nav) return false;
    const target = man.cell;
    const free = board.crowd.people.filter((p) => !p.shutIn && !p.leaving && p.mode !== 'gone' && unbusy(board, p) && !p.scuffle && !p.load && !p.party && reaches(board, p, target));
    const far = (p: Person): number => {
      const h = homeCell(board, p);
      return h === null ? Infinity : board.dist(h, target) + (p.mode === 'home' ? 0 : board.dist(p.cell, target)) * 0.3;
    };
    const near = free.filter((p) => far(p) <= SNOW_DAY.reach).sort((a, b) => far(a) - far(b) || (a.id < b.id ? -1 : 1));
    const kids = near.filter((p) => p.child);
    const grown = near.filter((p) => canWork(p));
    const want = Math.round(SNOW_DAY.players);
    // Children, and a grown-up or two (more when there are few children).
    const crew = [...kids.slice(0, want - 1), ...grown.slice(0, Math.max(1, Math.min(3, want - kids.length)))].slice(0, want);
    if (crew.length < 3) return false;
    const c = centre(board);
    players = crew.map((p, i) => {
      const ring = (i / crew.length) * Math.PI * 2 + rand(board.seed, 'snow-ring', days) * 6;
      const r = 0.36;
      const cx = keyX(target), cz = keyZ(target);
      return { p, side: i % 2 === 0 ? 'a' : 'b', ring, spot: { x: Math.max(cx + 0.06, Math.min(cx + 0.94, c.x + Math.cos(ring) * r)), z: Math.max(cz + 0.06, Math.min(cz + 0.94, c.z + Math.sin(ring) * r)) }, pose: null, poseUntil: 0, lost: false } satisfies Player;
    });
    for (const pl of players) {
      board.claim(pl.p, chain);
      pl.p.party = true;
      const step = holdAt(board, pl, target, 'snow:ring');
      const home = board.homeStep(pl.p, { tag: 'snow:home', linger: 0.5, done: (q) => void (board.claimedBy(q) === chain && board.unclaim(q)) });
      if (!home) {
        pl.lost = true;
        continue;
      }
      reassigning = true;
      board.assign(pl.p, {
        chain,
        at: 0,
        steps: [step, home],
        fail: (q) => {
          if (reassigning) return;
          const me = players.find((x) => x.p === q);
          if (me) me.lost = true;
          q.party = false;
        },
      });
      reassigning = false;
      // Off at once, at a run.
      pl.p.timer = Math.min(pl.p.timer, rand(pl.p.seed, 'snow-go', days) * 3);
    }
    phase = 'gather';
    t = 0;
    days++;
    fortAt.a = fortAt.b = Infinity;
    thrown = 0;
    building = null;
    scene = scenesOf(board).begin({
      kind: 'snow',
      title: phrase('A snowball fight on the square'),
      big: true,
      focus: () => (man ? centre(board) : null),
      noteworthy: () => phase === 'build' || phase === 'fight',
      gathering: () => false,
    });
    return true;
  };

  /** Everybody home; the snowman stays. */
  const finish = (board: Board, off: boolean): void => {
    for (const r of rolling) r.h?.release();
    rolling = [];
    for (const b of balls) {
      puff(board, b.to.p.x, b.to.p.y + 0.3, b.to.p.z, 1, 0.12);
      b.h?.release();
    }
    balls.length = 0;
    for (const pl of players) {
      const p = pl.p;
      p.party = false;
      p.lift = 0;
      if (pl.lost) continue;
      if (board.plans.get(p)?.chain === chain) {
        if (off) {
          const plan = homePlan(board, p);
          reassigning = true;
          if (plan) board.assign(p, plan);
          else board.drop(p);
          reassigning = false;
        } else p.timer = Math.min(p.timer, 0.3 + rand(p.seed, 'snow-home', days) * 2.5);
      } else if (board.claimedBy(p) === chain) board.unclaim(p);
    }
    // A snowman left half built stands as far as it got.
    building = null;
    players = [];
    phase = 'none';
    if (scene) scenesOf(board).end(scene);
    scene = null;
    next = board.now + SNOW_DAY.every + rand(board.seed, 'snow-next', days) * SNOW_DAY.everySpread;
  };

  /** Moves a player toward a place inside their cell; true once there. */
  const walkTo = (pl: Player, x: number, z: number, dt: number, pace = 0.45): boolean => {
    const p = pl.p;
    const dx = x - p.x, dz = z - p.z, d = Math.hypot(dx, dz);
    if (d < 0.01) return true;
    const k = Math.min(d, pace * dt);
    const cx = keyX(p.cell), cz = keyZ(p.cell);
    p.x = Math.max(cx + 0.03, Math.min(cx + 0.97, p.x + (dx / d) * k));
    p.z = Math.max(cz + 0.03, Math.min(cz + 0.97, p.z + (dz / d) * k));
    p.heading = Math.atan2(dx, dz);
    p.pose = p.child ? 'run' : 'walk';
    p.stride += (k * PERSON.stepsPerCell * 0.5) / (p.child ? 0.8 : 1);
    return false;
  };
  const face = (p: Person, x: number, z: number): void => {
    p.heading = Math.atan2(x - p.x, z - p.z);
  };
  const pose = (pl: Player, name: PoseName, board: Board): void => {
    if (pl.pose && board.now < pl.poseUntil) name = pl.pose;
    if (pl.p.pose !== name) {
      pl.p.pose = name;
      pl.p.poseTime = 0;
    }
  };

  // ── the snowman ─────────────────────────────────────────────────────────
  const stepBuild = (board: Board, dt: number): void => {
    const c = centre(board);
    const ring = players.filter((pl) => playing(board, pl, 'snow:ring'));
    const kids = ring.filter((pl) => pl.p.child);
    const rollers = (kids.length >= 2 ? kids : ring).slice(0, 2);
    const decorator = ring.find((pl) => !pl.p.child) ?? ring[ring.length - 1];
    const B = SNOW_DAY.build;
    const k = t / B;
    if (!building) {
      building = { x: c.x, y: c.y, z: c.z, stage: 1, h: null, look: Math.floor(rand(board.seed, 'snowman', days) * 4), melting: Infinity };
      if (rolling.length === 0)
        rolling = rollers.map((who, i) => ({ who, r: 0.04, h: board.stage ? board.stage.spawnMesh(snowballMesh(), place(c.x, c.y - 1, c.z, 0)) : null, a: i * Math.PI, which: i }));
    }
    // Rolling: round and round inside the cell, the ball growing ahead of them, until it is big enough.
    const sizes = [SNOWMAN.body[0] * MAN_SCALE, SNOWMAN.middle[0] * MAN_SCALE, SNOWMAN.head[0] * MAN_SCALE];
    const stageAt = [0.36, 0.48, 0.66, 0.76, 0.88];
    for (const [i, r] of rolling.entries()) {
      const pl = r.who;
      if (!playing(board, pl)) continue;
      // Which ball is theirs: the first roller the body then the head; the second the middle.
      const which = i === 0 ? (k >= stageAt[0]! ? 2 : 0) : 1;
      if (which !== r.which) {
        // A fresh little ball for the head.
        r.which = which;
        r.r = 0.03;
      }
      const done = (which === 1 && k >= stageAt[1]!) || (which === 2 && k >= stageAt[2]!);
      if (done || (which === 2 && k < stageAt[1]!)) {
        r.h?.setVisible(false);
        pose(pl, 'clap', board);
        face(pl.p, c.x, c.z);
        continue;
      }
      r.a += dt * 1.3 * (i === 0 ? 1 : -1);
      const rad = 0.3;
      const cx = keyX(man!.cell), cz = keyZ(man!.cell);
      const tx = Math.max(cx + 0.1, Math.min(cx + 0.9, c.x + Math.cos(r.a) * rad)), tz = Math.max(cz + 0.1, Math.min(cz + 0.9, c.z + Math.sin(r.a) * rad));
      walkTo(pl, tx, tz, dt, 0.5);
      r.r = Math.min(sizes[which]!, r.r + dt * 0.022 * (which === 2 ? 0.7 : 1));
      const fx = Math.sin(pl.p.heading), fz = Math.cos(pl.p.heading);
      r.h?.setVisible(true);
      r.h?.setMatrix(place(pl.p.x + fx * (0.08 + r.r), c.y + r.r * 0.92, pl.p.z + fz * (0.08 + r.r), r.a * 3, r.r, r.r * 0.92, r.r));
    }
    // The stages: the body pushed into the middle, the middle lifted on, the head, the face, the hat.
    const want = stageAt.filter((x) => k >= x).length;
    if (want >= 1 && (!snowmen.includes(building) || building.stage < want)) {
      building.stage = want as SnowmanStage;
      if (!snowmen.includes(building)) snowmen.push(building);
      drawMan(board, building);
      const by = want <= 3 ? rollers[want === 2 ? 1 : 0] : decorator;
      if (by && playing(board, by)) {
        by.pose = want <= 3 ? 'carry' : 'tend';
        by.poseUntil = board.now + 1.2;
      }
    }
    // The decorator steps up to its front for the face and the hat; the rest cheer and clap.
    for (const pl of ring) {
      if (rolling.some((r) => r.who === pl) && k < stageAt[2]!) continue;
      if (pl === decorator && k >= stageAt[2]! - 0.04 && k < 0.95) {
        const fx = c.x, fz = c.z + 0.3;
        if (walkTo(pl, fx, fz, dt)) {
          face(pl.p, c.x, c.z);
          pose(pl, 'tend', board);
        }
        continue;
      }
      if (rolling.some((r) => r.who === pl)) {
        if (walkTo(pl, pl.spot.x, pl.spot.z, dt)) {
          face(pl.p, c.x, c.z);
          pose(pl, 'cheer', board);
        }
        continue;
      }
      face(pl.p, c.x, c.z);
      pose(pl, k > 0.9 ? 'cheer' : pl.p.child ? 'hop' : 'clap', board);
    }
  };

  // ── the fight ───────────────────────────────────────────────────────────
  const toSides = (board: Board): void => {
    for (const pl of players) {
      if (pl.lost || board.plans.get(pl.p)?.chain !== chain) continue;
      const post = pl.side === 'a' ? sides.a! : sides.b!;
      const c = board.centre(post.cell);
      const same = players.filter((q) => q.side === pl.side);
      const i = same.indexOf(pl);
      const across = (i - (same.length - 1) / 2) * 0.22;
      const back = (i % 2) * 0.16 - 0.08;
      // Across the line between the sides (the cell's other way), a little back and forth.
      const ac = board.centre(man!.cell);
      const dx = Math.sign(ac.x - c.x), dz = Math.sign(ac.z - c.z);
      pl.spot = { x: c.x - dz * across - dx * back, z: c.z + dx * across - dz * back };
      const plan = board.plans.get(pl.p)!;
      plan.steps.splice(plan.at, 0, holdAt(board, pl, post.cell, 'snow:fight'));
      pl.p.timer = Math.min(pl.p.timer, 0.2 + i * 0.3);
      for (const r of rolling) r.h?.release();
      rolling = [];
    }
  };

  /** When each side's fort goes up (the first of them there packs it, kneeling). */
  const fortAt: Record<'a' | 'b', number> = { a: Infinity, b: Infinity };
  const stepFight = (board: Board, dt: number): void => {
    const c = centre(board);
    const on = players.filter((pl) => playing(board, pl, 'snow:fight'));
    for (const side of ['a', 'b'] as const) {
      const post = side === 'a' ? sides.a : sides.b;
      if (!post) continue;
      const first = on.find((pl) => pl.side === side && Math.hypot(pl.p.x - pl.spot.x, pl.p.z - pl.spot.z) < 0.02);
      if (fortAt[side] === Infinity && first) {
        fortAt[side] = board.now + 1.8;
        first.pose = 'tend';
        first.poseUntil = fortAt[side];
      } else if (board.now >= fortAt[side]) {
        putFort(board, post);
        fortAt[side] = -Infinity;
      }
    }
    for (const pl of on) {
      if (walkTo(pl, pl.spot.x, pl.spot.z, dt)) {
        face(pl.p, c.x, c.z);
        pose(pl, 'ready', board);
      }
    }
    for (const side of ['a', 'b'] as const) {
      if (board.now < nextThrow[side]) continue;
      const mine = on.filter((pl) => pl.side === side && board.now >= pl.poseUntil);
      const theirs = on.filter((pl) => pl.side !== side);
      if (mine.length === 0 || theirs.length === 0 || balls.length >= 3 || fortAt.a !== -Infinity || fortAt.b !== -Infinity) continue;
      nextThrow[side] = board.now + SNOW_DAY.throwEvery * (0.7 + rand(board.seed, 'throw', side, thrown) * 0.8);
      const who = mine[Math.floor(rand(board.seed, 'thrower', side, thrown) * mine.length)]!;
      const to = theirs[Math.floor(rand(board.seed, 'target', side, thrown) * theirs.length)]!;
      // A stoop to scoop it up, then the throw.
      who.pose = 'tend';
      who.poseUntil = board.now + 0.45;
      face(who.p, to.p.x, to.p.z);
      balls.push({ x0: who.p.x, y0: who.p.y + 0.36, z0: who.p.z, to, t: -0.45 / SNOW_DAY.flight, h: null });
      const b = balls[balls.length - 1]!;
      b.h = board.stage ? board.stage.spawnMesh(snowballMesh(), place(b.x0, b.y0 - 2, b.z0, 0, BALL, BALL, BALL)) : null;
      b.h?.setVisible(false);
      thrown++;
      const thrower = who;
      // (The throw pose follows the stoop.)
      setTimeoutLike(board, 0.45, () => {
        thrower.pose = 'shoot';
        thrower.poseUntil = board.now + 0.5;
        thrower.p.poseTime = 0;
      });
    }
    for (let i = balls.length - 1; i >= 0; i--) {
      const b = balls[i]!;
      b.t += dt / SNOW_DAY.flight;
      if (b.t < 0) continue;
      const k = Math.min(1, b.t);
      const tx = b.to.p.x, ty = b.to.p.y + 0.3, tz = b.to.p.z;
      const x = b.x0 + (tx - b.x0) * k, z = b.z0 + (tz - b.z0) * k, y = b.y0 + (ty - b.y0) * k + Math.sin(k * Math.PI) * ARC;
      b.h?.setVisible(true);
      b.h?.setMatrix(place(x, y, z, 0, BALL, BALL, BALL));
      if (k >= 1) {
        // Splat: a white puff, and a jump.
        puff(board, tx, ty, tz, 4, 0.26);
        b.h?.release();
        balls.splice(i, 1);
        if (playing(board, b.to)) {
          b.to.pose = 'hop';
          b.to.poseUntil = board.now + 0.5;
        }
      } else if (k > 0.5 && board.now >= b.to.poseUntil && rand(b.to.p.seed, 'duck', thrown) < 0.35 && playing(board, b.to)) {
        // Ducking down behind the fort (it bursts on the wall all the same).
        b.to.pose = 'tend';
        b.to.poseUntil = board.now + 0.7;
      }
    }
    // Others cheer their side's hits now and then.
    for (const pl of on) if (pl.p.pose === 'ready' && rand(pl.p.seed, 'cheer', Math.floor(board.now * 2)) < 0.04) {
      pl.pose = 'cheer';
      pl.poseUntil = board.now + 0.8;
    }
  };

  /** Small delayed actions (the throw after the stoop), run on life time. */
  const later: { at: number; run: () => void }[] = [];
  const setTimeoutLike = (board: Board, s: number, run: () => void): void => void later.push({ at: board.now + s, run });

  const melt = (board: Board): void => {
    const thawing = board.weather.cover < SNOW_DAY.melt;
    for (let i = forts.length - 1; i >= 0; i--) {
      const f = forts[i]!;
      if (thawing && f.melting === Infinity) {
        f.melting = board.now;
        f.h?.release();
        f.h = board.stage ? board.stage.spawnMesh(fortMesh(true), place(f.x, f.y, f.z, f.yaw)) : null;
      } else if (f.melting !== Infinity && board.now - f.melting > SNOW_DAY.melting) {
        puff(board, f.x, f.y + 0.04, f.z, 3, 0.2);
        f.h?.release();
        forts.splice(i, 1);
      }
    }
    for (let i = snowmen.length - 1; i >= 0; i--) {
      const s = snowmen[i]!;
      if (s === building) continue;
      if (thawing && s.melting === Infinity) {
        s.melting = board.now;
        s.stage = -1;
        drawMan(board, s);
      } else if (s.melting !== Infinity && board.now - s.melting > SNOW_DAY.melting) {
        puff(board, s.x, s.y + 0.08, s.z, 3, 0.2);
        s.h?.release();
        snowmen.splice(i, 1);
      }
    }
  };

  const trouble = (board: Board): boolean => {
    if (!board.stage || !man) return false;
    const d = mischiefOf(board.stage);
    const c = centre(board);
    return d.bombs.some((b) => b.nuke || Math.hypot(b.point[0] - c.x, b.point[2] - c.z) < 12) || d.threats.some((t) => Math.hypot(t.x - c.x, t.z - c.z) < 10);
  };

  const chain: SnowDayChain = {
    id: 'snow',
    get phase() {
      return phase;
    },
    get days() {
      return days;
    },
    get players() {
      return players;
    },
    get snowmen() {
      return snowmen;
    },
    get thrown() {
      return thrown;
    },
    get flying() {
      return balls.length;
    },
    get forts() {
      return forts.length;
    },
    begin,
    sync(board) {
      const posts = board.posts('snow');
      const was = man?.cell;
      man = posts.find((p) => p.role === 'man');
      sides = { a: posts.find((p) => p.role === 'side' && p.ref === 'a'), b: posts.find((p) => p.role === 'side' && p.ref === 'b') };
      if (phase !== 'none' && (!man || !sides.a || !sides.b || man.cell !== was)) finish(board, true);
      if (!man || man.cell !== was) {
        for (const f of forts) {
          puff(board, f.x, f.y + 0.05, f.z, 2, 0.2);
          f.h?.release();
        }
        forts.length = 0;
      }
      // Snowmen on ground that is gone (or now somewhere else) go with a puff.
      for (let i = snowmen.length - 1; i >= 0; i--) {
        const s = snowmen[i]!;
        const c = man ? board.centre(man.cell) : null;
        if (c && Math.hypot(c.x - s.x, c.z - s.z) < 0.3 && Math.abs(c.y - s.y) < 0.1) continue;
        puff(board, s.x, s.y + 0.1, s.z, 3, 0.2);
        s.h?.release();
        snowmen.splice(i, 1);
      }
    },
    step(dt, time, board) {
      for (let i = later.length - 1; i >= 0; i--) if (board.now >= later[i]!.at) later.splice(i, 1)[0]!.run();
      melt(board);
      const snowy = board.weather.cover >= SNOW_DAY.cover;
      if (snowy && snowSince < 0) {
        snowSince = board.now;
        next = Math.min(next, board.now + SNOW_DAY.first + rand(board.seed, 'snow-first', days) * SNOW_DAY.firstSpread);
      } else if (!snowy) snowSince = -1;
      if (phase === 'none') {
        if (snowy && time.isDay && board.weather.rain < 0.1 && board.now >= next && man && scenesOf(board).may('snow')) {
          if (!begin(board)) next = board.now + 30;
        }
        return;
      }
      t += dt;
      if (board.now >= checkAt) {
        checkAt = board.now + 0.5;
        if (trouble(board)) {
          finish(board, true);
          return;
        }
      }
      // Too few left (called away by something else): over.
      if (players.filter((pl) => !pl.lost).length < 2 || !time.isDay && phase === 'gather') {
        finish(board, true);
        return;
      }
      if (phase === 'gather') {
        const there = players.filter((pl) => playing(board, pl, 'snow:ring')).length;
        const all = players.filter((pl) => !pl.lost).length;
        for (const pl of players) if (playing(board, pl, 'snow:ring')) {
          const c = centre(board);
          face(pl.p, c.x, c.z);
          pose(pl, pl.p.child ? 'hop' : 'stand', board);
        }
        if ((there >= all && t > 3) || (t > SNOW_DAY.gather && there >= 2)) {
          t = 0;
          phase = standing(board) ? 'fight' : 'build';
          if (phase === 'fight') toSides(board);
        } else if (t > SNOW_DAY.gather + 20) finish(board, true);
      } else if (phase === 'build') {
        stepBuild(board, dt);
        if (t >= SNOW_DAY.build) {
          phase = 'fight';
          t = 0;
          building = null;
          toSides(board);
        }
      } else if (phase === 'fight') {
        stepFight(board, dt);
        if (t >= SNOW_DAY.fight + 6) finish(board, false);
      }
    },
    offer(p, _time, board) {
      // Somebody of the fight with nothing to do now: home.
      const pl = players.find((x) => x.p === p);
      if (!pl && board.claimedBy(p) === chain) {
        board.unclaim(p);
        return homePlan(board, p);
      }
      return null;
    },
    dispose(board) {
      if (phase !== 'none') finish(board, true);
      for (const s of snowmen) s.h?.release();
      snowmen.length = 0;
      for (const f of forts) f.h?.release();
      forts.length = 0;
    },
  };
  return chain;
}
