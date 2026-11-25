// The UFO (design section 13b; Derek: "a UFO flies in and then sucks up a
// random person with a ray beam, and the person flies around and says
// 'help!' as he gets abducted. If there's no people to abduct it should just
// fly in and then fly away"). Owner: Mischief.
//
// Called by a click of the Mischief drawer's UFO (`ufosOf(stage).call`); at
// most three at once (a fourth click is refused). Each, beat by beat:
//
//   in     from beyond the map's edge, high, fast: a swoop down and a stop
//          over whoever it has picked (somebody out of doors, the nearest to
//          the click within reach, else anyone), its round shadow on the town
//   beam   a cone of pale light comes down and pools on the ground (0.5 s)
//   lift   they are taken off their feet (thrower.grab, as the Hand does:
//          their errand falls through) and rise in the beam, slowly at first,
//          turning, legs kicking, shouting "HELP!", a straw hat or what they
//          carried dropping; those near stop and look up
//   in through the hatch (out of sight; nobody shrinks), the beam closes
//   away  it tilts and shoots off over the edge
//   gone  20–40 s
//   back  in again over somewhere else in the town, beams them down, lets
//          go a little above the ground: they land dizzy (thrower.fling),
//          get up and walk home; and it leaves.
//   seek  (nobody out of doors) it hovers and sweeps its beam about the empty
//          street as if looking, gives up, and leaves.
//
// A nuke going off under a hovering saucer drops its catch and sends it off
// spinning. Undo, a called-off act, a new or opened town: gone at once, the
// person on their feet (the thrower's reset). Nothing saved changes. Every
// handle goes through the owned stage.

import { SEA_Y } from '@/core/grid';
import { rand } from '@/core/rand';
import { defineSystem, type InstanceHandle, type LifeStage } from '../api';
import { crowdOf } from '../doors/table';
import type { Crowd, Person } from '../people/crowd';
import { nodeCentre, nodeHeight } from '../people/walk';
import { mischiefOf, type Director } from './director';
import { ownStage, type Owned } from './owned';
import { throwerOf } from './thrown.system';
import type { Thrower } from './thrower';
import { alienMesh, coneMesh, domeMesh, helpMesh, lightsMesh, motesMesh, poolMesh, rimMesh, ringsMesh, SAUCER, saucerMesh, ufoShadowMesh } from './ufo-art';

export const UFO = {
  /** At most this many at once. */
  most: 3,
  /** How near the click it looks for somebody first (cells). */
  near: 8,
  /** Seconds: flying in, the beam coming on, the lift's longest, flying off, away, beaming back down, the empty search. */
  arrive: 2.4,
  beamOn: 0.5,
  lift: 4,
  leave: 1.6,
  awayMin: 20,
  awayMax: 40,
  lower: 2.4,
  seek: 3.2,
  /** How high it hovers over the highest roof near it, and how high it comes in and goes out. */
  clear: 1.7,
  high: 8,
  /** Seconds it spins up and tilts before it zips off. */
  prep: 0.55,
  /** How far from where it took them it brings them back (cells, at least). */
  elsewhere: 6,
} as const;

export type UfoPhase = 'in' | 'beam' | 'lift' | 'seek' | 'away' | 'gone' | 'back' | 'drop' | 'leave' | 'done';

export interface Saucer {
  readonly n: number;
  phase: UfoPhase;
  t: number;
  x: number;
  y: number;
  z: number;
  /** Where it flies from and to in this phase. */
  from: { x: number; y: number; z: number };
  to: { x: number; y: number; z: number };
  /** The ground under its hover point. */
  ground: number;
  /** Whoever it came for (picked, in the beam, aboard, coming back down), or null. */
  person: Person | null;
  aboard: boolean;
  /** Seconds it stays away with them. */
  away: number;
  spin: number;
  /** The beam: how far on (0–1), and its lean while it searches. */
  beam: number;
  lean: number;
  leanYaw: number;
  /** The grip in the beam (where the person is held). */
  gy: number;
  /** Its velocity on the ground plan (for its tilt), and the way it last came in (for the wobble as it stops). */
  vx: number;
  vz: number;
  ax: number;
  az: number;
  /** Handles: hull, dome, pilot, lights (two halves), cone, rings, pool, rim, motes, shadow, balloon. */
  h: InstanceHandle[];
}

export interface Ufos {
  readonly saucers: readonly Saucer[];
  /** A click with the UFO: one comes for somebody near (x, z). False if three are about already. */
  call(x: number, y: number, z: number): boolean;
}

const registry = new WeakMap<LifeStage, Ufos>();
export function ufosOf(stage: LifeStage): Ufos | null {
  return registry.get(stage) ?? null;
}

/** The pool of light's radius on the ground (the beam's foot, a little wider). */
const BEAM_POOL = SAUCER.r * 1.0;
const HIDE = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, -50, 0, 1];
const easeOut = (u: number): number => 1 - (1 - u) ** 3;
const easeInOut = (u: number): number => u * u * (3 - 2 * u);

interface State {
  d: Director;
  own: Owned;
  list: Saucer[];
  n: number;
  time: number;
  night: boolean;
  /** A click waiting for the next update (the stage's town and crowd are read there). */
  calls: { x: number; y: number; z: number }[];
  off: () => void;
  ufos: Ufos;
  m: number[];
}

/** Can the UFO take this person (anybody the Hand could pick up, out of doors)? */
function takeable(p: Person, list: readonly Saucer[]): boolean {
  if (!p.visible || p.mode === 'home' || p.mode === 'visit' || p.mode === 'gone' || p.mode === 'thrown' || p.shutIn || p.inCloud || p.fade < 1) return false;
  return !list.some((s) => s.person === p);
}

/** Somebody out of doors: the nearest to (x, z) within UFO.near, else anybody (by the saucer's number). */
function pickPerson(crowd: Crowd, list: readonly Saucer[], x: number, z: number, n: number): Person | null {
  let best: Person | null = null, bestD: number = UFO.near;
  const all: Person[] = [];
  for (const p of crowd.people) {
    if (!takeable(p, list)) continue;
    all.push(p);
    const d = Math.hypot(p.x - x, p.z - z);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  if (best) return best;
  if (all.length === 0) return null;
  return all[Math.floor(rand(n, 'ufo-pick') * all.length)]!;
}

/** The highest thing near (x, z) (roofs included): it hovers clear above it. */
function topNear(t: Thrower | null, x: number, z: number): { top: number; ground: number } {
  const g = t?.ground;
  if (!g) return { top: 1, ground: 0.8 };
  let top = 0;
  for (const [ax, az] of [[0, 0], [0.8, 0], [-0.8, 0], [0, 0.8], [0, -0.8], [0.6, 0.6], [-0.6, -0.6]] as const) top = Math.max(top, g.surface(x + ax, z + az, 99).h);
  const s = g.surface(x, z, 99);
  return { top, ground: s.water ? SEA_Y : s.h };
}

/** A point beyond the map's edge, high up, on a side chosen by the saucer's number. */
function edgePoint(_x: number, _z: number, n: number, what: string): { x: number; y: number; z: number } {
  const side = Math.floor(rand(n, what) * 4);
  const along = 6 + rand(n, what, 'along') * 36;
  const out = -9;
  const p = side === 0 ? { x: along, z: out } : side === 1 ? { x: 48 - out, z: along } : side === 2 ? { x: along, z: 48 - out } : { x: out, z: along };
  return { x: p.x, y: UFO.high, z: p.z };
}

function phase(s: Saucer, p: UfoPhase): void {
  s.phase = p;
  s.t = 0;
}

/** Flies from `from` to `to` over `dur` seconds: fast, then a swoop down and a stop (in), or away rising and speeding up. */
function fly(s: Saucer, dur: number, arriving: boolean, from = 0): number {
  const u = Math.max(0, Math.min(1, (s.t - from) / dur));
  const k = arriving ? easeOut(u) : u * u;
  s.x = s.from.x + (s.to.x - s.from.x) * k;
  s.z = s.from.z + (s.to.z - s.from.z) * k;
  // The swoop: below the line on the way in, and up into the stop.
  s.y = s.from.y + (s.to.y - s.from.y) * k - (arriving ? Math.sin(u * Math.PI) * 1.2 : 0);
  return u;
}

function create(st: State, stage: LifeStage, x: number, y: number, z: number): boolean {
  if (st.list.length >= UFO.most) return false;
  const crowd = crowdOf(stage);
  const t = throwerOf(stage);
  const n = ++st.n;
  const person = crowd ? pickPerson(crowd, st.list, x, z, n) : null;
  const over = person ? { x: person.x, z: person.z } : { x, z };
  const { top, ground } = topNear(t, over.x, over.z);
  const from = edgePoint(over.x, over.z, n, 'in');
  const own = st.own.stage;
  const s: Saucer = {
    n, phase: 'in', t: 0, x: from.x, y: from.y, z: from.z, from, to: { x: over.x, y: Math.max(top, ground) + UFO.clear, z: over.z }, ground,
    person, aboard: false, away: UFO.awayMin + rand(n, 'away') * (UFO.awayMax - UFO.awayMin), spin: 0, beam: 0, lean: 0, leanYaw: 0, gy: 0,
    vx: 0, vz: 0, ax: 1, az: 0,
    h: [saucerMesh(), domeMesh(), alienMesh(), lightsMesh(0), lightsMesh(1), coneMesh(), ringsMesh(), poolMesh(), rimMesh(), motesMesh(), ufoShadowMesh(), helpMesh()].map((m) => {
      const h = own.spawnMesh(m, HIDE);
      h.setVisible(false);
      return h;
    }),
  };
  void y;
  st.list.push(s);
  return true;
}

/** The whole of one saucer's step. */
function step(st: State, stage: LifeStage, s: Saucer, dt: number): void {
  s.t += dt;
  const x0 = s.x, z0 = s.z;
  // Spinning gently while it hovers; spinning up before it zips off.
  const going = s.phase === 'away' || s.phase === 'leave';
  s.spin += dt * (going ? 1.2 + Math.min(1, s.t / UFO.prep) * 9 : 1.2);
  const t = throwerOf(stage);
  const crowd = crowdOf(stage);
  const p = s.person;
  switch (s.phase) {
    case 'in': {
      if (fly(s, UFO.arrive, true) < 1) break;
      // Whoever it came for may have gone in meanwhile: anybody else near, else it searches.
      if (!p || (!takeable(p, st.list.filter((o) => o !== s)) && !s.aboard)) {
        s.person = crowd ? pickPerson(crowd, st.list.filter((o) => o !== s), s.x, s.z, s.n) : null;
        if (s.person && Math.hypot(s.person.x - s.x, s.person.z - s.z) > 2.5) s.person = null;
      }
      phase(s, s.person ? 'beam' : 'seek');
      break;
    }
    case 'beam': {
      s.beam = Math.min(1, s.t / UFO.beamOn);
      if (p && Math.hypot(p.x - s.x, p.z - s.z) < 3) {
        // Over them as they stand (they may have walked a step).
        s.x += (p.x - s.x) * Math.min(1, dt * 3);
        s.z += (p.z - s.z) * Math.min(1, dt * 3);
      }
      if (s.t < UFO.beamOn) break;
      if (!p || !t || !t.grab(p)) {
        s.person = null;
        phase(s, 'seek');
        break;
      }
      // Off their feet: what they carry (or a straw hat) drops back to the ground.
      t.beamed.add(p);
      t.knockLoose(p);
      s.gy = p.y + 0.35;
      phase(s, 'lift');
      break;
    }
    case 'lift': {
      if (!p || !t || !t.thrown.has(p)) {
        s.person = null;
        phase(s, 'leave');
        break;
      }
      // Slowly at first, then faster, up toward the hatch; turning as they go.
      s.gy += (0.25 + s.t * 0.8) * dt;
      const hatch = s.y - 0.02;
      const b = t.thrown.get(p)!.body;
      b.heading += dt * 1.6;
      const k = Math.min(1, dt * 1.5);
      t.carry(p, b.x + (s.x - b.x) * k, Math.min(s.gy, hatch + 0.3), b.z + (s.z - b.z) * k);
      if (s.gy >= hatch + 0.3 || s.t > UFO.lift + 4) {
        // In through the hatch: out of sight inside it.
        s.aboard = true;
        p.visible = false;
        phase(s, 'away');
        s.from = { x: s.x, y: s.y, z: s.z };
        s.to = edgePoint(s.x, s.z, s.n, 'out');
      }
      break;
    }
    case 'seek': {
      // The beam sweeps round the empty street, as if looking.
      s.beam = Math.min(1, s.t / UFO.beamOn) * (s.t > UFO.seek - 0.4 ? Math.max(0, (UFO.seek - s.t) / 0.4) : 1);
      s.lean = 0.32 * Math.min(1, s.t / 0.8);
      s.leanYaw = s.t * 2.2;
      if (s.t < UFO.seek) break;
      s.lean = 0;
      s.beam = 0;
      s.from = { x: s.x, y: s.y, z: s.z };
      s.to = edgePoint(s.x, s.z, s.n, 'out');
      phase(s, 'leave');
      break;
    }
    case 'away':
    case 'leave': {
      s.beam = Math.max(0, s.beam - dt * 3);
      // A moment to spin up and tilt, then off.
      const u = fly(s, UFO.leave, false, UFO.prep);
      if (p && s.aboard && t) t.carry(p, s.x, s.y + 0.1, s.z);
      if (u < 1) break;
      if (s.phase === 'leave' || !p) {
        phase(s, 'done');
        break;
      }
      phase(s, 'gone');
      break;
    }
    case 'gone': {
      if (p && t) t.carry(p, s.x, s.y + 0.1, s.z);
      if (s.t < s.away) break;
      // Somewhere else in the town: a walkable spot away from where it took them.
      const spot = crowd ? dropSpot(crowd, s) : null;
      if (!spot || !p) {
        if (p && t) {
          p.visible = true;
          t.beamed.delete(p);
          t.fling(p, 0, 0, 0, { dizzy: 2 });
        }
        s.person = null;
        phase(s, 'done');
        break;
      }
      const { top, ground } = topNear(t, spot.x, spot.z);
      s.from = edgePoint(spot.x, spot.z, s.n, 'back');
      s.x = s.from.x;
      s.y = s.from.y;
      s.z = s.from.z;
      s.to = { x: spot.x, y: Math.max(top, ground) + UFO.clear, z: spot.z };
      s.ground = spot.y;
      phase(s, 'back');
      break;
    }
    case 'back': {
      const u = fly(s, UFO.arrive, true);
      if (p && t) t.carry(p, s.x, s.y + 0.1, s.z);
      if (u < 1) break;
      phase(s, 'drop');
      break;
    }
    case 'drop': {
      s.beam = Math.min(1, s.t / UFO.beamOn);
      if (!p || !t || !t.thrown.has(p)) {
        s.person = null;
        phase(s, 'leave');
        break;
      }
      const b = t.thrown.get(p)!.body;
      if (s.t < UFO.beamOn) {
        t.carry(p, s.x, s.y + 0.1, s.z);
        break;
      }
      // Out of the hatch, down the beam, turning; let go a little above the ground.
      if (s.aboard) {
        s.aboard = false;
        p.visible = true;
      }
      const u = Math.min(1, (s.t - UFO.beamOn) / UFO.lower);
      b.heading += dt * 1.2;
      t.carry(p, s.x, s.y - 0.02 + (s.ground + 0.75 - s.y) * easeInOut(u), s.z);
      if (u < 1) break;
      t.fling(p, 0, -0.4, 0, { dizzy: 3.5, spin: 1.5 });
      t.beamed.delete(p);
      s.person = null;
      s.from = { x: s.x, y: s.y, z: s.z };
      s.to = edgePoint(s.x, s.z, s.n, 'gone');
      phase(s, 'leave');
      break;
    }
    case 'done':
      break;
  }
  if (dt > 0) {
    s.vx = (s.x - x0) / dt;
    s.vz = (s.z - z0) / dt;
    if (s.phase === 'in' || s.phase === 'back') {
      const l = Math.hypot(s.vx, s.vz);
      if (l > 0.5) {
        s.ax = s.vx / l;
        s.az = s.vz / l;
      }
    }
  }
}

/** Where it brings them back: a walkable spot (a street, a square, the beach) away from where it took them. */
function dropSpot(crowd: Crowd, s: Saucer): { x: number; y: number; z: number } | null {
  const nav = crowd.nav;
  if (!nav || nav.nodes.length === 0) return null;
  const took = s.from;
  for (let k = 0; k < 40; k++) {
    const i = Math.floor(rand(s.n, 'drop', k) * nav.nodes.length);
    const node = nav.nodes[i]!;
    if (node.rot !== undefined || node.passage !== undefined) continue;
    const c = nodeCentre(nav, i);
    if (k < 30 && Math.hypot(c.x - took.x, c.z - took.z) < UFO.elsewhere) continue;
    return { x: c.x, y: nodeHeight(nav, i), z: c.z };
  }
  return null;
}

const tilted = new Array<number>(16).fill(0);
const sub = new Array<number>(16).fill(0);
/** out = a · b (column-major 4×4). */
function mul(a: number[], b: number[], out: number[]): number[] {
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let v = 0;
      for (let k = 0; k < 4; k++) v += a[k * 4 + r]! * b[c * 4 + k]!;
      out[c * 4 + r] = v;
    }
  }
  return out;
}
/** A turn by `ang` about the level axis (ax, 0, az), after a turn about y by `yaw`, at (x, y, z): into `m`. */
function placeTilted(m: number[], x: number, y: number, z: number, ax: number, az: number, ang: number, yaw: number): void {
  const c = Math.cos(ang), sn = Math.sin(ang), cs = Math.cos(yaw), ss = Math.sin(yaw);
  const r00 = c + ax * ax * (1 - c), r01 = az * sn, r02 = ax * az * (1 - c);
  const r10 = -az * sn, r11 = c, r12 = ax * sn;
  const r20 = ax * az * (1 - c), r21 = -ax * sn, r22 = c + az * az * (1 - c);
  // Tilt · Ry(yaw): the y-turn's columns (cs, 0, −ss) and (ss, 0, cs) taken through the tilt.
  m[0] = r00 * cs - r20 * ss; m[1] = r01 * cs - r21 * ss; m[2] = r02 * cs - r22 * ss; m[3] = 0;
  m[4] = r10; m[5] = r11; m[6] = r12; m[7] = 0;
  m[8] = r00 * ss + r20 * cs; m[9] = r01 * ss + r21 * cs; m[10] = r02 * ss + r22 * cs; m[11] = 0;
  m[12] = x; m[13] = y; m[14] = z; m[15] = 1;
}

/** Where things are drawn now. */
function draw(st: State, s: Saucer): void {
  const [hull, dome, alien, la, lb, cone, rings, pool, rim, motes, shadow, help] = s.h as [InstanceHandle, InstanceHandle, InstanceHandle, InstanceHandle, InstanceHandle, InstanceHandle, InstanceHandle, InstanceHandle, InstanceHandle, InstanceHandle, InstanceHandle, InstanceHandle];
  const m = st.m;
  const shown = s.phase !== 'gone' && s.phase !== 'done';
  hull.setVisible(shown);
  dome.setVisible(shown);
  alien.setVisible(shown);
  // Its tilt: into its flight (banking with its speed); a wobble as it stops; a lean before it zips off.
  const sp = Math.hypot(s.vx, s.vz);
  let ax = 1, az = 0, ang = 0;
  if (sp > 0.3) {
    ax = s.vz / sp;
    az = -s.vx / sp;
    ang = Math.min(0.42, sp * 0.035);
  }
  if ((s.phase === 'beam' || s.phase === 'seek' || s.phase === 'drop') && s.t < 1.4) {
    ax = s.az;
    az = -s.ax;
    ang = 0.2 * Math.exp(-3 * s.t) * Math.sin(s.t * 13);
  }
  const going = s.phase === 'away' || s.phase === 'leave';
  if (going && s.t < UFO.prep) {
    const ox = s.to.x - s.from.x, oz = s.to.z - s.from.z, ol = Math.hypot(ox, oz) || 1;
    ax = oz / ol;
    az = -ox / ol;
    ang = -0.3 * (s.t / UFO.prep);
  }
  // A gentle bob while it hovers.
  const bob = sp < 0.3 ? Math.sin(st.time * 2.4 + s.n) * 0.05 : 0;
  const y = s.y + bob;
  placeTilted(m, s.x, y, s.z, ax, az, ang, s.spin);
  if (shown) {
    hull.setMatrix(m);
    dome.setMatrix(m);
    // The glass: a light tint, so the pilot shows through it.
    dome.setParams(0.3);
    // The pilot: sat in the dome, turning to look about; leaning over the dome's edge to peer down while it searches.
    const peer = s.phase === 'seek' ? Math.min(1, s.t / 0.6) * (s.t > UFO.seek - 0.5 ? Math.max(0, (UFO.seek - s.t) / 0.5) : 1) : 0;
    const look = s.phase === 'seek' ? s.leanYaw - s.spin : Math.sin(st.time * 0.9 + s.n) * 0.9;
    const cl = Math.cos(look), sl = Math.sin(look), lean = 0.55 * peer, cle = Math.cos(lean), sle = Math.sin(lean);
    const out = 0.12 * peer, h0 = SAUCER.under + SAUCER.over + 0.01;
    // T(out along its look, seat height) · Ry(look) · Rx(lean), on the saucer.
    sub[0] = cl; sub[1] = 0; sub[2] = -sl; sub[3] = 0;
    sub[4] = sl * sle; sub[5] = cle; sub[6] = cl * sle; sub[7] = 0;
    sub[8] = sl * cle; sub[9] = -sle; sub[10] = cl * cle; sub[11] = 0;
    sub[12] = sl * out; sub[13] = h0 + 0.02 * peer; sub[14] = cl * out; sub[15] = 1;
    alien.setMatrix(mul(m, sub, tilted));
  }
  // The rim's lights chase: the two halves in turn (and the antenna's tip blinks with the first).
  const half = Math.floor(st.time * 8) % 2;
  la.setVisible(shown && half === 0);
  lb.setVisible(shown && half === 1);
  if (shown) (half === 0 ? la : lb).setMatrix(m);
  // The beam: the cone, bands of light travelling along it, sparkles rising, the pool and its pulsing rim.
  const on = shown && s.beam > 0.01;
  cone.setVisible(on);
  rings.setVisible(on);
  pool.setVisible(on);
  rim.setVisible(on);
  motes.setVisible(on);
  if (on) {
    const len = Math.max(0.2, y - s.ground);
    const lean = s.lean, ly = s.leanYaw;
    const ox = Math.sin(ly) * Math.tan(lean) * len, oz = Math.cos(ly) * Math.tan(lean) * len;
    // The cone from the hatch to the ground (leaning while it searches): its −y axis runs to the foot.
    cone.setMatrix([1, 0, 0, 0, -ox, len, -oz, 0, 0, 0, 1, 0, s.x, y, s.z, 1]);
    cone.setParams(1.15 * s.beam, 0, 0, -1);
    // The bands: up the beam while it lifts somebody, down it while it sets them down (a quarter apart, wrapping).
    const dir = s.phase === 'drop' ? -1 : 1;
    const shift = (((st.time * 0.5 * dir) % 0.25) + 0.25) % 0.25;
    rings.setMatrix([1, 0, 0, 0, -ox, len, -oz, 0, 0, 0, 1, 0, s.x + ox * shift, y + len * shift, s.z + oz * shift, 1]);
    rings.setParams(1.5 * s.beam, 0, 0, -1);
    // Sparkles rising up it, wrapping.
    const rise = ((((st.time * 0.4 * dir) % 1) + 1) % 1) * 0.5;
    motes.setMatrix([1, 0, 0, 0, -ox, len, -oz, 0, 0, 0, 1, 0, s.x + ox * rise, y + len * rise, s.z + oz * rise, 1]);
    motes.setParams(1);
    const r = BEAM_POOL;
    pool.setMatrix([r, 0, 0, 0, 0, 1, 0, 0, 0, 0, r, 0, s.x + ox, s.ground + 0.02, s.z + oz, 1]);
    pool.setParams(1.1 * s.beam, 0, 0, -1);
    const pulse = r * (1 + 0.1 * Math.sin(st.time * 7));
    rim.setMatrix([pulse, 0, 0, 0, 0, 1, 0, 0, 0, 0, pulse, 0, s.x + ox, s.ground + 0.025, s.z + oz, 1]);
    rim.setParams(1.6 * s.beam, 0, 0, -1);
  }
  // A ring of shadow under it, growing as it comes down.
  // (Not while the beam is on: its pool of light is there.)
  shadow.setVisible(shown && s.y < UFO.high + 1 && !on);
  if (shown) {
    const above = Math.max(0.5, s.y - s.ground);
    const r = SAUCER.r * (0.45 + 0.5 * Math.min(1, 2.2 / above));
    shadow.setMatrix([r, 0, 0, 0, 0, 1, 0, 0, 0, 0, r, 0, s.x, s.ground + 0.012, s.z, 1]);
  }
  // "HELP!" over whoever is in the beam, turned to the camera.
  const p = s.person;
  const shouting = !!p && p.visible && (s.phase === 'lift' || (s.phase === 'drop' && s.t > UFO.beamOn));
  help.setVisible(shouting);
  if (shouting) help.setMatrix(facing(p!.x, p!.y + 0.32, p!.z, 1.5, Math.floor(st.time * 8) % 2 ? 0.012 : 0));
}

/** A flat card at (x, y, z) turned square to the camera (the app's view), at scale `sc`. */
const card = new Array<number>(16).fill(0);
function facing(x: number, y: number, z: number, sc: number, jig: number): number[] {
  const view = (globalThis as { __lc?: { view?: { getCamera?(): { yaw: number; pitch: number }; getEyeCamera?(): { yaw: number; pitch: number } | null } } }).__lc?.view;
  const deg = Math.PI / 180;
  const e = view?.getEyeCamera?.();
  const cam = e ? { yaw: e.yaw * deg, pitch: -e.pitch * deg } : view?.getCamera ? { yaw: view.getCamera().yaw * deg, pitch: view.getCamera().pitch * deg } : { yaw: 45 * deg, pitch: 35 * deg };
  const c = Math.cos(cam.yaw), sn = Math.sin(cam.yaw), ct = Math.cos(cam.pitch), st = Math.sin(cam.pitch);
  const v = [c * sc, 0, -sn * sc, 0, -sn * st * sc, ct * sc, -c * st * sc, 0, sn * ct * sc, st * sc, c * ct * sc, 0, x, y + jig, z, 1] as const;
  for (let i = 0; i < 16; i++) card[i] = v[i]!;
  return card;
}

function clear(st: State, stage: LifeStage): void {
  const t = throwerOf(stage);
  for (const s of st.list) {
    for (const h of s.h) h.release();
    if (s.person) {
      s.person.visible = true;
      t?.beamed.delete(s.person);
    }
  }
  st.list = [];
  st.calls = [];
}

export default defineSystem<State>({
  id: 'mischief.ufo',
  // After the thrower (15): a person it holds is moved after the thrower's own step has run.
  order: 16,
  create(ctx) {
    const st: State = {
      d: mischiefOf(ctx.stage),
      own: ownStage(ctx.stage),
      list: [],
      n: 0,
      time: 0,
      night: false,
      calls: [],
      off: () => {},
      ufos: null as unknown as Ufos,
      m: new Array<number>(16).fill(0),
    };
    st.ufos = {
      get saucers() {
        return st.list;
      },
      call(x, y, z) {
        if (st.list.length + st.calls.length >= UFO.most) return false;
        st.calls.push({ x, y, z });
        return true;
      },
    };
    registry.set(ctx.stage, st.ufos);
    // The debug handle (sequences, browser tests).
    (globalThis as { __lcUfo?: Ufos }).__lcUfo = st.ufos;
    st.off = st.d.on((e) => {
      if (e.type === 'reset' || e.type === 'undo') clear(st, ctx.stage);
      else if (e.type === 'blast' && e.nuke) {
        // A nuke going off under a hovering saucer: it lets go of its catch and goes off spinning.
        const [bx, , bz] = e.blast.point;
        for (const s of st.list) {
          if (Math.hypot(s.x - bx, s.z - bz) > 12 || (s.phase !== 'beam' && s.phase !== 'lift' && s.phase !== 'seek' && s.phase !== 'drop')) continue;
          const p = s.person, t = throwerOf(ctx.stage);
          if (p && t?.thrown.has(p)) {
            p.visible = true;
            t.beamed.delete(p);
            const dx = p.x - bx, dz = p.z - bz, d = Math.hypot(dx, dz) || 1;
            t.fling(p, (dx / d) * 3, 1.5, (dz / d) * 3);
          }
          s.person = null;
          s.aboard = false;
          s.beam = 0;
          s.lean = 0;
          s.from = { x: s.x, y: s.y, z: s.z };
          s.to = edgePoint(s.x, s.z, s.n, 'blown');
          phase(s, 'leave');
        }
      }
    });
    return st;
  },
  update(st, dt, signals, ctx) {
    st.time += dt;
    st.night = !signals.time.isDay;
    for (const c of st.calls) create(st, ctx.stage, c.x, c.y, c.z);
    st.calls = [];
    for (let i = st.list.length - 1; i >= 0; i--) {
      const s = st.list[i]!;
      step(st, ctx.stage, s, dt);
      if (s.phase === 'done') {
        for (const h of s.h) h.release();
        st.list.splice(i, 1);
        continue;
      }
      draw(st, s);
    }
  },
  dispose(st, ctx) {
    st.off();
    clear(st, ctx.stage);
    registry.delete(ctx.stage);
    st.own.releaseAll();
  },
});
