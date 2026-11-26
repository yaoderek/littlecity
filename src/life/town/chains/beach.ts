// L63 · A beach day (posts from L63.beach.rule.ts). In summer, in fair
// weather, by day, families walk down to the beach with their things, set up
// a row of striped parasols along the shore, and spend a good while there:
// lying on towels, reading in deckchairs, asleep with a hat over the face,
// paddling, swimming out and back, building sandcastles, throwing a ball.
// When the sun gets low (or the time comes) they pack up and walk home; when
// it rains they grab their things and run, towels over their heads.
//
//   called   a family (one household: a grown-up and whoever of their house is
//            free, children first) is called in, the farthest first, in ones
//            and twos over BEACH.call seconds. Each goes home to change (anyone
//            at home changes there) and comes out in beach clothes carrying
//            their part of the kit: the parasol (a towel rolled round its
//            foot), a folded deckchair, a basket, a child's pail and spade or
//            a beach ball
//   setup    at their pitch on the sand: the parasol is planted (a puff of
//            sand, and it is up), the towel unrolled and laid, the chair
//            opened, the basket and the pail set down
//   stay     each does one thing at a time and changes now and then
//            (BEACH.act): grown-ups lie on the towel, sleep with the sun hat
//            over the face, lounge or read in the deckchair, paddle at the
//            water's edge, or swim out and back (they walk down into the
//            water and swim, a ripple each stroke); children dig a sandcastle
//            (it grows from a heap to a keep with towers, a moat and a flag),
//            paddle, and throw the ball to each other high over the sand
//   pack     the day is over (BEACH.stay after setting up; with the time of
//            day running, BEACH.packAt seconds before the end of the day):
//            each goes to their thing, folds it and picks it up, and they
//            walk home and change back
//   dash     it rains (BEACH.rain), or a bomb falls near: everything is
//            grabbed in a hurry, towels go over heads (the parasol goes up as
//            an umbrella) and they hurry home
//
// Sandcastles stay where they were built until the sea takes them
// (BEACH.castle seconds, sooner in rain: they slump, then go in a puff of
// sand) or a child of another family knocks one down.
//
// Things are never left floating or vanish in view: a thing is in somebody's
// hands or set down at its pitch. A thing whose owner was called away (a fire,
// the wedding) lies there until somebody of that house (later anybody) comes
// to fetch it. The beach erased takes its things with a puff, as a store's are.
//
// Cost per step: a few comparisons per bather, a matrix per swimmer and per
// flying ball; the things are a few instances per pitch, placed once.

import { phrase } from '@/core/phrase';
import { CELL_H, DIR4, keyX, keyZ, SEA_Y, type CellKey } from '@/core/grid';
import { rand } from '@/core/rand';
import { compose, rotationY, translation } from '@/core/mat4';
import type { InstanceHandle } from '@/life/api';
import { ballMesh, castleMesh, CANVAS_COLOURS, deckchairMesh, hamperMesh, pailMesh, parasolMesh, swimmerMesh, towelMesh, DECKCHAIR, type CastleStage } from '@/parts/people/beach';
import { costumeColour, inCostume, isBeachWear, sunHat } from '@/parts/people/beachwear';
import { lookOf } from '@/parts/people/person';
import { BEACH_LOADS, type Load } from '@/parts/people/loads';
import type { PoseName } from '@/parts/people/pose';
import { PERSON } from '@/style/people';
import { BEACH, BEACH_COLOURS } from '@/style/scenes';
import { TIME } from '@/style/time';
import { wakeRing } from '../../boats/afloat';
import { fxOf } from '../../fx/fx';
import { mischiefOf } from '../../mischief/director';
import { place } from '../../motion/pose';
import type { Person } from '../../people/crowd';
import { partPhases } from '../../signals';
import { DIR_HEADING, type Board, type Chain, type Plan, type PlanStep, type Post } from '../board';
import { canWork, homeCell, reaches, unbusy } from '../hands';
import { scenesOf, type Scene } from '../scenes';

type Role = 'parasol' | 'chair' | 'hamper' | 'pail' | 'ball';
type ThingKind = 'parasol' | 'towel' | 'chair' | 'hamper' | 'pail' | 'ball';
type Act = 'idle' | 'lie' | 'sleep' | 'lounge' | 'read' | 'sit' | 'paddle' | 'swim' | 'look' | 'dig' | 'ball';
type State = 'called' | 'coming' | 'setup' | 'stay' | 'pack' | 'gone';

/** Where things are in a pitch: `a` toward the water, `b` across (cell units from the cell's middle). */
const AT: Record<ThingKind | 'castle' | 'dig' | 'lieOn' | 'sitIn' | 'sand' | 'ball2', [number, number]> = {
  parasol: [-0.16, 0.02],
  towel: [0.06, -0.22],
  lieOn: [0.13, -0.22],
  chair: [0.02, 0.24],
  sitIn: [0.05, 0.24],
  hamper: [-0.36, 0.36],
  sand: [-0.22, 0.4],
  pail: [0.38, -0.02],
  castle: [0.3, 0.17],
  dig: [0.16, 0.17],
  ball: [0.4, -0.38],
  ball2: [0.4, 0.4],
};
/** How far past the middle of the cell the water's edge is drawn (the beach slopes in past the cell's edge: TERRAIN.beachRun). */
const SHALLOWS = 0.74;

interface Thing {
  kind: ThingKind;
  /** World position and heading (facing the water). */
  x: number;
  y: number;
  z: number;
  yaw: number;
  h: InstanceHandle | null;
  /** Whose it is to pack (null: nobody now: it waits to be fetched); and who is on their way to fetch it. */
  owner: Bather | null;
  fetcher: Person | null;
  /** Life seconds since it has had no owner. */
  orphaned: number;
}

interface Castle {
  x: number;
  y: number;
  z: number;
  stage: CastleStage;
  h: InstanceHandle | null;
  /** Digging so far on the current stage, seconds; when its builder left (Infinity while being built); when it slumped. */
  dug: number;
  left: number;
  slumped: number;
  pitch: Pitch | null;
  /** Lasts this long after its builder left (seeded). */
  lasts: number;
}

interface Bather {
  p: Person;
  pitch: Pitch;
  role: Role;
  load: Load;
  state: State;
  /** Seconds in the state (and the step of it: setup and pack have two). */
  t: number;
  stage: number;
  calls: number;
  act: Act;
  actUntil: number;
  /** Walking within the pitch to (x, z); then `arrive` there. */
  to: { x: number; z: number; face: number } | null;
  /** Swimming: 0 → 1 there and back, and the swimmer's drawings. */
  swim: number;
  swimmer: InstanceHandle[] | null;
  ringAt: number;
  lost: boolean;
  /** In the rain: hurry. */
  hurry: boolean;
}

interface Pitch {
  post: Post;
  beach: number;
  colour: number;
  home: number;
  /** Toward the water, and across. */
  fx: number;
  fz: number;
  rx: number;
  rz: number;
  cx: number;
  cy: number;
  cz: number;
  bathers: Bather[];
  things: Thing[];
  /** The ball in the air: thrown from one to the other. */
  ball: { from: Bather; to: Bather; t: number; h: InstanceHandle | null } | null;
}

interface Day {
  beach: number;
  scene: Scene | null;
  pitches: Pitch[];
  began: number;
  /** Life seconds at which they pack up (once everybody is set up). */
  until: number;
  mode: 'on' | 'pack' | 'dash';
}

export interface BeachChain extends Chain {
  /** Beach days begun, and the ones on now. */
  readonly days: number;
  readonly on: readonly Day[];
  /** Everybody at the beach now. */
  readonly bathers: readonly Bather[];
  readonly castles: readonly Castle[];
  /** Things set down on the sand now. */
  readonly things: number;
  /** Starts a beach day now on a beach (0 the biggest) if there is not one on there (fixtures, sequences). */
  begin(board: Board, beach?: number): boolean;
  /** Sends everybody home now (as when the time is up). */
  packUp(board: Board): void;
}

function loopSeconds(): number {
  return TIME.day + TIME.dusk + TIME.night + TIME.dawn;
}

/** Fair weather in summer: what a beach day needs to start. */
export function beachWeather(board: Board): boolean {
  const w = board.weather;
  return board.season.weights.summer >= BEACH.summer && w.rain < 0.05 && w.snow <= 0 && w.cloud <= BEACH.cloud;
}

export function beachChain(): BeachChain {
  let posts: readonly Post[] = [];
  const days = new Map<number, Day>();
  const next = new Map<number, number>();
  const bathers = new Map<Person, Bather>();
  const castles: Castle[] = [];
  /** Everybody in beach clothes not yet changed back (they change at home). */
  const dressed = new Set<Person>();
  /** Things left lying with nobody to pack them, by pitch cell (the pitch may have ended). */
  const orphans: { pitch: Pitch; thing: Thing }[] = [];
  let begun = 0;
  let seen = -1;
  let lastPhase = -1;
  let moving = false;
  let checkAt = 0;
  /** Set while this chain itself ends a bather's plan to give them another. */
  let reassigning = false;

  const puff = (board: Board, x: number, y: number, z: number, n = 2, white = false): void => {
    if (!board.stage) return;
    for (let i = 0; i < n; i++) {
      const a = i * 2.4 + x * 3;
      fxOf(board.stage).play({ actor: 'puff', variant: white ? 'smoke' : 'dust' }, 0.45, (k, m) => place(x + Math.cos(a) * 0.08, y + 0.03 + k * 0.1, z + Math.sin(a) * 0.08, 0, 0.18 + k * 0.3, 0.18 + k * 0.3, 0.18 + k * 0.3, m), { delay: i * 0.05 });
    }
  };

  const spot = (pi: Pitch, a: number, b: number): { x: number; z: number } => ({ x: pi.cx + pi.fx * a + pi.rx * b, z: pi.cz + pi.fz * a + pi.rz * b });
  const seaward = (pi: Pitch): number => Math.atan2(pi.fx, pi.fz);

  const meshOf = (kind: ThingKind, pi: Pitch): Parameters<NonNullable<Board['stage']>['spawnMesh']>[0] => {
    switch (kind) {
      case 'parasol':
        return parasolMesh(pi.colour);
      case 'towel':
        return towelMesh(pi.colour + Math.floor(rand(pi.home, 'towel') * 6));
      case 'chair':
        return deckchairMesh(pi.colour);
      case 'hamper':
        return hamperMesh();
      case 'pail':
        return pailMesh(pi.colour % 4);
      case 'ball':
        return ballMesh();
    }
  };
  /** What a thing is carried as. */
  const carryOf = (kind: ThingKind, pi: Pitch, rain: boolean): Load => {
    const c = pi.colour as 0 | 1 | 2 | 3 | 4 | 5;
    switch (kind) {
      case 'parasol':
      case 'towel':
        return rain ? `parasol-open-${c}` : `parasol-${c}`;
      case 'chair':
        return `deckchair-${c}`;
      case 'hamper':
        return 'hamper';
      case 'pail':
        return `pail-${(c % 4) as 0 | 1 | 2 | 3}`;
      case 'ball':
        return 'beachball';
    }
  };

  const putDown = (board: Board, pi: Pitch, kind: ThingKind, owner: Bather | null): Thing => {
    const [a, b] = AT[kind];
    const s = spot(pi, a, b);
    // A towel lies along the way the water is; a ball sits on the sand (its middle a radius up).
    const y = pi.cy + (kind === 'ball' ? 0.06 : 0);
    const yaw = seaward(pi);
    const t: Thing = { kind, x: s.x, y, z: s.z, yaw, h: null, owner, fetcher: null, orphaned: 0 };
    if (board.stage) t.h = board.stage.spawnMesh(meshOf(kind, pi), place(t.x, t.y, t.z, yaw));
    pi.things.push(t);
    puff(board, t.x, pi.cy, t.z, kind === 'parasol' ? 3 : 2);
    return t;
  };
  const pickUp = (board: Board, pi: Pitch, t: Thing): void => {
    t.h?.release();
    t.h = null;
    const i = pi.things.indexOf(t);
    if (i >= 0) pi.things.splice(i, 1);
    const o = orphans.findIndex((x) => x.thing === t);
    if (o >= 0) orphans.splice(o, 1);
    puff(board, t.x, pi.cy, t.z, 2);
  };

  // ── clothes ─────────────────────────────────────────────────────────────
  const dress = (p: Person): void => {
    p.costume = 'bather';
    dressed.add(p);
  };
  const undress = (board: Board, p: Person): void => {
    if (isBeachWear(p.costume)) p.costume = null;
    // In at their own door: the beach things are put away inside.
    if (p.load && (BEACH_LOADS as readonly string[]).includes(p.load)) p.load = null;
    dressed.delete(p);
    const b = bathers.get(p);
    if (b) {
      b.state = 'gone';
      bathers.delete(p);
    }
    p.party = false;
    p.seat = -1;
    if (board.claimedBy(p) === chain) board.unclaim(p);
  };
  const homePlan = (board: Board, p: Person, brisk = false): Plan | null => {
    const home = board.homeStep(p, { tag: 'beach:home', linger: 0.5, load: p.load, ...(brisk ? { brisk: true } : {}), done: (q) => void undress(board, q) });
    return home ? { chain, at: 0, steps: [home] } : null;
  };
  const sendHome = (board: Board, p: Person, brisk = false): void => {
    resetBody(p);
    const plan = homePlan(board, p, brisk);
    reassigning = true;
    if (plan) board.assign(p, plan);
    else board.drop(p);
    reassigning = false;
  };
  /** Back on their feet, not sitting, the hat off their face: as the crowd expects anybody who walks off. */
  const resetBody = (p: Person): void => {
    p.seat = -1;
    p.lift = 0;
    p.drawX = p.drawZ = 0;
    if (p.costume === 'bather-face') p.costume = 'bather';
  };

  // ── the day ─────────────────────────────────────────────────────────────
  const pitchesOf = (beach: number): Post[] => posts.filter((p) => p.role === 'pitch' && Number(p.ref) === beach);
  const beachesNow = (): number[] => [...new Set(posts.filter((p) => p.role === 'pitch').map((p) => Number(p.ref)))].sort((a, b) => a - b);

  const makePitch = (board: Board, post: Post, beach: number, home: number, k: number): Pitch => {
    const c = board.centre(post.cell);
    const [fx, fz] = DIR4[post.dir ?? 0]!;
    return {
      post,
      beach,
      colour: Math.floor(rand(board.seed, 'parasol', home, begun, k) * CANVAS_COLOURS),
      home,
      fx,
      fz,
      rx: -fz,
      rz: fx,
      cx: c.x,
      cy: c.y,
      cz: c.z,
      bathers: [],
      things: [],
      ball: null,
    };
  };

  const begin = (board: Board, beach = beachesNow()[0] ?? 0): boolean => {
    if (days.has(beach) || !board.nav) return false;
    const pitches = pitchesOf(beach);
    if (pitches.length === 0) return false;
    const target = pitches[0]!.cell;
    const people = board.crowd.people.filter((p) => !p.shutIn && p.mode !== 'gone' && !p.leaving);
    const already = [...bathers.values()].filter((b) => !b.lost).length;
    let room = Math.max(0, Math.floor(people.length * BEACH.share) - already);
    const free = (p: Person): boolean => !p.shutIn && !p.leaving && p.mode !== 'gone' && unbusy(board, p) && !p.scuffle && !p.load && !p.party && !dressed.has(p) && reaches(board, p, target);
    // Households near enough, with a grown-up free: nearest first, with a little seeded shuffle so it is not always the same.
    const houses = new Map<number, Person[]>();
    for (const p of people) {
      if (!free(p)) continue;
      const list = houses.get(p.home) ?? [];
      list.push(p);
      houses.set(p.home, list);
    }
    const far = (home: number, list: Person[]): number => {
      const hc = homeCell(board, list[0]!);
      return hc === null ? Infinity : board.dist(hc, target);
    };
    const families = [...houses]
      .filter(([home, list]) => list.some(canWork) && far(home, list) <= BEACH.reach)
      .map(([home, list]) => ({ home, list, score: far(home, list) + rand(board.seed, 'beach-house', home, begun) * 14 }))
      .sort((a, b) => a.score - b.score || a.home - b.home);
    const order = [...pitches].sort((a, b) => rand(board.seed, 'pitch-order', a.cell, begun) - rand(board.seed, 'pitch-order', b.cell, begun));
    const day: Day = { beach, scene: null, pitches: [], began: board.now, until: Infinity, mode: 'on' };
    let k = 0;
    for (const post of order) {
      const fam = families[k];
      if (!fam || room <= 0) break;
      k++;
      // A grown-up, then the children, then another grown-up: three at most.
      const adults = fam.list.filter(canWork).sort((a, b) => (a.id < b.id ? -1 : 1));
      const kids = fam.list.filter((p) => p.child).sort((a, b) => (a.id < b.id ? -1 : 1));
      const crew = [adults[0]!, ...kids.slice(0, 2), ...adults.slice(1)].slice(0, Math.min(3, room));
      // Somebody alone sometimes brings a friend from next door? No: a family is one house.
      const pi = makePitch(board, post, beach, fam.home, k);
      const ballFirst = rand(board.seed, 'ball-first', fam.home, begun) < 0.45;
      let kidsSeen = 0, adultsSeen = 0;
      crew.forEach((p) => {
        let role: Role;
        if (p.child) role = (kidsSeen++ === 0) === ballFirst ? 'ball' : 'pail';
        else role = adultsSeen++ === 0 ? 'parasol' : adultsSeen === 2 ? 'chair' : 'hamper';
        const load = carryOf(role === 'parasol' ? 'parasol' : role, pi, false);
        const b: Bather = { p, pitch: pi, role, load, state: 'called', t: 0, stage: 0, calls: 0, act: 'idle', actUntil: 0, to: null, swim: 0, swimmer: null, ringAt: 0, lost: false, hurry: false };
        pi.bathers.push(b);
      });
      room -= crew.length;
      day.pitches.push(pi);
    }
    if (day.pitches.length < Math.min(2, pitches.length)) return false;
    // Called in ones and twos over BEACH.call, the farthest first.
    const all = day.pitches.flatMap((pi) => pi.bathers);
    const dist = (b: Bather): number => {
      const hc = homeCell(board, b.p);
      return hc === null ? 0 : board.dist(hc, target);
    };
    const byFar = [...all].sort((a, b) => dist(b) - dist(a) || (a.p.id < b.p.id ? -1 : 1));
    for (const b of all) {
      const i = byFar.findIndex((x) => x.pitch === b.pitch);
      b.calls = board.now + (i / Math.max(1, byFar.length)) * BEACH.call + rand(b.p.seed, 'beach-call', begun) * 3;
      bathers.set(b.p, b);
      board.claim(b.p, chain);
      b.p.party = true;
    }
    begun++;
    days.set(beach, day);
    const focus = (): { x: number; y: number; z: number } | null => {
      const ps = day.pitches;
      if (ps.length === 0) return null;
      return { x: ps.reduce((n, p) => n + p.cx, 0) / ps.length, y: ps[0]!.cy, z: ps.reduce((n, p) => n + p.cz, 0) / ps.length };
    };
    day.scene = scenesOf(board).begin({
      kind: 'beach',
      title: phrase('A beach day on the shore'),
      big: true,
      focus,
      noteworthy: () => day.pitches.filter((pi) => pi.things.some((t) => t.kind === 'parasol')).length >= Math.min(2, day.pitches.length),
      gathering: () => false,
    });
    return true;
  };

  /** The plan for a bather once called: home to change (unless in), out with their thing to the pitch, and (later) home. */
  const batherPlan = (board: Board, b: Bather): Plan | null => {
    const p = b.p, pi = b.pitch;
    const steps: PlanStep[] = [];
    if (p.mode === 'home') dress(p);
    else {
      const change = board.homeStep(p, { tag: 'beach:dress', linger: 1.2 + rand(p.seed, 'beach-dress', begun) * 2, done: (q) => void dress(q) });
      if (!change) return null;
      steps.push(change);
    }
    // Where they set their thing down: beside it, facing it.
    const [a, bb] = b.role === 'parasol' ? [-0.14, 0.06] : b.role === 'chair' ? [0.08, 0.23] : b.role === 'hamper' ? [-0.2, 0.3] : b.role === 'pail' ? AT.dig : [0.18, -0.3];
    const s = spot(pi, a, bb);
    const thing = b.role === 'parasol' ? AT.parasol : AT[b.role];
    const t = spot(pi, thing[0], thing[1]);
    const face = Math.atan2(t.x - s.x, t.z - s.z);
    steps.push(
      board.stepAt(pi.post.cell, {
        spot: s,
        face,
        pose: 'tend',
        linger: 1e6,
        load: b.load,
        tag: 'beach:stay',
        done: (q) => {
          const me = bathers.get(q);
          if (me && me.state === 'coming') {
            me.state = 'setup';
            me.t = 0;
            me.stage = 0;
          }
        },
      }),
    );
    const home = board.homeStep(p, { tag: 'beach:home', linger: 0.5, load: null, done: (q) => void undress(board, q) });
    if (!home) return null;
    steps.push(home);
    return {
      chain,
      at: 0,
      steps,
      fail: (q) => {
        if (reassigning) return;
        lose(board, q);
      },
    };
  };

  /** A bather taken away by something else (a fire, the town changing): out of the day; their things wait to be fetched. */
  const lose = (board: Board, p: Person): void => {
    const b = bathers.get(p);
    if (!b) return;
    b.lost = true;
    b.state = 'gone';
    endSwim(board, b, true);
    resetBody(p);
    for (const t of b.pitch.things) if (t.owner === b) orphan(b.pitch, t, board);
    if (b.pitch.ball && (b.pitch.ball.from === b || b.pitch.ball.to === b)) dropBall(board, b.pitch);
    bathers.delete(p);
  };
  const orphan = (pi: Pitch, t: Thing, board: Board): void => {
    t.owner = null;
    t.orphaned = board.now;
    if (!orphans.some((o) => o.thing === t)) orphans.push({ pitch: pi, thing: t });
  };

  /** Whatever is in their hands now goes with them on the rest of their plan. */
  const carry = (board: Board, p: Person): void => {
    const plan = board.plans.get(p);
    if (plan?.chain !== chain) return;
    for (let i = plan.at; i < plan.steps.length; i++) plan.steps[i]!.load = p.load;
  };
  /** Off home from the pitch, with what they hold. */
  const release = (board: Board, b: Bather): void => {
    const p = b.p;
    resetBody(p);
    if (b.hurry) p.costume = 'bather-towel';
    carry(board, p);
    const plan = board.plans.get(p);
    if (plan?.chain === chain && b.hurry) for (let i = plan.at; i < plan.steps.length; i++) plan.steps[i] = { ...plan.steps[i]!, brisk: true };
    b.state = 'gone';
    p.timer = Math.min(p.timer, 0.2 + (b.hurry ? 0 : rand(p.seed, 'beach-go', begun) * 1.5));
  };

  // ── at the pitch ────────────────────────────────────────────────────────
  const atHold = (board: Board, b: Bather): boolean => b.p.mode === 'linger' && b.p.goal?.errand?.tag === 'beach:stay' && board.plans.get(b.p)?.chain === chain;

  /** Walk (within the pitch's cell) to a place, then hold a pose there. */
  const goTo = (b: Bather, a: number, bb: number, face: number): void => {
    const s = spot(b.pitch, a, bb);
    b.to = { x: s.x, z: s.z, face };
  };
  /** One step of walking toward `to`; true once there. */
  const walkOn = (b: Bather, dt: number): boolean => {
    const p = b.p, to = b.to;
    if (!to) return true;
    const dx = to.x - p.x, dz = to.z - p.z, d = Math.hypot(dx, dz);
    const pace = (b.hurry ? 0.75 : 0.36) * (p.child ? 1.2 : 1);
    p.seat = -1;
    p.lift = 0;
    p.drawX = p.drawZ = 0;
    if (d < 1e-3) {
      p.heading = to.face;
      b.to = null;
      return true;
    }
    const k = Math.min(d, pace * dt);
    p.x += (dx / d) * k;
    p.z += (dz / d) * k;
    // Kept inside the cell (the walking graph's promise).
    const cell = p.cell, cx = keyX(cell), cz = keyZ(cell);
    p.x = Math.max(cx + 0.02, Math.min(cx + 0.98, p.x));
    p.z = Math.max(cz + 0.02, Math.min(cz + 0.98, p.z));
    p.heading = Math.atan2(dx, dz);
    p.pose = p.child || b.hurry ? 'run' : 'walk';
    p.stride += (k * PERSON.stepsPerCell * 0.5) / (p.child ? 0.8 : 1);
    return false;
  };
  const hold = (b: Bather, pose: PoseName): void => {
    if (b.p.pose !== pose) {
      b.p.pose = pose;
      b.p.poseTime = 0;
    }
  };

  const thingOf = (pi: Pitch, kind: ThingKind): Thing | undefined => pi.things.find((t) => t.kind === kind);
  const busyWith = (pi: Pitch, act: Act, not: Bather): boolean => pi.bathers.some((o) => o !== not && o.state === 'stay' && o.act === act);
  const castleAt = (pi: Pitch): Castle | undefined => {
    const s = spot(pi, AT.castle[0], AT.castle[1]);
    return castles.find((c) => Math.hypot(c.x - s.x, c.z - s.z) < 0.2);
  };

  /** What a bather does next: chosen by weights among what they can do now. */
  const choose = (board: Board, b: Bather): void => {
    const p = b.p, pi = b.pitch;
    const r = rand(p.seed, 'beach-act', begun, Math.floor(board.now * 3));
    const options: [Act, number][] = [];
    const swimmer = inCostume(lookOf(p.look, p.child), p.id);
    if (p.child) {
      if (thingOf(pi, 'pail') && !busyWith(pi, 'dig', b)) options.push(['dig', 4]);
      options.push(['paddle', 2.5]);
      if (thingOf(pi, 'ball') && pi.bathers.some((o) => o !== b && o.state === 'stay' && o.act !== 'swim' && o.act !== 'ball')) options.push(['ball', 3]);
      options.push(['sit', 0.6]);
    } else {
      if (thingOf(pi, 'towel') && !busyWith(pi, 'lie', b) && !busyWith(pi, 'sleep', b)) options.push(['lie', 3], ['sleep', 1.6]);
      if (thingOf(pi, 'chair') && !busyWith(pi, 'lounge', b) && !busyWith(pi, 'read', b)) options.push(['lounge', 2.5], ['read', 2]);
      options.push(['paddle', 1.2], ['look', 0.6], ['sit', 0.8]);
      if (swimmer) options.push(['swim', 1.4]);
      if (thingOf(pi, 'ball') && pi.bathers.some((o) => o !== b && o.p.child && o.state === 'stay' && o.act !== 'swim' && o.act !== 'ball')) options.push(['ball', 1]);
    }
    // Not the same again, if there is anything else.
    const list = options.filter(([a]) => a !== b.act || options.length === 1);
    const total = list.reduce((n, [, w]) => n + w, 0);
    let x = r * total;
    let act: Act = list[0]?.[0] ?? 'look';
    for (const [a, w] of list) {
      x -= w;
      if (x <= 0) {
        act = a;
        break;
      }
    }
    start(board, b, act);
  };

  const start = (board: Board, b: Bather, act: Act): void => {
    const p = b.p, pi = b.pitch;
    if (p.costume === 'bather-face') p.costume = 'bather';
    b.act = act;
    b.actUntil = board.now + BEACH.act * (1 + rand(p.seed, 'beach-long', begun, Math.floor(board.now)));
    const sea = seaward(pi);
    const land = sea + Math.PI;
    switch (act) {
      case 'lie':
      case 'sleep':
        goTo(b, AT.lieOn[0], AT.lieOn[1], sea);
        break;
      case 'lounge':
      case 'read':
        goTo(b, AT.sitIn[0], AT.sitIn[1], sea);
        break;
      case 'sit':
        goTo(b, AT.sand[0] + (p.child ? 0.3 : 0), AT.sand[1] - (p.child ? 0.5 : 0), sea);
        break;
      case 'paddle':
        goTo(b, 0.45, (rand(p.seed, 'paddle', begun, Math.floor(board.now)) - 0.5) * 0.6, sea);
        b.swim = 0;
        break;
      case 'look':
        goTo(b, 0.38, (rand(p.seed, 'look-at', begun, Math.floor(board.now)) - 0.5) * 0.5, sea);
        break;
      case 'swim':
        goTo(b, 0.45, (rand(p.seed, 'swim-at', begun, Math.floor(board.now)) - 0.5) * 0.4, sea);
        b.swim = 0;
        b.actUntil = Infinity;
        break;
      case 'dig': {
        goTo(b, AT.dig[0], AT.dig[1], sea);
        break;
      }
      case 'ball': {
        // A partner: another of the family, not swimming.
        const partner = pi.bathers.find((o) => o !== b && o.state === 'stay' && o.act !== 'swim' && o.act !== 'ball' && !o.to);
        if (!partner || !thingOf(pi, 'ball')) {
          start(board, b, 'paddle');
          return;
        }
        partner.act = 'ball';
        partner.actUntil = b.actUntil;
        if (partner.p.costume === 'bather-face') partner.p.costume = 'bather';
        const s1 = spot(pi, AT.ball[0], AT.ball[1]), s2 = spot(pi, AT.ball2[0], AT.ball2[1]);
        b.to = { x: s1.x, z: s1.z, face: Math.atan2(s2.x - s1.x, s2.z - s1.z) };
        partner.to = { x: s2.x, z: s2.z, face: Math.atan2(s1.x - s2.x, s1.z - s2.z) };
        const ball = thingOf(pi, 'ball')!;
        // The ball is picked up off the sand by whoever is nearer it.
        ball.h?.setVisible(false);
        pi.ball = { from: b, to: partner, t: -1.2, h: ball.h };
        break;
      }
      default:
        goTo(b, AT.sand[0], AT.sand[1], land);
    }
  };

  /** The ball game is over: it is put down where the thrower stands. */
  const dropBall = (board: Board, pi: Pitch): void => {
    const g = pi.ball;
    if (!g) return;
    pi.ball = null;
    const ball = thingOf(pi, 'ball');
    if (!ball) return;
    const holder = g.t >= 0 && g.t < 1 ? g.to : g.from;
    ball.x = holder.p.x + Math.sin(holder.p.heading) * 0.08;
    ball.z = holder.p.z + Math.cos(holder.p.heading) * 0.08;
    const cx = keyX(pi.post.cell), cz = keyZ(pi.post.cell);
    ball.x = Math.max(cx + 0.08, Math.min(cx + 0.92, ball.x));
    ball.z = Math.max(cz + 0.08, Math.min(cz + 0.92, ball.z));
    ball.y = pi.cy + 0.06;
    ball.h?.setMatrix(place(ball.x, ball.y, ball.z, 0));
    ball.h?.setVisible(true);
    for (const b of [g.from, g.to]) if (b.act === 'ball') b.actUntil = Math.min(b.actUntil, board.now);
  };

  const stepBall = (board: Board, pi: Pitch, dt: number): void => {
    const g = pi.ball;
    if (!g) return;
    const { from, to } = g;
    if (from.state !== 'stay' || to.state !== 'stay' || from.act !== 'ball' || to.act !== 'ball' || board.now > from.actUntil) {
      dropBall(board, pi);
      return;
    }
    if (from.to || to.to) {
      // Still taking their places: the ball in the thrower's hands.
      g.h?.setVisible(true);
      g.h?.setMatrix(place(from.p.x + Math.sin(from.p.heading) * 0.06, from.p.y + 0.24, from.p.z + Math.cos(from.p.heading) * 0.06, 0));
      return;
    }
    g.t += dt / 0.95;
    if (g.t < 0) {
      // Held a moment, then thrown up and over.
      hold(from, 'ready');
      hold(to, 'ready');
      g.h?.setMatrix(place(from.p.x + Math.sin(from.p.heading) * 0.06, from.p.y + 0.26, from.p.z + Math.cos(from.p.heading) * 0.06, 0));
      if (g.t + dt / 0.95 >= 0) {
        from.p.pose = 'shoot';
        from.p.poseTime = 0;
      }
      return;
    }
    const k = Math.min(1, g.t);
    const x0 = from.p.x + Math.sin(from.p.heading) * 0.06, z0 = from.p.z + Math.cos(from.p.heading) * 0.06;
    const x1 = to.p.x + Math.sin(to.p.heading) * 0.06, z1 = to.p.z + Math.cos(to.p.heading) * 0.06;
    const y = from.p.y + 0.3 + Math.sin(k * Math.PI) * 0.55;
    g.h?.setVisible(true);
    g.h?.setMatrix(place(x0 + (x1 - x0) * k, y, z0 + (z1 - z0) * k, k * 7));
    if (k >= 1) {
      // Caught: hands up, then it goes back the other way.
      to.p.pose = 'pass';
      to.p.poseTime = 0;
      pi.ball = { from: to, to: from, t: -0.7 - rand(board.seed, 'ball-hold', Math.floor(board.now * 2)) * 0.6, h: g.h };
      if (from.p.pose === 'shoot') hold(from, 'ready');
    }
  };

  /**
   * Out past the edge of the cell they stand in (drawn there: `out` cells seaward of where they stand), and
   * down the slope of the beach (`down` 0 on the sand to 1 at the water's surface, more is deeper). Walking
   * while they go out or come back; true once still.
   */
  const wade = (b: Bather, out: number, down: number): boolean => {
    const p = b.p, pi = b.pitch;
    const was = Math.hypot(p.drawX ?? 0, p.drawZ ?? 0);
    p.drawX = pi.fx * out;
    p.drawZ = pi.fz * out;
    p.lift = -down * Math.max(0, p.y - SEA_Y);
    const moved = Math.abs(out - was) > 1e-4;
    if (moved) {
      p.pose = p.child ? 'run' : 'walk';
      p.stride += (Math.abs(out - was) * PERSON.stepsPerCell * 0.5) / (p.child ? 0.8 : 1);
      p.heading = out > was ? seaward(pi) : seaward(pi) + Math.PI;
    }
    return !moved;
  };
  /** Back up onto the sand where they stand (from the shallows): true once there. */
  const ashore = (b: Bather, dt: number): boolean => {
    const p = b.p;
    const was = Math.hypot(p.drawX ?? 0, p.drawZ ?? 0);
    if (was < 1e-4) {
      p.drawX = p.drawZ = 0;
      return true;
    }
    const out = Math.max(0, was - dt * 0.4);
    wade(b, out, (out / Math.max(1e-3, SHALLOWS - 0.45)) * 0.97);
    if (out <= 0) {
      p.drawX = p.drawZ = 0;
      p.lift = 0;
      return true;
    }
    return false;
  };

  /** Into the water, out and back, and up out of it again. */
  const stepSwim = (board: Board, b: Bather, dt: number): void => {
    const p = b.p, pi = b.pitch;
    const total = b.hurry ? 6 : BEACH.swim;
    const wadeT = 2.2 / total;
    b.swim += dt / total;
    const s = b.swim;
    const deep = SHALLOWS - 0.45 + 0.22;
    if (s < wadeT) {
      // Walking down into the water, deeper and deeper.
      const k = s / wadeT;
      wade(b, k * deep, k * 1.6);
      return;
    }
    if (s < 1 - wadeT) {
      p.visible = false;
      if (!b.swimmer && board.stage) {
        const look = lookOf(p.look, p.child);
        const cap = sunHat(look, p.id) ? null : BEACH_COLOURS.hats[0]!;
        b.swimmer = [0, 1].map((k) => board.stage!.spawnMesh(swimmerMesh(look.skin, look.hair, costumeColour(p.id), cap, k), place(0, -50, 0, 0)));
      }
      const k = (s - wadeT) / (1 - 2 * wadeT);
      const out = BEACH.swimOut * Math.sin(Math.min(1, k) * Math.PI);
      const back = k > 0.5;
      const x = p.x + pi.fx * (0.45 + deep - 0.45 + out) , z = p.z + pi.fz * (deep + out);
      const yaw = seaward(pi) + (back ? Math.PI : 0);
      const stroke = Math.floor(board.now * 2.4 + p.rank * 5) % 2;
      const sc = lookOf(p.look, p.child).scale / 1.1;
      b.swimmer?.forEach((h, i) => {
        h.setVisible(i === stroke);
        if (i === stroke) h.setMatrix(compose(translation(x, SEA_Y - 0.01, z), rotationY(yaw), [sc, 0, 0, 0, 0, sc, 0, 0, 0, 0, sc, 0, 0, 0, 0, 1]));
      });
      if (board.now >= b.ringAt && board.stage) {
        b.ringAt = board.now + 0.85;
        wakeRing(board.stage, x, z, 0.1, 2.2, 1.1);
      }
      return;
    }
    // Up out of the water again, and back up the beach to where they went in.
    endSwim(board, b, false);
    p.visible = true;
    if (s < 1) {
      const k = (1 - s) / wadeT;
      wade(b, k * deep, k * 1.6);
      return;
    }
    p.drawX = p.drawZ = 0;
    p.lift = 0;
    b.actUntil = board.now;
  };
  const endSwim = (_board: Board, b: Bather, now: boolean): void => {
    if (b.swimmer) for (const h of b.swimmer) h.release();
    b.swimmer = null;
    if (now) {
      b.p.visible = true;
      b.p.drawX = b.p.drawZ = 0;
      b.p.lift = 0;
    }
  };

  /** A child digging: the castle grows a stage every few seconds of it. */
  const stepDig = (board: Board, b: Bather, dt: number): void => {
    const pi = b.pitch;
    let c = castleAt(pi);
    if (!c) {
      const s = spot(pi, AT.castle[0], AT.castle[1]);
      c = { x: s.x, y: pi.cy, z: s.z, stage: 1, h: null, dug: 0, left: Infinity, slumped: Infinity, pitch: pi, lasts: BEACH.castle * (1 + rand(board.seed, 'castle', Math.round(s.x * 10), Math.round(s.z * 10), begun)) };
      castles.push(c);
      drawCastle(board, c, true);
    }
    c.pitch = pi;
    c.left = Infinity;
    if (c.stage === -1) {
      // A slumped one is built up again.
      c.stage = 1;
      c.slumped = Infinity;
      drawCastle(board, c, true);
    }
    c.dug += dt;
    if (c.dug > 9 && c.stage < 4) {
      c.dug = 0;
      c.stage = (c.stage + 1) as CastleStage;
      drawCastle(board, c, true);
    }
  };
  const drawCastle = (board: Board, c: Castle, poof: boolean): void => {
    c.h?.release();
    c.h = board.stage ? board.stage.spawnMesh(castleMesh(c.stage), place(c.x, c.y, c.z, c.pitch ? seaward(c.pitch) : 0)) : null;
    if (poof) puff(board, c.x, c.y, c.z, 1);
  };
  const stepCastles = (board: Board): void => {
    const wet = board.weather.rain > BEACH.castleRain;
    for (let i = castles.length - 1; i >= 0; i--) {
      const c = castles[i]!;
      const building = c.pitch?.bathers.some((b) => b.state === 'stay' && b.act === 'dig') ?? false;
      if (building) continue;
      if (c.left === Infinity) c.left = board.now;
      const age = board.now - c.left;
      if (c.stage !== -1 && (age > c.lasts || (wet && age > 8))) {
        // The sea (or the rain) takes it: it slumps.
        c.stage = -1;
        c.slumped = board.now;
        drawCastle(board, c, true);
      } else if (c.stage === -1 && board.now - c.slumped > (wet ? 30 : 60)) {
        puff(board, c.x, c.y, c.z, 3);
        c.h?.release();
        castles.splice(i, 1);
      }
    }
  };

  /** Arrived at a place in the pitch: the pose for what they are doing. */
  const doAct = (board: Board, b: Bather, dt: number): void => {
    const p = b.p;
    switch (b.act) {
      case 'lie':
        hold(b, 'lie');
        break;
      case 'sleep':
        hold(b, 'lie');
        p.costume = 'bather-face';
        break;
      case 'lounge':
      case 'read':
        hold(b, b.act);
        p.seat = DECKCHAIR.seat;
        break;
      case 'sit':
        hold(b, 'sit');
        p.seat = 0;
        break;
      case 'paddle': {
        // Out into the shallows (drawn past the cell's edge, down the slope of the beach), splashing.
        b.swim = Math.min(1, b.swim + dt / 1.2);
        if (wade(b, b.swim * (SHALLOWS - 0.45), b.swim * 0.97)) hold(b, 'splash');
        if (b.swim >= 1 && board.now >= b.ringAt && board.stage) {
          b.ringAt = board.now + 0.9 + rand(p.seed, 'splash', Math.floor(board.now)) * 0.6;
          const x = p.x + (p.drawX ?? 0) + Math.sin(p.heading) * 0.08, z = p.z + (p.drawZ ?? 0) + Math.cos(p.heading) * 0.08;
          wakeRing(board.stage, x, z, 0.06, 2.4, 0.9);
          puff(board, x, SEA_Y, z, 1, true);
        }
        break;
      }
      case 'look':
        hold(b, 'look');
        break;
      case 'dig':
        hold(b, 'dig');
        stepDig(board, b, dt);
        break;
      case 'swim':
        stepSwim(board, b, dt);
        break;
      case 'ball':
        // Posed by the ball (stepBall).
        if (p.pose !== 'shoot' && p.pose !== 'pass' && p.pose !== 'ready') hold(b, 'ready');
        else if (p.poseTime > 0.7) hold(b, 'ready');
        break;
      default:
        hold(b, 'stand');
    }
  };

  /** Setting up: each puts their thing down (the parasol, then the towel unrolled beside it). */
  const stepSetup = (board: Board, b: Bather, dt: number): void => {
    const p = b.p, pi = b.pitch;
    b.t += dt;
    if (b.stage === 0) {
      hold(b, 'tend');
      if (b.t < 1.5) return;
      const kind: ThingKind = b.role === 'parasol' ? 'parasol' : b.role;
      putDown(board, pi, kind, b);
      p.load = null;
      carry(board, p);
      if (b.role === 'parasol') {
        // Then the towel: a step to its side, unrolled.
        b.stage = 1;
        b.t = 0;
        goTo(b, 0.06, -0.02, seaward(pi) - Math.PI / 2);
        return;
      }
      b.state = 'stay';
      b.actUntil = board.now;
      return;
    }
    if (b.to && !walkOn(b, dt)) return;
    hold(b, 'tend');
    if (b.t < 1.6) return;
    putDown(board, pi, 'towel', b);
    b.state = 'stay';
    b.actUntil = board.now;
  };

  /** Packing up: to each of their things, folded, picked up; then off home. */
  const stepPack = (board: Board, b: Bather, dt: number): void => {
    const p = b.p, pi = b.pitch;
    if (b.act === 'swim' && b.swim < 1) {
      // Out of the water first (in a hurry, in the rain).
      stepSwim(board, b, b.hurry ? dt * 3 : dt);
      return;
    }
    // When the sun gets low there is no hurry: each finishes what they are doing first (a few seconds apart).
    if (!b.hurry && b.stage === 0 && b.t < 0 && b.act !== 'idle') {
      b.t += dt;
      if (b.to) walkOn(b, dt);
      else doAct(board, b, dt);
      return;
    }
    if ((p.drawX || p.drawZ) && !ashore(b, dt * 2)) return;
    endSwim(board, b, true);
    if (b.act !== 'idle') {
      b.act = 'idle';
      b.to = null;
      p.seat = -1;
      if (p.costume === 'bather-face') p.costume = 'bather';
    }
    const mine = pi.things.filter((t) => t.owner === b).sort((x, y) => order(x.kind) - order(y.kind));
    const t = mine[0];
    if (!t && !b.hurry && p.load && pi.bathers.some((o) => o !== b && o.state === 'pack' && pi.things.some((x) => x.owner === o))) {
      // Packed: waiting for the rest of the family, looking out to sea a last time.
      hold(b, 'stand');
      p.heading = seaward(pi);
      return;
    }
    if (!t) {
      // Nothing (more) to pack (somebody else's things that nobody will take: theirs too, if their hands are free).
      const spare = !p.load ? pi.things.find((x) => x.owner === null && !x.fetcher) : undefined;
      if (spare) {
        spare.owner = b;
        const o = orphans.findIndex((x) => x.thing === spare);
        if (o >= 0) orphans.splice(o, 1);
        return;
      }
      release(board, b);
      return;
    }
    if (!b.to && b.stage !== 9) {
      const dx = p.x - t.x, dz = p.z - t.z, d = Math.hypot(dx, dz) || 1;
      const s = { x: t.x + (dx / d) * 0.16, z: t.z + (dz / d) * 0.16 };
      const cx = keyX(pi.post.cell), cz = keyZ(pi.post.cell);
      b.to = { x: Math.max(cx + 0.04, Math.min(cx + 0.96, s.x)), z: Math.max(cz + 0.04, Math.min(cz + 0.96, s.z)), face: Math.atan2(t.x - s.x, t.z - s.z) };
      b.stage = 9;
      b.t = 0;
    }
    if (b.to && !walkOn(b, dt)) return;
    b.t += dt;
    // Unhurried: the towel shaken out, the chair folded, the parasol let down (an arm up to close it) and pulled up.
    const takes = b.hurry ? 0.5 : t.kind === 'towel' ? 2.4 : t.kind === 'chair' ? 2.2 : t.kind === 'parasol' ? 2.8 : 1.3;
    hold(b, b.hurry ? 'tend' : t.kind === 'towel' ? 'dust' : t.kind === 'parasol' && b.t < 1.1 ? 'wave' : 'tend');
    if (b.t < takes) return;
    pickUp(board, pi, t);
    // The towel rolls up round the parasol's foot: it is carried with it.
    if (t.kind !== 'towel') p.load = carryOf(t.kind, pi, b.hurry);
    b.stage = 0;
    b.t = 0;
  };
  /** The parasol comes down last. */
  const order = (k: ThingKind): number => (k === 'towel' ? 0 : k === 'parasol' ? 3 : k === 'chair' ? 1 : 2);

  /** The day is over (or rain or trouble): everybody packs up. */
  const packUp = (board: Board, day: Day, hurry: boolean): void => {
    if (day.mode !== 'on' && !(hurry && day.mode === 'pack')) return;
    day.mode = hurry ? 'dash' : 'pack';
    for (const pi of day.pitches) {
      dropBall(board, pi);
      for (const b of pi.bathers) {
        if (b.lost || b.state === 'gone') continue;
        b.hurry = hurry;
        if (b.state === 'stay' || b.state === 'setup') {
          // Anything not yet set down stays in the hands.
          b.state = 'pack';
          b.stage = 0;
          b.t = hurry ? 0 : -(2 + rand(b.p.seed, 'beach-pack', begun) * 12);
          if (hurry) b.to = null;
        } else if (b.state === 'called' || b.state === 'coming') {
          // Not there yet: back home (with their thing, if they have it).
          b.state = 'gone';
          if (b.p.party && board.plans.get(b.p)?.chain === chain) {
            if (hurry && dressed.has(b.p)) b.p.costume = 'bather-towel';
            sendHome(board, b.p, hurry);
          } else if (!dressed.has(b.p)) undress(board, b.p);
        }
      }
    }
  };

  /** The day is over and everybody has gone: the register is told, and the next is some time off. */
  const close = (board: Board, day: Day): void => {
    days.delete(day.beach);
    if (day.scene) scenesOf(board).end(day.scene);
    for (const pi of day.pitches) {
      for (const t of [...pi.things]) if (t.owner && t.owner.lost) orphan(pi, t, board);
      for (const t of pi.things) if (!orphans.some((o) => o.thing === t)) orphan(pi, t, board);
    }
    next.set(day.beach, board.now + BEACH.every + rand(board.seed, 'beach-next', day.beach, begun) * BEACH.everySpread);
  };

  /** Trouble near the beach (a bomb, a nuke): everybody runs. */
  const trouble = (board: Board, day: Day): boolean => {
    if (!board.stage || day.pitches.length === 0) return false;
    const d = mischiefOf(board.stage);
    const x = day.pitches[0]!.cx, z = day.pitches[0]!.cz;
    for (const b of d.bombs) if (b.nuke || Math.hypot(b.point[0] - x, b.point[2] - z) < 12) return true;
    // Raiders ashore near the beach (src/life/raid).
    if (d.threats.some((t) => Math.hypot(t.x - x, t.z - z) < 10)) return true;
    return false;
  };

  /** Somebody free fetches a thing left lying: of its house first, after a while anybody grown-up. */
  const fetchPlan = (board: Board, p: Person): Plan | null => {
    if (p.load || p.party || p.child || board.claimedBy(p)) return null;
    for (const o of orphans) {
      const t = o.thing;
      if (t.fetcher || !o.pitch.things.includes(t)) continue;
      const mine = p.home === o.pitch.home;
      if (!mine && board.now - t.orphaned < 60) continue;
      if (!reaches(board, p, o.pitch.post.cell) || board.dist(p.cell, o.pitch.post.cell) > (mine ? 60 : 24)) continue;
      const pi = o.pitch;
      const dx = pi.cx - t.x, dz = pi.cz - t.z, d = Math.hypot(dx, dz) || 1;
      const s = { x: t.x + (dx / d) * 0.14, z: t.z + (dz / d) * 0.14 };
      const home = board.homeStep(p, { tag: 'beach:fetched', linger: 0.5, load: null, done: (q) => void (q.load = null) });
      if (!home) continue;
      t.fetcher = p;
      return {
        chain,
        at: 0,
        steps: [
          board.stepAt(pi.post.cell, {
            spot: s,
            face: Math.atan2(t.x - s.x, t.z - s.z),
            pose: 'tend',
            linger: 1.4,
            tag: 'beach:fetch',
            done: (q) => {
              if (!pi.things.includes(t)) return false;
              pickUp(board, pi, t);
              q.load = carryOf(t.kind, pi, false);
              home.load = q.load;
              return true;
            },
          }),
          home,
        ],
        fail: () => void (t.fetcher = null),
      };
    }
    return null;
  };

  const chain: BeachChain = {
    id: 'beach',
    get days() {
      return begun;
    },
    get on() {
      return [...days.values()];
    },
    get bathers() {
      return [...bathers.values()];
    },
    get castles() {
      return castles;
    },
    get things() {
      return [...days.values()].reduce((n, d) => n + d.pitches.reduce((m, pi) => m + pi.things.length, 0), 0) + orphans.filter((o) => ![...days.values()].some((d) => d.pitches.includes(o.pitch))).length;
    },
    begin,
    packUp(board) {
      for (const day of days.values()) packUp(board, day, false);
    },
    sync(board) {
      posts = board.posts('beach');
      const live = new Set(posts.filter((p) => p.role === 'pitch').map((p) => p.cell));
      // A pitch whose sand is gone: its things go with a puff (as a store's do), its people walk home.
      const drop = (pi: Pitch): void => {
        for (const t of [...pi.things]) pickUp(board, pi, t);
        pi.ball = null;
        for (const b of pi.bathers) {
          if (b.state === 'gone' || b.lost) continue;
          endSwim(board, b, true);
          b.state = 'gone';
          if (board.plans.get(b.p)?.chain === chain) sendHome(board, b.p);
          else undress(board, b.p);
        }
      };
      for (const day of [...days.values()]) {
        const kept = day.pitches.filter((pi) => live.has(pi.post.cell));
        for (const pi of day.pitches) if (!kept.includes(pi)) drop(pi);
        day.pitches = kept;
        if (kept.length === 0) close(board, day);
      }
      for (const o of [...orphans]) if (!live.has(o.pitch.post.cell)) drop(o.pitch);
      // Castles on sand that is gone go with a puff.
      for (let i = castles.length - 1; i >= 0; i--) {
        const c = castles[i]!;
        const cell = c.pitch?.post.cell;
        if (cell !== undefined && live.has(cell)) continue;
        puff(board, c.x, c.y, c.z, 2);
        c.h?.release();
        castles.splice(i, 1);
      }
    },
    step(dt, time, board) {
      if (seen < 0) {
        seen = board.now;
        for (const b of beachesNow()) next.set(b, seen + BEACH.first + rand(board.seed, 'beach-first', b) * BEACH.firstSpread + b * 25);
      }
      moving = lastPhase >= 0 && time.phase !== lastPhase;
      lastPhase = time.phase;
      // Change back, at home.
      for (const p of [...dressed]) {
        const b = bathers.get(p);
        if (b && !b.lost && b.state !== 'gone') continue;
        if (p.mode === 'home') undress(board, p);
      }
      stepCastles(board);
      const dayLeft = moving ? (partPhases().day.end - time.phase) * loopSeconds() : Infinity;
      // New days.
      if (time.isDay && beachWeather(board) && dayLeft > BEACH.needs) {
        for (const b of beachesNow()) {
          if (days.has(b) || board.now < (next.get(b) ?? Infinity)) continue;
          if (!scenesOf(board).may('beach')) break;
          if (!begin(board, b)) next.set(b, board.now + 30);
          break;
        }
      }
      const check = board.now >= checkAt;
      if (check) checkAt = board.now + 0.5;
      for (const day of [...days.values()]) {
        // Rain, trouble, the sun low, or the time is up.
        const rain = board.weather.rain > BEACH.rain || board.weather.snow > 0.05;
        if (day.mode !== 'dash' && (rain || (check && trouble(board, day)))) packUp(board, day, true);
        else if (day.mode === 'on' && (!time.isDay || dayLeft < BEACH.packAt || board.now > day.until)) packUp(board, day, false);
        let waiting = 0, everybody = 0;
        for (const pi of day.pitches) {
          for (const b of pi.bathers) {
            if (b.lost) continue;
            everybody++;
            const p = b.p;
            if (b.state === 'called') {
              if (board.now >= b.calls) {
                b.state = 'coming';
                board.crowd.rethink(p);
              }
              waiting++;
              continue;
            }
            if (b.state === 'coming') {
              waiting++;
              // Taken over by something else on the way.
              const plan = board.plans.get(p);
              if (plan && plan.chain !== chain) lose(board, p);
              continue;
            }
            if (b.state === 'gone') continue;
            if (!atHold(board, b)) {
              // Pulled away while at the pitch (a fire, an edit): out of the day.
              if (board.plans.get(p)?.chain !== chain) lose(board, p);
              continue;
            }
            if (b.state === 'setup') {
              waiting++;
              stepSetup(board, b, dt);
            } else if (b.state === 'pack') stepPack(board, b, dt);
            else if (b.state === 'stay') {
              const due = board.now >= b.actUntil && !b.to && (b.act !== 'ball' || !pi.ball) && (b.act !== 'swim' || b.swim >= 1);
              // Out of the shallows first.
              if (due && (p.drawX || p.drawZ) && !ashore(b, dt)) continue;
              if (due) choose(board, b);
              if (b.to) walkOn(b, dt);
              else doAct(board, b, dt);
            }
          }
          stepBall(board, pi, dt);
        }
        // Everybody set up (or long enough waited for anybody late): the stay begins.
        if (day.mode === 'on' && day.until === Infinity && everybody > 0 && (waiting === 0 || board.now > day.began + BEACH.call + 90)) day.until = board.now + BEACH.stay + rand(board.seed, 'beach-stay', begun) * BEACH.staySpread;
        // Nobody left: over.
        if (day.pitches.every((pi) => pi.bathers.every((b) => b.lost || b.state === 'gone'))) close(board, day);
      }
      // Things left lying a long time with nobody to fetch them: the tide takes them (with a splash).
      for (const o of [...orphans]) {
        if (o.thing.fetcher || board.now - o.thing.orphaned < 240) continue;
        if ([...days.values()].some((d) => d.pitches.includes(o.pitch) && d.mode === 'on')) continue;
        pickUp(board, o.pitch, o.thing);
      }
    },
    offer(p, _time, board) {
      const b = bathers.get(p);
      if (!b || b.lost) {
        if (dressed.has(p)) return p.mode === 'home' ? (undress(board, p), null) : homePlan(board, p);
        return board.claimedBy(p) ? null : fetchPlan(board, p);
      }
      if (b.state !== 'coming') return null;
      const plan = batherPlan(board, b);
      if (!plan) lose(board, p);
      return plan;
    },
    keeps: () => false,
    dispose(board) {
      for (const day of [...days.values()]) {
        for (const pi of day.pitches) {
          for (const t of pi.things) t.h?.release();
          pi.things = [];
          for (const b of pi.bathers) endSwim(board, b, true);
        }
        if (day.scene) scenesOf(board).end(day.scene);
      }
      days.clear();
      for (const o of orphans) o.thing.h?.release();
      orphans.length = 0;
      for (const c of castles) c.h?.release();
      castles.length = 0;
    },
  };
  return chain;
}

/** For tests: the pitch a cell is, and how far into the day it is. */
export type { Bather as BeachBather, Day as BeachDay, Castle as BeachCastle, Pitch as BeachPitch };
export const BEACH_LAYOUT = AT;
/** The floor height of a cell (for tests). */
export const floorOf = (cell: CellKey): number => (cell >> 12) * CELL_H;
void DIR_HEADING;
