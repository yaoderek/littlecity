// Drawing the people blown about by mischief (design section 13b, "blown
// about"): the thrower (thrower.ts) moves them and the people system draws
// the figures from `Person.tumble`; this draws what goes with them: the
// little stars circling a dizzy head, a straw hat flying off and lying on
// the ground, a splash where somebody lands in the water, a puff of dust
// where they hit the ground. Owner: Mischief. Every handle goes through the
// owned stage (owned.ts), so a new town keeps none of it.
//
// It listens to the director: a nuke's blast (the ring throws people as it
// reaches them), a bomb's, a bolt of lightning (only right beside it); undo
// and a called-off act set everybody back on their feet at once.

import { CELL_H, keyX, keyY, keyZ, SEA_Y } from '@/core/grid';
import type { Mat4Like } from '@/core/mat4';
import { MeshBuilder, PATTERN, type MeshData } from '@/gen/mesh';
import { dazeStarMesh } from '@/parts/people/scuffle-art';
import { carriedMesh } from '@/parts/people/loads';
import { defineSystem, type InstanceHandle, type LifeStage } from '../api';
import { crowdOf } from '../doors/table';
import { fxOf } from '../fx/fx';
import { place } from '../motion/pose';
import type { Crowd } from '../people/crowd';
import { mischiefOf, type Director, type MischiefEvent } from './director';
import { spoutMesh } from './meshes';
import { capsizeBoat } from './boatwreck';
import { ownStage, type Owned } from './owned';
import { createThrower, farScale, flightGrow, airOf, type Thrown, type Thrower } from './thrower';
import { PALETTE } from '@/style/palette';
import { quatToMat3 } from './thrown';
import { crittersOf, type Critter } from './critters';
import type { NavGraph, ShapePlan } from '@/resolve/plan';

const HIDE: Mat4Like = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, -50, 0, 1];
const DUST = { actor: 'puff', variant: 'dust' } as const;
/** Stars round a dizzy head: how many, how far out, how fast round (radians a second). */
// Small and restrained (Derek, 2026-11-21: "the stars are too big… a little smaller"): three, close round the
// head, their own size at every zoom (they used to be 1.8 and grow up to 2.9 times from afar).
const STARS = { n: 3, r: 0.1, speed: 4.5, rate: 12, size: 1 };

const throwers = new WeakMap<LifeStage, Thrower>();
/** The thrower of a stage (the Hand, tests, sequences), once the people are there. */
export function throwerOf(stage: LifeStage): Thrower | null {
  return throwers.get(stage) ?? null;
}

let starMesh: MeshData | null = null;
const hatMeshes = new Map<string, MeshData>();
/** A straw hat (person.ts draws the same on the head): a wide flat brim and a low crown, about 0.1 across. */
function strawHatMesh(colour: string): MeshData {
  let m = hatMeshes.get(colour);
  if (m) return m;
  const r = 0.032;
  const b = new MeshBuilder({ ink: 'thrown-hat' });
  b.setPattern(PATTERN.none).setInk('hat').setColor(colour);
  b.lathe([[r * 1.62, 0], [r * 1.62, 0.012], [r * 0.86, 0.016], [r * 0.74, r * 0.62], [0, r * 0.7]], { segments: 12 });
  b.lathe([[0, 0], [r * 1.62, 0]], { segments: 12 });
  m = b.build();
  hatMeshes.set(colour, m);
  return m;
}

const SPEED_LINES = false;
/** Speed lines: three ink strokes a unit long down -Z, behind whatever flies. */
let streakMesh: MeshData | null = null;
function speedLinesMesh(): MeshData {
  if (streakMesh) return streakMesh;
  const b = new MeshBuilder({ ink: 'speed-lines' });
  b.setPattern(PATTERN.none).setColor(PALETTE.ink);
  for (const [i, x, y, from, to] of [[0, -0.06, 0.02, 0.2, 0.85], [1, 0.06, -0.02, 0.3, 1], [2, 0, 0.07, 0.45, 0.8]] as const) {
    b.setInk(`line${i}`);
    b.box([x - 0.0035, y - 0.0035, -to], [x + 0.0035, y + 0.0035, -from]);
  }
  return (streakMesh = b.build());
}

interface Art {
  /** Speed lines behind it while it flies. */
  lines?: InstanceHandle | null;
  stars: InstanceHandle[];
  hat: InstanceHandle | null;
  hatColor: string;
}

/** A ring on the ground, about 1 across (the Hand's mark round what it can pick up); a soft dark disc (a shadow). */
let ringMesh: MeshData | null = null;
let shadowMesh: MeshData | null = null;
function handRingMesh(): MeshData {
  if (ringMesh) return ringMesh;
  const b = new MeshBuilder({ ink: 'hand-ring' });
  b.setPattern(PATTERN.none).setInk('ring').setColor('#fff3c4');
  b.lathe([[0.5, 0], [0.5, 0.012], [0.42, 0.012], [0.42, 0]], { segments: 20 });
  return (ringMesh = b.build());
}
function heldShadowMesh(): MeshData {
  if (shadowMesh) return shadowMesh;
  const b = new MeshBuilder({ ink: 'hand-shadow' });
  b.setPattern(PATTERN.none).setInk('shadow').setColor('#9a93a3');
  b.lathe([[0.32, 0], [0.32, 0.006], [0, 0.008]], { segments: 16 });
  b.setInk('line').setColor('#7d7688');
  b.boxAt([0, 0, 0], [0.012, 1, 0.012]);
  return (shadowMesh = b.build());
}

/** A loose roof tile: a small flat slab. */
let tileMesh: MeshData | null = null;
function looseTileMesh(): MeshData {
  if (tileMesh) return tileMesh;
  const b = new MeshBuilder({ ink: 'loose-tile' });
  b.setPattern(PATTERN.none).setInk('tile').setColor('#b85c46');
  b.box([-0.05, 0, -0.035], [0.05, 0.014, 0.035]);
  return (tileMesh = b.build());
}

/** A building in the Hand: lifted out of its chunk, wobbling; tiles falling off it. */
interface Shaking {
  sid: number;
  h: InstanceHandle | null;
  /** Where its foot is (the middle of its bottom), and its top. */
  cx: number;
  cy: number;
  cz: number;
  top: number;
  t: number;
  /** Seconds settling back, once let go (-1 while held). */
  down: number;
  tiles: { h: InstanceHandle; x: number; y: number; z: number; vx: number; vy: number; vz: number; spin: number; age: number; rest: number }[];
  nextTile: number;
  /** Whoever was in it has been sent out. */
  told: boolean;
}

interface State {
  d: Director;
  shaking: Shaking | null;
  /** The Hand's mark and the shadows of what it holds. */
  ring: InstanceHandle | null;
  shadows: InstanceHandle[];
  own: Owned;
  crowd: Crowd | null;
  thrower: Thrower | null;
  shape: ShapePlan | null;
  nav: NavGraph | null;
  art: Map<Thrown, Art>;
  critterArt: Map<Critter, InstanceHandle[]>;
  critterLines: Map<Critter, { lines?: InstanceHandle | null }>;
  spouts: { h: InstanceHandle; age: number }[];
  time: number;
  off: () => void;
}

const m3 = new Float32Array(9);
const mat: number[] = new Array<number>(16).fill(0);

function onEvent(st: State, e: MischiefEvent): void {
  const t = st.thrower;
  if (!t) return;
  // A dev switch for measuring what blowing people about costs (src/life/testing/nuke-cost.mjs).
  if ((globalThis as { __lcStill?: boolean }).__lcStill && e.type !== 'reset' && e.type !== 'undo') return;
  if (e.type === 'blast') {
    const [x, y, z] = e.blast.point;
    t.blast(x, y, z, e.nuke ? 'nuke' : 'bomb');
  } else if (e.type === 'strike' && e.strike.struck) {
    const [x, y, z] = e.strike.point;
    t.blast(x, y, z, 'bolt');
  } else if (e.type === 'reset' || e.type === 'undo') {
    t.reset();
  }
}

/** Ink strokes behind a body flying fast, along the way it goes, longer the faster (and drawn bigger as it is). */
function speedLines(stage: LifeStage, a: { lines?: InstanceHandle | null }, b: { x: number; y: number; z: number; vx: number; vy: number; vz: number; upright: boolean; radius: number } | null): void {
  const sp = b ? Math.hypot(b.vx, b.vy, b.vz) : 0;
  // Off for now (Derek, 2026-11-21: three black strokes behind a thrown person "look really bad… like a
  // ladder"). To come back, if at all, as something pale and soft with no ink line round it.
  if (!SPEED_LINES || !b || sp < 2.2) {
    a.lines?.release();
    a.lines = null;
    return;
  }
  a.lines ??= stage.spawnMesh(speedLinesMesh(), HIDE);
  const g = flightGrow(airOf(b as never));
  const len = Math.min(0.7, sp * 0.06) * g;
  // Z along the way it goes (the strokes run back from it), X level across, Y the rest.
  const zx = b.vx / sp, zy = b.vy / sp, zz = b.vz / sp;
  let xx = zz, xz = -zx;
  const xl = Math.hypot(xx, xz) || 1;
  xx /= xl;
  xz /= xl;
  const yx = zy * xz, yy = zz * xx - zx * xz, yz = -zy * xx;
  a.lines.setMatrix([xx * g, 0, xz * g, 0, yx * g, yy * g, yz * g, 0, zx * len, zy * len, zz * len, 0, b.x, b.y, b.z, 1]);
}

function dropArt(a: Art): void {
  a.lines?.release();
  a.lines = null;
  for (const h of a.stars) h.release();
  a.stars = [];
  a.hat?.release();
  a.hat = null;
}

function drawArt(st: State, stage: LifeStage, t: Thrown, a: Art): void {
  const b = t.body;
  speedLines(stage, a, b.phase === 'fly' && !b.upright ? b : null);
  // Stars round the head while they lie dizzy, and for the first moments of sitting up.
  const dizzy = b.upright && (b.phase === 'lie' || b.phase === 'roof' || b.phase === 'slide' || (b.phase === 'up' && t.fetch === null && b.t < 0.7));
  if (dizzy && a.stars.length === 0) {
    starMesh ??= dazeStarMesh();
    for (let i = 0; i < STARS.n; i++) a.stars.push(stage.spawnMesh(starMesh, HIDE));
  } else if (!dizzy && a.stars.length > 0) {
    for (const h of a.stars) h.release();
    a.stars = [];
  }
  if (dizzy) {
    // Where the head is: up over the hips sitting; behind the feet on the back; ahead of them face down.
    const sitting = b.phase === 'up' || (b.phase === 'lie' && b.rest === 'sit');
    const along = sitting ? 0 : b.rest === 'front' && b.phase === 'lie' ? 0.36 : -0.36;
    const hx = b.x + Math.sin(b.heading) * along;
    const hz = b.z + Math.cos(b.heading) * along;
    const hy = b.y + (sitting ? 0.42 : 0.14);
    const tick = Math.floor(st.time * STARS.rate) / STARS.rate;
    const sc = STARS.size;
    const spin = tick * STARS.speed + (b.seed % 7);
    a.stars.forEach((h, i) => {
      const ang = spin + (i / STARS.n) * Math.PI * 2;
      const c = Math.cos(-ang) * sc, s = Math.sin(-ang) * sc;
      h.setMatrix([c, 0, -s, 0, 0, sc, 0, 0, s, 0, c, 0, hx + Math.cos(ang) * STARS.r * sc, hy + Math.sin(ang * 2) * 0.015, hz + Math.sin(ang) * STARS.r * sc, 1]);
    });
  }
  // The hat, off the head.
  const hat = t.hat;
  if (hat && !a.hat) a.hat = stage.spawnMesh(t.loose ? carriedMesh(t.loose) : strawHatMesh(t.hatColor), HIDE);
  if (!hat && a.hat) {
    a.hat.release();
    a.hat = null;
  }
  if (hat && a.hat) {
    if (hat.upright) {
      // Lying crown up where it came down (floating, in the water).
      const y = hat.phase === 'swim' ? SEA_Y + 0.005 : hat.y + 0.002;
      a.hat.setMatrix(place(hat.x, y, hat.z, hat.heading, 1, 1, 1, mat));
    } else {
      quatToMat3(hat.q, m3);
      a.hat.setMatrix([m3[0]!, m3[1]!, m3[2]!, 0, m3[3]!, m3[4]!, m3[5]!, 0, m3[6]!, m3[7]!, m3[8]!, 0, hat.x, hat.y, hat.z, 1]);
    }
  }
}

function stepShaking(st: State, stage: LifeStage, real: LifeStage, t: Thrower, dt: number): void {
  const want = t.shake;
  let sh = st.shaking;
  if (want && !want.let && (!sh || sh.sid !== want.sid) && st.shape) {
    if (sh) endShaking(sh);
    const s = st.shape.structures.get(want.sid as never);
    if (!s || s.cells.length === 0) {
      t.shake = null;
      return;
    }
    let x = 0, z = 0, lo = Infinity, hi = -Infinity;
    for (const c of s.cells) {
      x += keyX(c) + 0.5;
      z += keyZ(c) + 0.5;
      lo = Math.min(lo, keyY(c));
      hi = Math.max(hi, keyY(c));
    }
    sh = st.shaking = { sid: want.sid, h: stage.liftStructure(want.sid as never), cx: x / s.cells.length, cy: lo * CELL_H, cz: z / s.cells.length, top: (hi + 1) * CELL_H, t: 0, down: -1, tiles: [], nextTile: 0.25, told: false };
  }
  if (!sh) return;
  if (want?.let || !want) sh.down = sh.down < 0 ? 0 : sh.down;
  sh.t += dt;
  // Whoever is inside comes out of the door, startled.
  if (!sh.told) {
    sh.told = true;
    const crowd = st.crowd;
    for (const p of crowd?.people ?? []) if (p.home === sh.sid || p.inside?.structure === sh.sid) crowd!.rethink(p);
  }
  let lift: number, tiltX: number, tiltZ: number;
  if (sh.down < 0) {
    // Held: up a little, rocking side to side on twos.
    const k = Math.floor(sh.t * 8);
    lift = Math.min(0.18, sh.t * 0.8) + (k % 2) * 0.02;
    tiltX = (k % 4 < 2 ? 1 : -1) * 0.065;
    tiltZ = (k % 3 === 0 ? 1 : -1) * 0.045;
    sh.nextTile -= dt;
    if (sh.nextTile <= 0 && sh.tiles.length < 6) {
      sh.nextTile = 0.35 + (sh.tiles.length % 3) * 0.2;
      const a = sh.tiles.length * 2.4 + sh.sid;
      sh.tiles.push({ h: stage.spawnMesh(looseTileMesh(), HIDE), x: sh.cx + Math.cos(a) * 0.45, y: sh.top + lift, z: sh.cz + Math.sin(a) * 0.45, vx: Math.cos(a) * 0.8, vy: 0.6, vz: Math.sin(a) * 0.8, spin: 6 + (sh.tiles.length % 3) * 3, age: 0, rest: -1 });
    }
  } else {
    // Let go: down onto its foundations with a little bump, and baked back into the town.
    sh.down += dt;
    const u = Math.min(1, sh.down / 0.35);
    lift = (1 - u) * 0.18 + (u >= 1 ? 0 : Math.sin(u * Math.PI) * 0.02);
    tiltX = tiltZ = 0;
    if (u >= 1 && sh.h) {
      sh.h.setMatrix(sh.h.base);
      sh.h.release();
      sh.h = null;
      const k = farScale();
      fxOf(real).play(DUST, 0.6, (v, m) => place(sh!.cx, sh!.cy + 0.05 + v * 0.2, sh!.cz, 0, (0.6 + v * 0.6) * k, (0.3 + v * 0.3) * k, (0.6 + v * 0.6) * k, m));
    }
  }
  if (sh.h) {
    // T(c) · Rx(tiltX) · Rz(tiltZ) · T(−c) · lift, on the structure's own (world-space) base.
    const cx = Math.cos(tiltX), sx = Math.sin(tiltX), cz = Math.cos(tiltZ), sz = Math.sin(tiltZ);
    const r = [cz, sz, 0, -sz * cx, cz * cx, sx, sz * sx, -cz * sx, cx];
    const px = sh.cx, py = sh.cy, pz = sh.cz;
    const tx = px - (r[0]! * px + r[3]! * py + r[6]! * pz), ty = py - (r[1]! * px + r[4]! * py + r[7]! * pz) + lift, tz = pz - (r[2]! * px + r[5]! * py + r[8]! * pz);
    sh.h.setMatrix(mulM([r[0]!, r[1]!, r[2]!, 0, r[3]!, r[4]!, r[5]!, 0, r[6]!, r[7]!, r[8]!, 0, tx, ty, tz, 1], sh.h.base));
  }
  // The tiles: off the roof, tumbling down, lying where they land a while, then swept up (into a puff).
  for (let i = sh.tiles.length - 1; i >= 0; i--) {
    const tl = sh.tiles[i]!;
    tl.age += dt;
    if (tl.rest < 0) {
      tl.vy -= 9 * dt;
      tl.x += tl.vx * dt;
      tl.y += tl.vy * dt;
      tl.z += tl.vz * dt;
      const g = t.ground?.surface(tl.x, tl.z, tl.y + 0.05);
      if (g && tl.y <= (g.water ? SEA_Y : g.h)) {
        tl.y = g.water ? SEA_Y : g.h;
        tl.rest = 0;
      }
    } else tl.rest += dt;
    tl.h.setMatrix(place(tl.x, tl.y, tl.z, tl.age * tl.spin, 1, 1, 1, new Array<number>(16)));
  }
  if (!sh.h && sh.down >= 0 && sh.tiles.every((tl) => tl.rest > 4)) {
    for (const tl of sh.tiles) {
      const x = tl.x, y = tl.y, z = tl.z;
      fxOf(real).play(DUST, 0.4, (v, m) => place(x, y + 0.02 + v * 0.06, z, 0, 0.12 + v * 0.15, 0.12 + v * 0.15, 0.12 + v * 0.15, m));
    }
    endShaking(sh);
    st.shaking = null;
    if (t.shake?.let) t.shake = null;
  }
}

function endShaking(sh: Shaking): void {
  if (sh.h) {
    sh.h.setMatrix(sh.h.base);
    sh.h.release();
    sh.h = null;
  }
  for (const tl of sh.tiles) tl.h.release();
  sh.tiles = [];
}

/** a · b, column-major. */
function mulM(a: number[], b: ArrayLike<number>): number[] {
  const o = new Array<number>(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r]! += a[k * 4 + r]! * b[c * 4 + k]!;
  return o;
}

export default defineSystem<State>({
  id: 'mischief.thrown',
  // After the director (the mischief system, 10) has told of a blast; before the people are drawn (20).
  order: 15,
  create(ctx) {
    const st: State = { shaking: null, ring: null, shadows: [], d: mischiefOf(ctx.stage), own: ownStage(ctx.stage), crowd: null, thrower: null, shape: null, nav: null, art: new Map(), critterArt: new Map(), critterLines: new Map(), spouts: [], time: 0, off: () => {} };
    st.off = st.d.on((e) => onEvent(st, e));
    return st;
  },
  sync(st, next) {
    // The building in the Hand changed under it (a mend, an undo): let go of it at once.
    if (st.shaking && next.shape !== st.shape) {
      const was = st.shape?.structures.get(st.shaking.sid as never), now = next.shape.structures.get(st.shaking.sid as never);
      if (!now || was?.hash !== now.hash) {
        endShaking(st.shaking);
        st.shaking = null;
        if (st.thrower) st.thrower.shake = null;
      }
    }
    st.shape = next.shape;
    if (next.dressing) st.nav = next.dressing.nav;
    st.thrower?.sync(next.shape, st.nav);
  },
  update(st, dt, _signals, ctx) {
    st.time += dt;
    const crowd = crowdOf(ctx.stage);
    if (crowd !== st.crowd) {
      st.thrower?.reset();
      for (const a of st.art.values()) dropArt(a);
      st.art.clear();
      st.crowd = crowd;
      st.thrower = crowd ? createThrower(crowd, crittersOf(ctx.stage)) : null;
      if (st.thrower) {
        throwers.set(ctx.stage, st.thrower);
        const stage0 = ctx.stage;
        st.thrower.capsize = (c, x, z, yaw) => capsizeBoat(stage0, c.id.slice('boat:'.length), x, z, yaw, st.d.clock);
        // The debug handle (sequences, browser tests), as window.__lcPeople is the crowd's.
        (globalThis as { __lcThrown?: unknown }).__lcThrown = { thrower: st.thrower, critters: crittersOf(ctx.stage) };
        if (st.shape) st.thrower.sync(st.shape, st.nav);
      } else throwers.delete(ctx.stage);
    }
    const t = st.thrower;
    if (!t) return;
    t.step(dt);
    const stage = st.own.stage;
    for (const [k, a] of st.art) {
      if (t.thrown.get(k.person) === k) continue;
      dropArt(a);
      st.art.delete(k);
    }
    for (const th of t.thrown.values()) {
      let a = st.art.get(th);
      if (!a) st.art.set(th, (a = { stars: [], hat: null, hatColor: th.hatColor }));
      // What happened to it since the last frame: a splash, a puff of dust where it hit.
      for (const ev of th.events) {
        const b = th.body;
        if (ev === 'splash') {
          const h = stage.spawnMesh(spoutMesh(), [0.45, 0, 0, 0, 0, 0.001, 0, 0, 0, 0, 0.45, 0, b.x, SEA_Y - 0.02, b.z, 1]);
          st.spouts.push({ h, age: 0 });
        } else if (ev === 'land' || ev === 'bounce' || ev === 'wall' || ev === 'roof') {
          const x = b.x, y = b.upright ? b.y : b.y - b.radius, z = b.z;
          const k = farScale();
          fxOf(ctx.stage).play(DUST, 0.5, (u, m) => place(x, y + 0.03 + u * 0.12 * k, z, 0, (0.2 + u * 0.35) * k, (0.2 + u * 0.35) * k, (0.2 + u * 0.35) * k, m));
        }
      }
      th.events.length = 0;
      drawArt(st, stage, th, a);
    }
    // Animals: a splash, a puff, stars round the head while they lie on their backs.
    for (const [c, hs] of st.critterArt) {
      if (c.body && t.critterEvents.has(c)) continue;
      for (const h of hs) h.release();
      st.critterArt.delete(c);
    }
    for (const [c, l] of st.critterLines) {
      if (c.body && t.critterEvents.has(c)) continue;
      l.lines?.release();
      st.critterLines.delete(c);
    }
    for (const [c, evs] of t.critterEvents) {
      const b = c.body;
      if (!b) continue;
      let l = st.critterLines.get(c);
      if (!l) st.critterLines.set(c, (l = {}));
      speedLines(stage, l, b.phase === 'fly' && !b.upright ? b : null);
      for (const ev of evs) {
        if (ev === 'splash') {
          // As big as what came down (a galleon's is a great one).
          const w = Math.max(0.35, c.height * 1.6);
          st.spouts.push({ h: stage.spawnMesh(spoutMesh(), [w, 0, 0, 0, 0, 0.001, 0, 0, 0, 0, w, 0, b.x, SEA_Y - 0.02, b.z, 1]), age: 0 });
        }
        else if (ev === 'land' || ev === 'bounce' || ev === 'wall' || ev === 'roof') {
          const x = b.x, y = b.upright ? b.y : b.y - b.radius, z = b.z;
          fxOf(ctx.stage).play(DUST, 0.4, (u, m) => place(x, y + 0.03 + u * 0.08, z, 0, 0.14 + u * 0.24, 0.14 + u * 0.24, 0.14 + u * 0.24, m));
        }
      }
      evs.length = 0;
      const dizzy = b.upright && (b.phase === 'lie' || b.phase === 'roof' || b.phase === 'slide');
      let hs = st.critterArt.get(c);
      if (dizzy && !hs) {
        starMesh ??= dazeStarMesh();
        st.critterArt.set(c, (hs = [0, 1, 2].map(() => stage.spawnMesh(starMesh!, HIDE))));
      } else if (!dizzy && hs) {
        for (const h of hs) h.release();
        st.critterArt.delete(c);
        hs = undefined;
      }
      if (hs) {
        const tick = Math.floor(st.time * STARS.rate) / STARS.rate;
        const sc = STARS.size * 0.8;
        const hx = b.x + Math.sin(b.heading) * c.height * 0.4, hz = b.z + Math.cos(b.heading) * c.height * 0.4, hy = b.y + c.height * 0.9;
        hs.forEach((h, i) => {
          const ang = tick * STARS.speed + (i / 3) * Math.PI * 2;
          const cc = Math.cos(-ang) * sc, ss = Math.sin(-ang) * sc;
          h.setMatrix([cc, 0, -ss, 0, 0, sc, 0, 0, ss, 0, cc, 0, hx + Math.cos(ang) * 0.09 * sc, hy, hz + Math.sin(ang) * 0.09 * sc, 1]);
        });
      }
    }
    // The Hand: a ring round what it could pick up; under what it holds, a shadow and a line down to it.
    const hv = t.hover?.() ?? null;
    if (hv) {
      st.ring ??= stage.spawnMesh(handRingMesh(), HIDE);
      const pulse = 1 + 0.08 * (Math.floor(st.time * 6) % 2);
      st.ring.setMatrix(place(hv.x, hv.y + 0.02, hv.z, 0, hv.r * pulse, 1, hv.r * pulse, mat));
    } else if (st.ring) {
      st.ring.release();
      st.ring = null;
    }
    const held: { x: number; y: number; z: number; r: number }[] = [];
    for (const th of t.thrown.values()) if (th.body.phase === 'held' && !t.beamed.has(th.person)) held.push({ x: th.body.x, y: th.body.y, z: th.body.z, r: 0.3 });
    for (const c of t.critterEvents.keys()) if (c.body?.phase === 'held') held.push({ x: c.body.x, y: c.body.y, z: c.body.z, r: Math.max(0.25, c.height * 1.2) });
    while (st.shadows.length > held.length) st.shadows.pop()!.release();
    const g = t.ground;
    held.forEach((hd, i) => {
      const h = (st.shadows[i] ??= stage.spawnMesh(heldShadowMesh(), HIDE));
      const s = g ? g.surface(hd.x, hd.z, hd.y - 0.1) : null;
      const gy = s ? (s.water ? SEA_Y : s.h) + 0.01 : 0;
      const drop = Math.max(0.01, hd.y - 0.25 - gy);
      // The disc flat (scaled in x, z), the line up the y axis to just under it.
      h.setMatrix([hd.r, 0, 0, 0, 0, drop, 0, 0, 0, 0, hd.r, 0, hd.x, gy, hd.z, 1]);
    });
    // A building in the Hand: up a hand's breadth, wobbling on its foundations, tiles sliding off; let go, it
    // settles back with a bump, exactly where it was.
    stepShaking(st, stage, ctx.stage, t, dt);
    // Splashes: up and back down into the water.
    for (let i = st.spouts.length - 1; i >= 0; i--) {
      const s = st.spouts[i]!;
      s.age += dt;
      const k = Math.min(1, s.age / 0.9);
      const m = Array.from(s.h.base);
      m[5] = Math.sin(k * Math.PI) * 1.2 * m[0]! + 0.001;
      s.h.setMatrix(m);
      if (k >= 1) {
        s.h.release();
        st.spouts.splice(i, 1);
      }
    }
  },
  dispose(st, ctx) {
    st.off();
    st.thrower?.reset();
    throwers.delete(ctx.stage);
    st.art.clear();
    st.spouts = [];
    st.ring = null;
    st.shadows = [];
    if (st.shaking) endShaking(st.shaking);
    st.shaking = null;
    st.own.releaseAll();
  },
});
