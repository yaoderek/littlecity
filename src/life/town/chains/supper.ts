// L65 · A harvest supper on the square (posts from L65.supper.rule.ts). In
// autumn, late in the day, the town sets a long table down the middle of the
// square and sits down to supper under a string of lanterns that glow as the
// light goes.
//
//   setup    a grown-up for each table cell carries a table top on the
//            shoulder and sets it down (a puff, and a trestle table with a
//            white cloth and benches is there); somebody brings a pole hung
//            with lanterns and puts the poles up at the two ends (the string
//            of lanterns goes up over the table); the guests come in ones and
//            twos, each with something for the table (a loaf, a basket of
//            vegetables, a tray of buns, a fish), set it down before their
//            place and sit
//   supper   they sit four to a table cell, talking (a squiggle over one head
//            and then another); partway through, everybody stands and raises
//            a toast, then sits again
//   pack     each takes their dish back up and goes home; the tables are
//            carried away, the lanterns taken down and carried home
//
// With the time of day running it starts SUPPER.startLeft seconds before the
// end of the day, once a day, so it goes on into dusk; with the time held (at
// day or dusk) one comes every SUPPER.every seconds. Rain packs it up at once;
// the square erased takes the tables with a puff and sends everybody home.
//
// Cost per step: a few comparisons per diner; a handful of instances (a table
// a cell, the lanterns, a dish a place) placed once.

import { phrase } from '@/core/phrase';
import { DIR4 } from '@/core/grid';
import { rand } from '@/core/rand';
import type { InstanceHandle } from '@/life/api';
import type { Load } from '@/parts/people/loads';
import { restingMesh } from '@/parts/people/loads';
import { lanternsMesh, tableMesh, TABLE } from '@/parts/people/supper';
import { SUPPER } from '@/style/scenes';
import { TIME } from '@/style/time';
import { fxOf } from '../../fx/fx';
import { mischiefOf } from '../../mischief/director';
import { place } from '../../motion/pose';
import type { Person } from '../../people/crowd';
import { partPhases } from '../../signals';
import { type Board, type Chain, type Plan, type PlanStep, type Post } from '../board';
import { canWork, homeCell, reaches, unbusy } from '../hands';
import { scenesOf, type Scene } from '../scenes';

export type SupperPhase = 'none' | 'setup' | 'supper' | 'pack';
type Role = 'table' | 'lamps' | 'guest';
const DISHES: readonly Load[] = ['loaf', 'basket', 'tray', 'fishes', 'loaf', 'basket'];

interface Diner {
  p: Person;
  role: Role;
  /** The table cell (index) and the place at it: along (−1 or 1) and side (−1 or 1). */
  table: number;
  along: number;
  side: number;
  dish: Load | null;
  /** Their dish on the table, once set down. */
  plate: InstanceHandle | null;
  /** 'coming', 'setting' (putting their thing down), 'seated', 'gone'. */
  state: 'coming' | 'setting' | 'seated' | 'gone';
  t: number;
  lost: boolean;
}

interface Table {
  post: Post;
  h: InstanceHandle | null;
}

export interface SupperChain extends Chain {
  readonly phase: SupperPhase;
  readonly held: number;
  readonly diners: readonly Diner[];
  readonly tablesUp: number;
  readonly lanterns: boolean;
  /** Toasts raised so far. */
  readonly toasts: number;
  begin(board: Board): boolean;
}

const loopSeconds = (): number => TIME.day + TIME.dusk + TIME.night + TIME.dawn;

export function supperChain(): SupperChain {
  let posts: Post[] = [];
  let phase: SupperPhase = 'none';
  let t = 0;
  let held = 0;
  let next = Infinity;
  let seen = -1;
  let lastPhase = -1;
  let today = false;
  let diners: Diner[] = [];
  let tables: Table[] = [];
  let lights: InstanceHandle | null = null;
  let poles = 0;
  let seatedAt = Infinity;
  let toasted = false;
  let toasts = 0;
  let scene: Scene | null = null;
  let reassigning = false;

  const puff = (board: Board, x: number, y: number, z: number, n = 3): void => {
    if (!board.stage) return;
    for (let i = 0; i < n; i++) {
      const a = i * 2.1 + x;
      fxOf(board.stage).play({ actor: 'puff', variant: 'dust' }, 0.5, (k, m) => place(x + Math.cos(a) * 0.18, y + 0.05 + k * 0.12, z + Math.sin(a) * 0.18, 0, 0.3 + k * 0.4, 0.3 + k * 0.4, 0.3 + k * 0.4, m), { delay: i * 0.06 });
    }
  };
  /** The run's way (along) and across it, from the posts' dir. */
  const axes = (): { ax: number; az: number; cx: number; cz: number } => {
    const [ax, az] = DIR4[posts[0]?.dir ?? 1]!;
    return { ax, az, cx: -az, cz: ax };
  };
  const yaw = (): number => {
    const { ax, az } = axes();
    return Math.atan2(-az, ax);
  };
  const seatSpot = (board: Board, d: Diner): { x: number; z: number; face: number } => {
    const c = board.centre(posts[d.table]!.cell);
    const { ax, az, cx, cz } = axes();
    const x = c.x + ax * d.along * 0.25 + cx * d.side * TABLE.sitAt, z = c.z + az * d.along * 0.25 + cz * d.side * TABLE.sitAt;
    return { x, z, face: Math.atan2(-cx * d.side, -cz * d.side) };
  };
  const putTable = (board: Board, i: number, on: boolean): void => {
    const tb = tables[i];
    if (!tb) return;
    const c = board.centre(tb.post.cell);
    if (on && !tb.h) {
      const end = tables.length === 1 ? 'both' : i === 0 ? 'start' : i === tables.length - 1 ? 'end' : 'none';
      tb.h = board.stage ? board.stage.spawnMesh(tableMesh(end), place(c.x, c.y, c.z, yaw())) : null;
      // A placeholder so tests (no stage) still count it as up.
      if (!board.stage) tb.h = { setMatrix() {}, setVisible() {}, setParams() {}, release() {} } as unknown as InstanceHandle;
      board.crowd.setCrowded(tb.post.cell, 30);
      puff(board, c.x, c.y, c.z);
    } else if (!on && tb.h) {
      tb.h.release();
      tb.h = null;
      board.crowd.setCrowded(tb.post.cell, 0);
      puff(board, c.x, c.y, c.z);
    }
  };
  const putLights = (board: Board, on: boolean): void => {
    const first = posts[0];
    if (!first) return;
    const c = board.centre(first.cell);
    if (on && !lights) {
      // The mesh runs along +X from the first cell's middle: turned to the run's way.
      lights = board.stage ? board.stage.spawnMesh(lanternsMesh(posts.length), place(c.x, c.y, c.z, yaw())) : ({ setMatrix() {}, setVisible() {}, setParams() {}, release() {} } as unknown as InstanceHandle);
      puff(board, c.x, c.y + 0.6, c.z, 2);
    } else if (!on && lights) {
      lights.release();
      lights = null;
      puff(board, c.x, c.y + 0.6, c.z, 2);
    }
  };
  const putPlate = (board: Board, d: Diner, on: boolean): void => {
    if (on && !d.plate && d.dish) {
      const c = board.centre(posts[d.table]!.cell);
      const { ax, az, cx, cz } = axes();
      const x = c.x + ax * d.along * 0.25 + cx * d.side * 0.08, z = c.z + az * d.along * 0.25 + cz * d.side * 0.08;
      d.plate = board.stage ? board.stage.spawnMesh(restingMesh(d.dish), place(x, c.y + TABLE.top + 0.004, z, yaw() + d.side, 0.62, 0.62, 0.62)) : ({ setMatrix() {}, setVisible() {}, setParams() {}, release() {} } as unknown as InstanceHandle);
    } else if (!on && d.plate) {
      d.plate.release();
      d.plate = null;
    }
  };

  const tablesUp = (): number => tables.filter((tb) => tb.h).length;

  const homeStep = (board: Board, p: Person, load: Load | null): PlanStep | null => board.homeStep(p, { tag: 'supper:home', linger: 0.5, load, done: (q) => void ((q.load = null), board.claimedBy(q) === chain && board.unclaim(q), (q.party = false)) });

  const begin = (board: Board): boolean => {
    if (phase !== 'none' || posts.length === 0 || !board.nav) return false;
    const target = posts[0]!.cell;
    const people = board.crowd.people.filter((p) => !p.shutIn && p.mode !== 'gone' && !p.leaving);
    const far = (p: Person): number => {
      const h = homeCell(board, p);
      return h === null ? Infinity : board.dist(h, target);
    };
    const free = people
      .filter((p) => unbusy(board, p) && !p.scuffle && !p.load && !p.party && reaches(board, p, target) && far(p) <= SUPPER.reach)
      .sort((a, b) => far(a) - far(b) || (a.id < b.id ? -1 : 1));
    const seats = posts.length * 4;
    const size = Math.min(seats, Math.max(4, Math.round(people.length * SUPPER.share)));
    const grown = free.filter(canWork);
    if (grown.length < posts.length + 1 || free.length < Math.min(size, posts.length + 2)) return false;
    const crew = [...grown.slice(0, posts.length + 1)];
    for (const p of free) if (crew.length < size && !crew.includes(p)) crew.push(p);
    tables = posts.map((post) => ({ post, h: null }));
    // Places: each table cell's four, filled from the middle of the run outward.
    const order = posts.map((_, i) => i).sort((a, b) => Math.abs(a - (posts.length - 1) / 2) - Math.abs(b - (posts.length - 1) / 2) || a - b);
    const places: { table: number; along: number; side: number }[] = [];
    for (const i of order) for (const [along, side] of [[-1, -1], [1, 1], [1, -1], [-1, 1]] as const) places.push({ table: i, along, side });
    diners = crew.map((p, k) => {
      const role: Role = k < posts.length ? 'table' : k === posts.length ? 'lamps' : 'guest';
      // A table's carrier sits at their own table.
      const pl = places[k]!;
      return { p, role, table: pl.table, along: pl.along, side: pl.side, dish: role === 'guest' ? DISHES[Math.floor(rand(p.seed, 'dish', held) * DISHES.length)]! : null, plate: null, state: 'coming', t: 0, lost: false };
    });
    // Carriers at their own table: give them its first place, and whoever had it theirs.
    for (let i = 0; i < posts.length; i++) {
      const d = diners[i]!;
      const other = diners.find((o) => o !== d && o.table === i && o.along === -1 && o.side === -1);
      if (d.table === i && d.along === -1 && d.side === -1) continue;
      const mine = { table: d.table, along: d.along, side: d.side };
      d.table = i;
      d.along = -1;
      d.side = -1;
      if (other) Object.assign(other, mine);
    }
    for (const d of diners) {
      const plan = dinerPlan(board, d);
      if (!plan) {
        d.lost = true;
        continue;
      }
      board.claim(d.p, chain);
      d.p.party = true;
      reassigning = true;
      board.assign(d.p, plan);
      reassigning = false;
      // In ones and twos: the tables first.
      d.p.timer = Math.min(d.p.timer, d.role === 'guest' ? 6 + rand(d.p.seed, 'supper-call', held) * 24 : rand(d.p.seed, 'supper-call', held) * 3);
    }
    phase = 'setup';
    t = 0;
    held++;
    poles = 0;
    seatedAt = Infinity;
    toasted = false;
    scene = scenesOf(board).begin({
      kind: 'supper',
      title: phrase('A harvest supper on the square'),
      big: true,
      focus: () => {
        const c = posts[Math.floor(posts.length / 2)];
        return c ? board.centre(c.cell) : null;
      },
      noteworthy: () => tablesUp() >= 2,
      gathering: () => false,
    });
    return true;
  };

  const dinerPlan = (board: Board, d: Diner): Plan | null => {
    const p = d.p;
    const seat = seatSpot(board, d);
    const cell = posts[d.table]!.cell;
    const load: Load | null = d.role === 'table' ? 'trestle' : d.role === 'lamps' ? 'lantern-pole' : d.dish;
    const steps: PlanStep[] = [];
    if (d.role === 'lamps') {
      // Up at each end: a pole at the first cell, then the last.
      const { ax, az } = axes();
      for (const [i, s] of [[0, -1], [posts.length - 1, 1]] as const) {
        const c = board.centre(posts[i]!.cell);
        steps.push(board.stepAt(posts[i]!.cell, { spot: { x: c.x + ax * s * 0.42, z: c.z + az * s * 0.42 }, face: NaN, pose: 'tend', linger: 1.6, load, tag: 'supper:pole', done: () => void (++poles >= 2 && putLights(board, true)) }));
      }
    }
    steps.push(board.stepAt(cell, { spot: { x: seat.x, z: seat.z }, face: seat.face, pose: 'tend', linger: 1e6, load: d.role === 'lamps' ? null : load, tag: 'supper:seat', done: (q) => {
      const me = diners.find((x) => x.p === q);
      if (me && me.state === 'coming') {
        me.state = 'setting';
        me.t = 0;
      }
    } }));
    const home = homeStep(board, p, null);
    if (!home) return null;
    steps.push(home);
    return { chain, at: 0, steps, fail: (q) => {
      if (reassigning) return;
      const me = diners.find((x) => x.p === q);
      if (me) {
        me.lost = true;
        me.state = 'gone';
      }
      q.party = false;
      q.seat = -1;
    } };
  };

  const atSeat = (board: Board, d: Diner): boolean => !d.lost && d.p.mode === 'linger' && board.plans.get(d.p)?.chain === chain && d.p.goal?.errand?.tag === 'supper:seat';
  const carry = (board: Board, p: Person): void => {
    const plan = board.plans.get(p);
    if (plan?.chain !== chain) return;
    for (let i = plan.at; i < plan.steps.length; i++) plan.steps[i]!.load = p.load;
  };

  /** Over (or called off): the tables are taken away by their carriers (or with a puff), the lanterns down, everybody home. */
  const finish = (board: Board, off: boolean): void => {
    for (const d of diners) {
      putPlate(board, d, false);
      const p = d.p;
      p.seat = -1;
      if (d.lost || d.state === 'gone') continue;
      d.state = 'gone';
      if (board.plans.get(p)?.chain === chain) {
        if (off) {
          const home = homeStep(board, p, p.load);
          reassigning = true;
          if (home) board.assign(p, { chain, at: 0, steps: [home] });
          else board.drop(p);
          reassigning = false;
        } else p.timer = Math.min(p.timer, 0.3 + rand(p.seed, 'supper-home', held) * 2);
      } else {
        p.party = false;
        if (board.claimedBy(p) === chain) board.unclaim(p);
      }
    }
    for (let i = 0; i < tables.length; i++) putTable(board, i, false);
    putLights(board, false);
    diners = diners.filter((d) => !d.lost && board.plans.get(d.p)?.chain === chain);
    phase = 'none';
    if (scene) scenesOf(board).end(scene);
    scene = null;
    next = board.now + SUPPER.every + rand(board.seed, 'supper-next', held) * SUPPER.everySpread;
  };

  const hold = (p: Person, pose: Person['pose'], seat = -1): void => {
    if (p.pose !== pose) {
      p.pose = pose;
      p.poseTime = 0;
    }
    p.seat = seat;
  };

  const stepDiners = (board: Board, dt: number): void => {
    for (const d of diners) {
      if (d.state === 'gone' || d.lost) continue;
      const p = d.p;
      if (d.state === 'coming') {
        const plan = board.plans.get(p);
        if (plan && plan.chain !== chain) {
          d.lost = true;
          d.state = 'gone';
          p.party = false;
        }
        continue;
      }
      if (!atSeat(board, d)) {
        if (board.plans.get(p)?.chain !== chain) {
          d.lost = true;
          d.state = 'gone';
          p.party = false;
          p.seat = -1;
        }
        continue;
      }
      const seat = seatSpot(board, d);
      if (d.state === 'setting') {
        d.t += dt;
        p.heading = seat.face;
        // A guest waits for the table to be up before setting their dish on it.
        if (d.role === 'guest' && !tables[d.table]?.h) {
          hold(p, 'stand');
          d.t = 0;
          continue;
        }
        hold(p, 'tend');
        if (d.t < 1.5) continue;
        if (d.role === 'table') putTable(board, d.table, true);
        else if (d.role === 'guest') putPlate(board, d, true);
        p.load = null;
        carry(board, p);
        d.state = 'seated';
        continue;
      }
      // Seated: a toast, or talk.
      p.heading = seat.face;
      if (phase === 'supper' && board.now - seatedAt > SUPPER.toast && board.now - seatedAt < SUPPER.toast + 3.5) {
        hold(p, 'cheer');
        continue;
      }
      hold(p, 'sit', TABLE.bench);
      // Taking turns to talk: one or two at a table at a time.
      const turn = Math.floor((board.now + d.table * 1.7 + (d.side + 1) * 0.9 + (d.along + 1) * 2.3) / 2.2);
      p.bubble = phase === 'supper' && rand(p.seed, 'talk', turn) < 0.18;
    }
  };

  const trouble = (board: Board): boolean => {
    if (!board.stage || posts.length === 0) return false;
    const c = board.centre(posts[0]!.cell);
    const d = mischiefOf(board.stage);
    return d.bombs.some((b) => b.nuke || Math.hypot(b.point[0] - c.x, b.point[2] - c.z) < 12) || d.threats.some((t) => Math.hypot(t.x - c.x, t.z - c.z) < 10);
  };

  const chain: SupperChain = {
    id: 'supper',
    get phase() {
      return phase;
    },
    get held() {
      return held;
    },
    get diners() {
      return diners;
    },
    get tablesUp() {
      return tablesUp();
    },
    get lanterns() {
      return lights !== null;
    },
    get toasts() {
      return toasts;
    },
    begin,
    sync(board) {
      const was = posts.map((p) => p.cell).join(',');
      posts = [...board.posts('supper')].filter((p) => p.role === 'table').sort((a, b) => Number(a.ref) - Number(b.ref));
      if (phase !== 'none' && posts.map((p) => p.cell).join(',') !== was) finish(board, true);
    },
    step(dt, time, board) {
      if (seen < 0) {
        seen = board.now;
        next = board.now + SUPPER.first;
      }
      const moving = lastPhase >= 0 && time.phase !== lastPhase;
      lastPhase = time.phase;
      if (time.isNight || time.isDawn) today = false;
      if (phase === 'none') {
        const autumn = board.season.weights.autumn >= SUPPER.autumn && board.weather.rain < 0.05 && board.weather.snow <= 0;
        if (!autumn || posts.length === 0) return;
        let due: boolean;
        if (moving) {
          const left = (partPhases().day.end - time.phase) * loopSeconds();
          due = time.isDay && !today && left <= SUPPER.startLeft && left > SUPPER.startLeft - 40;
        } else due = (time.isDay || time.isDusk) && board.now >= next;
        if (due && scenesOf(board).may('supper')) {
          if (begin(board)) today = true;
          else next = board.now + 30;
        }
        return;
      }
      t += dt;
      if (board.weather.rain > 0.2 || trouble(board)) {
        finish(board, true);
        return;
      }
      stepDiners(board, dt);
      const live = diners.filter((d) => !d.lost && d.state !== 'gone');
      if (live.length < 2) {
        finish(board, true);
        return;
      }
      if (phase === 'setup') {
        const seated = live.filter((d) => d.state === 'seated').length;
        if ((tablesUp() === tables.length && seated >= live.length * 0.75 && t > 10) || t > SUPPER.setup) {
          // Tables nobody brought are not there; with none up it is off.
          if (tablesUp() === 0) {
            finish(board, true);
            return;
          }
          if (!lights) putLights(board, true);
          phase = 'supper';
          t = 0;
          seatedAt = board.now;
        }
      } else if (phase === 'supper') {
        if (!toasted && board.now - seatedAt > SUPPER.toast) {
          toasted = true;
          toasts++;
        }
        if (t > SUPPER.supper) {
          phase = 'pack';
          t = 0;
          // Each takes up what they brought: the dish, the table, the lanterns.
          for (const d of live) {
            putPlate(board, d, false);
            d.p.bubble = false;
            if (d.role === 'table') putTable(board, d.table, false);
            if (d.role === 'lamps') putLights(board, false);
            d.p.load = d.role === 'table' ? 'trestle' : d.role === 'lamps' ? 'lantern-pole' : d.dish;
            d.p.seat = -1;
            hold(d.p, 'tend');
            carry(board, d.p);
          }
        }
      } else if (phase === 'pack') {
        if (t > 1.6) finish(board, false);
      }
    },
    offer(p, _time, board) {
      if (board.claimedBy(p) === chain && !diners.some((d) => d.p === p && !d.lost && d.state !== 'gone')) {
        board.unclaim(p);
        p.party = false;
        const home = homeStep(board, p, p.load);
        return home ? { chain, at: 0, steps: [home] } : null;
      }
      return null;
    },
    dispose(board) {
      if (phase !== 'none') finish(board, true);
    },
  };
  return chain;
}

export type { Diner as SupperDiner };
