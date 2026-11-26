// L57 · A wedding at the chapel (posts from L57.wedding.rule.ts): an event
// nobody can miss. A party of up to twenty, dressed for it (finery.ts), a
// guard of honour at the chapel door, bells and a shower of petals, and a
// procession in good order through the town to the square, where there is a
// ring of guests round the couple, the first dance and the bouquet thrown.
//
//   gather      the party is called in ones and twos: each goes home to dress
//               (anyone already at home dresses there) and comes out in their
//               finery. The priest puts up a flower arch over the chapel door
//               and stands beside it; the couple go in; everybody else lines
//               the way from the door in two rows facing each other (the
//               flower children at the far end), a guard of honour
//   vows        the couple are inside; the bells peal
//   out         the couple come out onto the doorstep: the guests throw
//               handfuls of petals, a shower over the couple, the kiss
//   procession  the couple walk up the aisle between the rows to the flower
//               children; then the column sets off at one stately pace, two
//               abreast and in order: the flower children strewing petals,
//               the couple arm in arm, the bridesmaids and the men in black
//               in pairs, the guests. The guard falls in behind the couple a
//               pair at a time as it passes. Along the streets (by a
//               fountain or another square, where the town has one, rather
//               than straight there) to the square. People about stop and
//               watch, wave and clap; anybody in the way steps aside
//   celebrate   at the square: a ring of guests round the couple, who dance;
//               handfuls of petals; the bride throws her bouquet and somebody
//               catches it; the band strikes up if there is a bandstand near.
//               Then everybody walks home and changes there
//
// Afterwards the petals lie along the way (petals.ts) until the priest comes
// out with a broom and sweeps them up, cell by cell, and takes the arch in.
//
// The procession is one body on a track (track.ts, as the garrison's column
// is): each member's place is the head's distance along it less their row's,
// so they keep their order and spacing round corners, and they never leave
// the cells of the walking graph. While they march they are held in the
// crowd's `linger` (at their place in the guard of honour) and this chain
// moves them.
//
// When: the first one 25–45 s after the town is first seen, then one every
// five to seven minutes of life (WEDDING.every), by day only, and only with
// day enough left to hold it. With the time of day held at day, they still
// come round; held at dusk or night, none.
//
// Called off cleanly (everybody walks home and changes there) if the chapel
// or the square goes, the chapel burns or is hit, a bomb falls near, the
// couple cannot get there, or the town changes under the column (then the
// procession breaks up and walks to the square as it can).

import { phrase } from '@/core/phrase';
import { CELL_H, DIR4, key, keyX, keyY, keyZ, type CellKey } from '@/core/grid';
import { lookOf } from '@/parts/people/person';
import { MeshBuilder } from '@/gen/mesh';
import { rand } from '@/core/rand';
import { isFinery, type Finery } from '@/parts/people/finery';
import { carriedMesh } from '@/parts/people/loads';
import type { Route } from '../../people/route';
import { nearestOnTrack, outdoors, trackAt, trackOf, type Track, type TrackPoint } from '../../people/track';
import { PERSON } from '@/style/people';
import { TIME } from '@/style/time';
import { WEDDING } from '@/style/town-life';
import type { InstanceHandle } from '../../api';
import { fxOf } from '../../fx/fx';
import { ringPeal } from '../../mechanisms/peal';
import { mischiefOf } from '../../mischief/director';
import { place } from '../../motion/pose';
import type { Person } from '../../people/crowd';
import { partPhases } from '../../signals';
import { DIR_HEADING, type Board, type Chain, type Plan, type PlanStep, type Post } from '../board';
import { canWork, homeCell, reaches } from '../hands';
import { createPetals, type Petals } from './petals';
import { createDoves, type Doves } from './doves';
import { archMesh } from './wedding-art';
import type { ShowChain } from './places';
import { scenesOf, type Scene } from '../scenes';

export type WeddingPhase = 'none' | 'gather' | 'vows' | 'out' | 'procession' | 'celebrate';

/** One of the party. */
export interface Member {
  readonly p: Person;
  readonly role: Finery;
  /** Their row in the column (front first) and side (−1 left, 1 right, 0 alone in the middle). Not in it: −1 (the priest). */
  row: number;
  side: number;
  /** Their place in the guard of honour: along the track, and which side of it. */
  guardS: number;
  guardSide: number;
  /** In the column now; and how far through stepping into it (0 → 1) from where they stood. */
  joined: boolean;
  join: number;
  fromX: number;
  fromZ: number;
  /** Life seconds when they are called. */
  calls: number;
  called: boolean;
  /** Fell out of it (did not come in time, was sent off by something else): just goes home. */
  lost: boolean;
}

export interface WeddingChain extends Chain {
  readonly phase: WeddingPhase;
  readonly couple: readonly Person[];
  readonly guests: readonly Person[];
  readonly members: readonly Member[];
  /** The procession's way, from the chapel door to the square (null when none is on). */
  readonly track: Track | null;
  /** Where the head of the column is along the track; and whether it is on the march (the couple are up the aisle). */
  readonly head: number;
  readonly marching: boolean;
  /** Weddings held so far, and the ones called off. */
  readonly held: number;
  readonly calledOff: number;
  /** Life seconds when the next may start. */
  readonly next: number;
  /** Where to look: the couple, or the chapel door; null when none is on. */
  readonly focus: { x: number; y: number; z: number } | null;
  readonly petals: Petals | null;
  /** Doves in the air now. */
  readonly doves: number;
  /** Starts one now if there is not one on (fixtures, sequences). */
  begin(board: Board): boolean;
}

const pt: TrackPoint = { x: 0, y: 0, z: 0, dx: 0, dz: 1, node: 0 };
const pt2: TrackPoint = { x: 0, y: 0, z: 0, dx: 0, dz: 1, node: 0 };

/** The light wind the petals drift on (the chain has no wind signal; a gentle steady air). */
const AIR = { dirX: 0.6, dirZ: 0.8, strength: 0.25 };

function loopSeconds(): number {
  return TIME.day + TIME.dusk + TIME.night + TIME.dawn;
}

/** Whether a link of the walking graph joins two nodes. */
function linked(board: Board, a: number, b: number): boolean {
  if (a === b) return true;
  const nav = board.nav!;
  for (let k = nav.linkStart[a]!; k < nav.linkStart[a + 1]!; k++) {
    const l = nav.links[nav.linkOf[k]!]!;
    if (l.a === b || l.b === b) return true;
  }
  return false;
}

/** The wedding chain drawing on each stage (the app reads it for its note: weddingOn). */
const onStage = new WeakMap<object, WeddingChain>();

/** What the wedding on this stage is doing now, for the app's note: its phase, how many weddings so far, and where to look. */
export function weddingOn(stage: object): { phase: WeddingPhase; held: number; focus: { x: number; y: number; z: number } | null } | null {
  const c = onStage.get(stage);
  return c ? { phase: c.phase, held: c.held, focus: c.focus } : null;
}

export function weddingChain(): WeddingChain {
  let door: Post | undefined;
  let square: Post | undefined;
  let phase: WeddingPhase = 'none';
  let t = 0;
  let total = 0;
  let members: Member[] = [];
  let couple: Person[] = [];
  let priest: Person | null = null;
  let track: Track | null = null;
  let held = 0;
  let calledOff = 0;
  let seen = -1;
  let next = Infinity;
  let lastPhase = -1;
  let moving = false;
  let head = 0;
  let front = 0;
  /** Where the couple are along the aisle, while they walk up it. */
  let aisle = 0;
  let marching = false;
  let atDoor = 0;
  let throwAt = 0;
  let strewAt = 0;
  let checkAt = 0;
  let centre: { x: number; y: number; z: number; cell: CellKey } | null = null;
  let bouquet: { h: InstanceHandle | null; from: Person; to: Person; t: number } | null = null;
  /** Everybody in finery not yet changed back (they change when they are home). */
  const dressed = new Set<Person>();
  let arch: InstanceHandle | null = null;
  let archAt: { x: number; y: number; z: number } | null = null;
  /** The sweep, once the petals have lain a while. */
  let sweepAt = Infinity;
  let sweeper: Person | null = null;
  /** Set while this chain itself ends a member's plan to give them another (their plan's `fail` then does nothing). */
  let reassigning = false;
  let petals: Petals | null = null;
  let doves: Doves | null = null;
  let boardRef: Board | null = null;
  /** This wedding in the town's register of scenes (scenes.ts), while it is on. */
  let scene: Scene | null = null;

  /** The ink of the floor in a cell, as the floor's own builder names it (path.gen.ts, plaza.gen.ts, the terrain's grass). */
  const groundInk = (board: Board, cell: CellKey): number | null => {
    const shape = board.shape;
    if (!shape) return null;
    const f = shape.floorAt.get(cell);
    if (f !== undefined) {
      const kind = shape.structures.get(f)?.kind;
      if (kind === 'plaza') return new MeshBuilder({ ink: f }).inkOf('plaza');
      if (kind !== 'path') return null;
      const under = keyY(cell) > 0 ? shape.kinds.get(key(keyX(cell), keyY(cell) - 1, keyZ(cell))) : undefined;
      return new MeshBuilder({ ink: f }).inkOf(under === undefined ? 'dirt' : under === 'dock' ? 'boards' : 'cobbles');
    }
    if (shape.structureAt.has(cell) || (keyY(cell) > 0 && shape.kinds.has(key(keyX(cell), keyY(cell) - 1, keyZ(cell))))) return null;
    return new MeshBuilder({ ink: 'terrain' }).inkOf(`ground${keyY(cell)}`);
  };
  const petalsOf = (board: Board): Petals => (petals ??= createPetals(board.stage, (cell) => groundInk(board, cell)));
  const memberOf = (p: Person): Member | undefined => members.find((m) => m.p === p);
  const active = (): Member[] => members.filter((m) => !m.lost);

  const putArch = (board: Board, on: boolean): void => {
    if (on && !arch && door && board.stage) {
      const c = board.centre(door.cell);
      const d = (door.dir ?? 0) as 0 | 1 | 2 | 3;
      // The post faces the door: the arch stands on the doorstep facing out of it.
      const yaw = DIR_HEADING[((d + 2) % 4) as 0 | 1 | 2 | 3];
      arch = board.stage.spawnMesh(archMesh(), place(c.x, c.y, c.z, yaw));
      archAt = c;
      puff(board, c.x, c.y, c.z);
    } else if (!on && arch) {
      arch.release();
      arch = null;
      if (archAt) puff(board, archAt.x, archAt.y, archAt.z);
      archAt = null;
    }
  };

  const puff = (board: Board, x: number, y: number, z: number): void => {
    if (!board.stage) return;
    for (let i = 0; i < 3; i++) {
      const a = i * 2.1;
      fxOf(board.stage).play({ actor: 'puff', variant: 'dust' }, 0.5, (k, m) => place(x + Math.cos(a) * 0.2, y + 0.05 + k * 0.15, z + Math.sin(a) * 0.2, 0, 0.35 + k * 0.5, 0.35 + k * 0.5, 0.35 + k * 0.5, m), { delay: i * 0.06 });
    }
  };

  /** Changes back into their own clothes (only ever at home, out of sight). */
  const undress = (board: Board, p: Person): void => {
    if (isFinery(p.costume)) p.costume = null;
    if (p.load === 'bouquet' || p.load === 'petals') p.load = null;
    p.party = false;
    dressed.delete(p);
    if (board.claimedBy(p) === chain && !memberOf(p)) board.unclaim(p);
  };
  const dress = (p: Person, role: Finery): void => {
    p.costume = role;
    dressed.add(p);
  };

  /** Whatever is in their hands now goes with them on the rest of their plan (a caught bouquet, a thrown one gone). */
  const carry = (board: Board, p: Person): void => {
    const plan = board.plans.get(p);
    if (plan?.chain !== chain) return;
    for (let i = plan.at; i < plan.steps.length; i++) plan.steps[i]!.load = p.load;
  };
  /** Off they go from where they stand, with what they hold. */
  const release = (board: Board, p: Person, after: number): void => {
    carry(board, p);
    p.timer = Math.min(p.timer, after);
  };

  const homePlan = (board: Board, p: Person): Plan | null => {
    const home = board.homeStep(p, { tag: 'wedding:home', linger: 0.5, load: p.load, done: (q) => void undress(board, q) });
    return home ? { chain, at: 0, steps: [home] } : null;
  };

  /** Sends somebody of the party home now (a plan of this chain's, so their old one's `fail` is not theirs to run). */
  const sendHome = (board: Board, p: Person): void => {
    const plan = homePlan(board, p);
    reassigning = true;
    if (plan) board.assign(p, plan);
    else board.drop(p);
    reassigning = false;
  };

  const finish = (board: Board, off: boolean): void => {
    const was = members;
    members = [];
    couple = [];
    for (const m of was) {
      const p = m.p;
      p.lift = 0;
      // Called off: anybody still on this chain's plan (standing in the guard, marching, in the ring) walks
      // home now. Over: they go on with theirs, which ends at home.
      if (off && board.plans.get(p)?.chain === chain && p !== sweeper) sendHome(board, p);
      if (!dressed.has(p) && !(p === priest && !off)) {
        p.party = false;
        if (board.claimedBy(p) === chain && p !== sweeper) board.unclaim(p);
      }
    }
    bouquet?.h?.release();
    bouquet = null;
    if (off) {
      calledOff++;
      putArch(board, false);
    }
    phase = 'none';
    if (scene) scenesOf(board).end(scene);
    scene = null;
    t = 0;
    marching = false;
    track = null;
    centre = null;
    priest = off ? null : priest;
    next = board.now + WEDDING.every + rand(board.seed, 'wedding-next', held) * WEDDING.everySpread;
  };

  // ── the way ─────────────────────────────────────────────────────────────
  /** The procession's track: from the door to the square, by way of a fountain or a square or along a street, if the town has a way round. */
  const plan = (board: Board): Track | null => {
    const nav = board.nav, router = board.crowd.router;
    if (!nav || !router || !door || !square) return null;
    const a = nav.nodeAt.get(door.cell), b = nav.nodeAt.get(square.cell);
    if (a === undefined || b === undefined) return null;
    const direct = router.find(a, b);
    if (!direct) return null;
    const clutter = (r: Route): number => r.nodes.filter((n) => nav.nodes[n]!.clutter).length;
    let best: { routes: Route[]; score: number } = { routes: [direct], score: direct.nodes.length - clutter(direct) * 6 + (outdoors(nav, direct) ? 0 : -50) };
    // Somewhere to go by: the fountains and squares people like, and every few cells of street.
    const by = new Set<number>();
    for (const h of board.crowd.haunts) if (h.type === 'haunt-fountain' || h.type === 'haunt-square' || h.type === 'haunt-shop' || h.type === 'haunt-cafe' || h.type === 'haunt-bench') by.add(h.node);
    nav.nodes.forEach((n, i) => {
      if (i % 5 === 0 && (n.surface === 'path' || n.surface === 'plaza') && !n.clutter) by.add(i);
    });
    const da = keyX(door.cell), dz = keyZ(door.cell), sa = keyX(square.cell), sz = keyZ(square.cell);
    // Ranked first by a guess (as the crow walks, door to it to the square, nearest the longest way allowed;
    // fountains and squares first), and only the best few are routed: a search each is not free.
    const guess = (x: number): number => {
      const c = nav.nodes[x]!.cell;
      const len = Math.abs(keyX(c) - da) + Math.abs(keyZ(c) - dz) + Math.abs(keyX(c) - sa) + Math.abs(keyZ(c) - sz);
      const fountain = board.crowd.haunts.some((h) => h.node === x && (h.type === 'haunt-fountain' || h.type === 'haunt-square'));
      return Math.abs(len - WEDDING.route * 0.75) - (fountain ? 6 : 0);
    };
    const ranked = [...by]
      .filter((x) => {
        const c = nav.nodes[x]!.cell;
        const far = Math.abs(keyX(c) - da) + Math.abs(keyZ(c) - dz);
        return far >= 3 && far <= WEDDING.route * 0.6 && nav.part[x] === nav.part[a];
      })
      .sort((p, q) => guess(p) - guess(q) || p - q)
      .slice(0, 24);
    for (const x of ranked) {
      const r1 = router.find(a, x), r2 = r1 && router.find(x, b);
      if (!r1 || !r2) continue;
      const len = r1.nodes.length + r2.nodes.length - 1;
      if (len > WEDDING.route || len < direct.nodes.length + 4) continue;
      if (!outdoors(nav, r1) || !outdoors(nav, r2)) continue;
      // Never back along the same way (the column would walk into itself).
      const firstLeg = new Set(r1.nodes);
      let shared = 0;
      for (const k of r2.nodes) if (firstLeg.has(k)) shared++;
      if (shared > 1) continue;
      const fountain = board.crowd.haunts.some((h) => h.node === x && (h.type === 'haunt-fountain' || h.type === 'haunt-square'));
      const score = len - (clutter(r1) + clutter(r2)) * 6 + (fountain ? 6 : 0);
      if (score > best.score) best = { routes: [r1, r2], score };
    }
    return trackOf(nav, best.routes, false);
  };

  /** A spot `side` (world units, + right of the way) of the track at `s`, kept inside the cell of the track there. */
  const beside = (board: Board, s: number, side: number, out: TrackPoint): { x: number; y: number; z: number; node: number } => {
    trackAt(track!, s, out);
    const rx = -out.dz, rz = out.dx;
    const cell = board.nav!.nodes[out.node]!.cell;
    const cx = keyX(cell), cz = keyZ(cell);
    const x = Math.max(cx + 0.03, Math.min(cx + 0.97, out.x - rx * side));
    const z = Math.max(cz + 0.03, Math.min(cz + 0.97, out.z - rz * side));
    return { x, y: out.y, z, node: out.node };
  };

  // ── who ─────────────────────────────────────────────────────────────────
  const begin = (board: Board): boolean => {
    if (phase !== 'none' || !door || !square || !board.nav) return false;
    const d = door;
    const tr = plan(board);
    if (!tr) return false;
    const homeOf = (p: Person): CellKey => homeCell(board, p) ?? p.cell;
    // How far they have to come: home to change first (nothing, if they are in), then to the chapel.
    const near = (p: Person): number => board.dist(homeOf(p), d.cell) + (p.mode === 'home' ? 0 : board.dist(p.cell, homeOf(p)));
    const free = board.crowd.people.filter(
      (p) => !p.shutIn && !p.leaving && p.mode !== 'gone' && !board.claimedBy(p) && !board.plans.has(p) && !p.scuffle && !p.load && reaches(board, p, d.cell) && homeCell(board, p) !== null && near(p) <= WEDDING.reach && !dressed.has(p),
    );
    const adults = free.filter((p) => canWork(p)).sort((a, b) => near(a) - near(b) || (a.id < b.id ? -1 : 1));
    if (adults.length < 2) return false;
    // The couple: two of the grown-ups living near the chapel, from different houses (a new pair each time).
    const pool = adults.slice(0, 6);
    const bride = pool[Math.floor(rand(board.seed, 'bride', held) * pool.length)]!;
    const rest = pool.filter((p) => p !== bride && p.home !== bride.home);
    const groom = rest[Math.floor(rand(board.seed, 'groom', held) * rest.length)] ?? adults.find((p) => p !== bride)!;
    const people = board.crowd.people.filter((p) => !p.shutIn && p.mode !== 'gone' && !p.leaving).length;
    const size = Math.max(2, Math.min(Math.round(WEDDING.party), Math.round(people * WEDDING.share)));
    const taken = new Set<Person>([bride, groom]);
    const takeOf = (from: Person[], n: number): Person[] => {
      const out: Person[] = [];
      for (const p of from) {
        if (out.length >= n) break;
        if (taken.has(p)) continue;
        taken.add(p);
        out.push(p);
      }
      return out;
    };
    const left = (): number => size - taken.size;
    // The priest: the bell ringer if they are free, else the grown-up nearest the chapel.
    const priests = size >= 6 ? takeOf([...adults.filter((p) => p.work?.job === 'bell-ringer'), ...adults], 1) : [];
    const kids = free.filter((p) => p.child).sort((a, b) => near(a) - near(b) || (a.id < b.id ? -1 : 1));
    const flowers = takeOf(kids, Math.min(2, Math.max(0, left() - 2)));
    const pairs = size >= 12 ? 3 : size >= 8 ? 2 : size >= 5 ? 1 : 0;
    const skirted = (p: Person): boolean => lookOf(p.look, p.child).dress;
    const maids = takeOf([...adults.filter(skirted), ...adults], Math.min(pairs, left()));
    const ushers = takeOf([...adults.filter((p) => !skirted(p)), ...adults], Math.min(maids.length > 0 ? maids.length : pairs, left()));
    // Guests from round about, grown-ups and children, nearest first.
    const guests = takeOf([...free].sort((a, b) => near(a) - near(b) || (a.id < b.id ? -1 : 1)), Math.max(0, left()));

    track = tr;
    couple = [bride, groom];
    priest = priests[0] ?? null;
    members = [];
    const add = (p: Person, role: Finery, row: number, side: number): Member => {
      const m: Member = { p, role, row, side, guardS: 0, guardSide: 1, joined: false, join: 0, fromX: p.x, fromZ: p.z, calls: 0, called: false, lost: false };
      members.push(m);
      return m;
    };
    // The column, front to back: the flower children, the couple, the bridesmaids and ushers in pairs, the guests two abreast.
    let row = 0;
    if (flowers.length > 0) {
      flowers.forEach((p, i) => add(p, 'flower', row, flowers.length === 1 ? 0 : i === 0 ? -1 : 1));
      row++;
    }
    const coupleRow = row++;
    add(bride, 'bride', coupleRow, -1);
    add(groom, 'groom', coupleRow, 1);
    for (let i = 0; i < Math.max(maids.length, ushers.length); i++) {
      const two = maids[i] && ushers[i];
      if (maids[i]) add(maids[i]!, 'maid', row, two ? -1 : 0);
      if (ushers[i]) add(ushers[i]!, 'usher', row, two ? 1 : 0);
      row++;
    }
    for (let i = 0; i < guests.length; i += 2) {
      const two = guests[i + 1] !== undefined;
      add(guests[i]!, 'guest', row, two ? -1 : 0);
      if (two) add(guests[i + 1]!, 'guest', row, 1);
      row++;
    }
    if (priest) add(priest, 'priest', -1, 0);
    // The guard of honour: every row but the couple's, in two lines along the way from the door, the
    // front row (the flower children) farthest out. The couple walk up between them.
    const sp = WEDDING.spacing;
    const guardRows = [...new Set(members.filter((m) => m.row >= 0 && m.row !== coupleRow).map((m) => m.row))].sort((a, b) => a - b);
    const start = Math.min(0.7, tr.length * 0.2);
    front = Math.min(tr.length * 0.6, start + Math.max(0, guardRows.length - 1) * sp);
    for (const m of members) {
      if (m.row < 0 || m.row === coupleRow) continue;
      const g = guardRows.indexOf(m.row);
      m.guardS = Math.max(0.05, front - g * sp);
      m.guardSide = m.side === 0 ? (g % 2 === 0 ? 1 : -1) : m.side;
    }
    // The head starts at the front of the guard (with no flower children, a row further, so the couple stand at its front).
    head = front + (flowers.length > 0 ? 0 : sp);
    aisle = 0;
    // Called in ones and twos: the couple and the priest first, the rest over the gathering time.
    // (The farthest first, so they come in ones and twos over the same few seconds.)
    const rest_ = members.filter((m) => m.p !== bride && m.p !== groom && m.p !== priest).sort((a, b) => near(b.p) - near(a.p) || (a.p.id < b.p.id ? -1 : 1));
    for (const m of members) {
      m.calls = board.now;
      if (m.p === bride || m.p === groom || m.p === priest) continue;
      const k = rest_.indexOf(m);
      m.calls = board.now + 1 + (k / Math.max(1, rest_.length)) * WEDDING.gather * 0.3 + rand(m.p.seed, 'wed-call', held) * 2;
    }
    for (const m of members) {
      board.claim(m.p, chain);
      m.p.party = true;
    }
    phase = 'gather';
    scene = scenesOf(board).begin({
      kind: 'wedding',
      title: phrase('Wedding bells at the chapel'),
      big: true,
      focus: () => chain.focus,
      noteworthy: () => phase !== 'none' && phase !== 'gather',
      gathering: () => phase === 'gather',
    });
    t = 0;
    total = 0;
    atDoor = 0;
    marching = false;
    held++;
    sweepAt = Infinity;
    putArch(board, priest === null);
    return true;
  };

  // ── plans ───────────────────────────────────────────────────────────────
  /** The guard of honour's place for a member: beside the way, facing across it. */
  const guardStep = (board: Board, m: Member): PlanStep => {
    const at = beside(board, m.guardS, m.guardSide * 0.34, pt);
    const face = Math.atan2(pt.x - at.x, pt.z - at.z);
    return board.stepAt(board.nav!.nodes[at.node]!.cell, { spot: { x: at.x, z: at.z }, face, pose: 'look', linger: 1e6, load: m.role === 'maid' ? 'bouquet' : m.role === 'flower' ? 'petals' : null, tag: 'wedding:wait' });
  };

  const memberPlan = (board: Board, m: Member): Plan | null => {
    const p = m.p, d = door!;
    const steps: PlanStep[] = [];
    // Dressing: at home now (out of sight), else home first to change.
    if (p.mode === 'home') dress(p, m.role);
    else {
      const change = board.homeStep(p, { tag: 'wedding:dress', linger: 1.2 + rand(p.seed, 'wed-dress', held) * 2, done: (q) => void dress(q, m.role) });
      if (!change) return null;
      steps.push(change);
    }
    const home = board.homeStep(p, { tag: 'wedding:home', linger: 0.5, load: null, done: (q) => void undress(board, q) });
    if (!home) return null;
    const fail = (q: Person): void => {
      if (reassigning) return;
      const mm = memberOf(q);
      if (mm) mm.lost = true;
    };
    const holds = m.role === 'bride' || m.role === 'maid' ? 'bouquet' : m.role === 'flower' ? 'petals' : null;
    if (m.role === 'bride' || m.role === 'groom') {
      const vows = board.stepIn(d.structure!, { cell: d.cell, linger: 1e6, load: holds, tag: 'wedding:vows' });
      if (!vows) return null;
      const [dx, dz] = DIR4[d.dir ?? 0]!;
      const c = board.centre(d.cell);
      const side = m.role === 'bride' ? -0.085 : 0.085;
      steps.push(
        vows,
        board.stepAt(d.cell, {
          // On the doorstep under the arch, side by side, facing out.
          spot: { x: c.x + dx * 0.12 - dz * side, z: c.z + dz * 0.12 + dx * side },
          face: DIR_HEADING[(((d.dir ?? 0) + 2) % 4) as 0 | 1 | 2 | 3],
          pose: 'wave',
          linger: 1e6,
          load: holds,
          tag: 'wedding:out',
          done: () => void atDoor++,
        }),
        home,
      );
      return { chain, at: 0, steps, fail };
    }
    if (m.role === 'priest') {
      const [dx, dz] = DIR4[d.dir ?? 0]!;
      const c = board.centre(d.cell);
      // In again once the column has gone, until it is time to sweep up (sweep() brings them out with a broom).
      const inside = board.stepIn(d.structure!, { cell: d.cell, linger: WEDDING.lie + WEDDING.square + 120, tag: 'wedding:vestry' });
      if (!inside) return null;
      steps.push(
        board.stepAt(d.cell, {
          // Beside the door, to one side of the arch, facing out.
          spot: { x: c.x + dx * 0.2 + dz * 0.36, z: c.z + dz * 0.2 - dx * 0.36 },
          face: DIR_HEADING[(((d.dir ?? 0) + 2) % 4) as 0 | 1 | 2 | 3],
          pose: 'stand',
          linger: 1e6,
          tag: 'wedding:priest',
          done: () => void putArch(board, true),
        }),
        inside,
        home,
      );
      return { chain, at: 0, steps, fail };
    }
    const wait = guardStep(board, m);
    steps.push({ ...wait, load: holds }, home);
    return { chain, at: 0, steps, fail };
  };

  // ── the column ──────────────────────────────────────────────────────────
  const coupleRow = (): number => memberOf(couple[0]!)?.row ?? 0;

  /** Puts a marcher at a place, heading the way they go, and in step with how far they went. */
  const stand = (board: Board, p: Person, x: number, y: number, z: number, node: number, heading: number, walked: number): void => {
    const nav = board.nav!;
    // Only ever from a cell into one joined to it by a link of the graph (never across a corner or a fence);
    // until then, kept inside the cell they are in.
    const inside = (n: number): boolean => {
      const c = nav.nodes[n]!.cell;
      return x >= keyX(c) && x <= keyX(c) + 1 && z >= keyZ(c) && z <= keyZ(c) + 1;
    };
    let to = p.node;
    if (p.node < 0) to = node;
    else if (!inside(p.node)) {
      const k = nav.nodeAt.get(key(Math.floor(x), keyY(nav.nodes[node]!.cell), Math.floor(z)));
      if (k !== undefined && linked(board, p.node, k)) to = k;
      else if (node !== p.node && linked(board, p.node, node) && inside(node)) to = node;
    }
    const c = nav.nodes[to]!.cell;
    x = Math.max(keyX(c) + 0.005, Math.min(keyX(c) + 0.995, x));
    z = Math.max(keyZ(c) + 0.005, Math.min(keyZ(c) + 0.995, z));
    if (to !== p.node) {
      p.node = to;
      p.cell = c;
    }
    // On the floor of that cell (the track's height, unless they are held in a neighbouring cell).
    if (to !== node) y = keyY(c) * CELL_H + (nav.nodes[to]!.rot !== undefined ? CELL_H / 2 : 0) + (nav.nodes[to]!.lift ?? 0);
    p.x = x;
    p.y = y;
    p.z = z;
    p.heading = heading;
    p.react = null;
    p.lift = 0;
    if (walked > 1e-5) {
      p.pose = p.child ? 'run' : 'walk';
      p.stride += (walked * PERSON.stepsPerCell * 0.5) / (p.child ? 0.8 : 1);
    } else if (p.pose === 'walk' || p.pose === 'run' || p.pose === 'look') p.pose = 'stand';
  };

  const slotOf = (m: Member, h: number): number => h - m.row * WEDDING.spacing;
  const sideOf = (m: Member): number => (m.role === 'bride' || m.role === 'groom' ? 0.085 : WEDDING.file) * m.side;

  /** Is this member standing in their place in the guard (or on the doorstep), on this chain's plan? */
  const inPlace = (board: Board, m: Member): boolean => {
    const plan = board.plans.get(m.p);
    if (!plan || plan.chain !== chain || m.p.mode !== 'linger') return false;
    const tag = m.p.goal?.errand?.tag;
    return tag === 'wedding:wait' || tag === 'wedding:out' || tag === 'wedding:march';
  };

  const march = (dt: number, board: Board): void => {
    if (!track) return;
    const cr = coupleRow();
    const sp = WEDDING.spacing;
    const pace = WEDDING.pace;
    // Up the aisle first: the couple walk from the doorstep to the front of the guard.
    const coupleAt = head - cr * sp;
    const before = aisle;
    if (!marching) {
      aisle = Math.min(coupleAt, aisle + pace * dt);
      if (aisle >= coupleAt - 1e-6) marching = true;
    }
    const was = head;
    if (marching) head = Math.min(track.length, head + pace * dt);
    const moved = head - was;
    for (const m of active()) {
      if (m.row < 0) continue;
      if (!inPlace(board, m)) {
        // Still on their way when the column has gone by their place: too late, home.
        if (!m.joined && m.row !== cr && slotOf(m, head) > m.guardS + 0.3) {
          m.lost = true;
          if (board.plans.get(m.p)?.chain === chain) sendHome(board, m.p);
        }
        continue;
      }
      const p = m.p;
      const isCouple = m.row === cr;
      const slot = isCouple && !marching ? aisle : slotOf(m, head);
      const walked = isCouple && !marching ? aisle - before : moved;
      if (!m.joined) {
        // Step in when their place comes by (the couple from the doorstep at once; the flower children wait at the front).
        if (!isCouple && slot < m.guardS - 1e-6) {
          // Turn to watch the couple go by.
          const c = couple[0];
          if (c && p.goal && Math.hypot(c.x - p.x, c.z - p.z) < 2.5) p.goal.face = Math.atan2(c.x - p.x, c.z - p.z);
          continue;
        }
        m.joined = true;
        m.join = 0;
        m.fromX = p.x;
        m.fromZ = p.z;
        if (p.goal?.errand) p.goal = { ...p.goal, face: NaN, errand: { ...p.goal.errand, tag: 'wedding:march' } };
      }
      const at = beside(board, Math.max(0, slot), sideOf(m), pt2);
      if (m.join < 1) {
        // Stepping into the column from where they stood, a few steps' worth.
        m.join = Math.min(1, m.join + dt / 0.9);
        const k = m.join * m.join * (3 - 2 * m.join);
        const x = m.fromX + (at.x - m.fromX) * k, z = m.fromZ + (at.z - m.fromZ) * k;
        const dx = x - p.x, dz = z - p.z;
        const d = Math.hypot(dx, dz);
        stand(board, p, x, at.y, z, at.node, d > 1e-4 ? Math.atan2(dx, dz) : Math.atan2(pt2.dx, pt2.dz), d);
        continue;
      }
      stand(board, p, at.x, at.y, at.z, at.node, Math.atan2(pt2.dx, pt2.dz), walked);
      // Arm in arm: the couple lean in a little toward each other.
      if (isCouple) p.heading += m.side * -0.12;
    }
  };

  /** Petals: the flower children strew them, the guests throw handfuls over the couple now and then. */
  const strew = (board: Board): void => {
    const pe = petalsOf(board);
    if (board.now >= strewAt) {
      strewAt = board.now + 0.42;
      for (const m of active()) {
        if (m.role !== 'flower' || !m.joined) continue;
        const p = m.p;
        const fx = Math.sin(p.heading), fz = Math.cos(p.heading);
        // A handful to each side ahead, from the basket at the hip.
        const side = rand(p.seed, 'strew', Math.floor(board.now * 4)) < 0.5 ? -1 : 1;
        pe.toss(p.x + fx * 0.06, p.y + 0.28, p.z + fz * 0.06, 3, { up: 0.12, spread: 0.18, floor: p.y, dirX: fx * 0.7 - fz * side * 0.5, dirZ: fz * 0.7 + fx * side * 0.5, reach: 0.22, seed: rand(p.seed, 'strew-s', Math.floor(board.now * 4)) * 1e6 });
      }
    }
    if (board.now >= throwAt) {
      throwAt = board.now + 0.8;
      const c = couple[0];
      const throwers = active().filter((m) => m.joined && (m.role === 'guest' || m.role === 'maid' || m.role === 'usher'));
      if (c && throwers.length > 0) {
        const m = throwers[Math.floor(rand(board.seed, 'thrower', Math.floor(board.now * 2)) * throwers.length)]!;
        const dx = c.x - m.p.x, dz = c.z - m.p.z, d = Math.hypot(dx, dz) || 1;
        m.p.react = 'cheer';
        pe.toss(m.p.x, m.p.y + 0.45, m.p.z, 12, { up: 1.1, spread: 0.35, floor: m.p.y, dirX: dx / d, dirZ: dz / d, reach: Math.min(d, 1.4), seed: board.now * 977 });
      }
    }
  };

  /** A shower over (x, y, z) from a few of the guard at once: the doorstep's burst, the square's. */
  const shower = (board: Board, x: number, y: number, z: number, n: number, k: number): void => {
    const pe = petalsOf(board);
    pe.toss(x, y + 1.1, z, n, { up: 0.7, spread: 0.75, floor: y, seed: rand(board.seed, 'shower', held, k) * 1e6 });
    for (const m of active()) {
      if (m.row < 0 || m.role === 'bride' || m.role === 'groom' || !inPlace(board, m)) continue;
      const p = m.p;
      const dx = x - p.x, dz = z - p.z, d = Math.hypot(dx, dz) || 1;
      if (d > 4) continue;
      p.pose = 'cheer';
      pe.toss(p.x, p.y + 0.45, p.z, 9, { up: 1.2, spread: 0.3, floor: p.y, dirX: dx / d, dirZ: dz / d, reach: d * 0.8, seed: rand(p.seed, 'handful', held, k) * 1e6 });
    }
  };

  /** The arc length of the track's sample nearest a point, looked for only between `lo` and `hi`. */
  const nearestBetween = (x: number, z: number, lo: number, hi: number): number => {
    const t = track!;
    // The first sample at or past `lo`.
    let i = 0, j = t.s.length - 1;
    while (i < j) {
      const mid = (i + j) >> 1;
      if (t.s[mid]! < lo) i = mid + 1;
      else j = mid;
    }
    let best = t.s[i]!, bestD = Infinity;
    for (let k = i; k < t.s.length && t.s[k]! <= hi; k++) {
      const d = (t.x[k]! - x) ** 2 + (t.z[k]! - z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = t.s[k]!;
      }
    }
    return best;
  };
  /** Bystanders standing in the column's way, being moved aside (looked for every AUDIENCE seconds). */
  const inWay = new Set<Person>();
  let audienceAt = 0;

  /** People not in it stop to watch it go by (wave, clap); anybody standing in its way steps aside. */
  const audience = (board: Board): void => {
    if (!track) return;
    let rows = coupleRow();
    for (const m of members) if (!m.lost && m.row > rows) rows = m.row;
    const tail = head - (rows + 1) * WEDDING.spacing;
    const lo = Math.max(0, tail - 0.4), hi = head + 2.2;
    if (board.now >= audienceAt) {
      audienceAt = board.now + 0.2;
      inWay.clear();
      trackAt(track, Math.max(0, head - 1), pt);
      const hx = pt.x, hz = pt.z;
      for (const p of board.crowd.people) {
        if (p.party || !p.visible || p.mode === 'gone' || p.mode === 'hop' || p.scuffle || p.seat >= 0) continue;
        if (p.mode !== 'walk' && p.mode !== 'linger') continue;
        if (p.mode === 'walk' && p.walk![p.at]!.kind !== 'move') continue;
        // (Cheap: nobody far from the column is looked at closely.)
        if (Math.abs(p.x - hx) > 6 || Math.abs(p.z - hz) > 6) continue;
        const s = nearestBetween(p.x, p.z, lo - 2, hi + 1);
        trackAt(track, s, pt);
        const off = Math.hypot(p.x - pt.x, p.z - pt.z);
        if (off > 2.4 || Math.abs(p.y - pt.y) > 0.6) continue;
        // Stop and watch: turned to the couple, a wave or a clap.
        const c = couple[0] ?? p;
        p.startled = Math.max(p.startled, 1.2);
        p.startledFace = Math.atan2(c.x - p.x, c.z - p.z);
        p.admire ??= p.child ? 'cheer' : rand(p.seed, 'admire', held) < 0.5 ? 'wave' : 'clap';
        if (off < 0.36 && s >= lo && s <= hi) inWay.add(p);
      }
    }
    // In the way (on the line, ahead of or beside the column): a step aside, within their cell.
    for (const p of inWay) {
      if (!p.visible || (p.mode !== 'walk' && p.mode !== 'linger')) continue;
      const s = nearestBetween(p.x, p.z, lo - 0.5, hi + 0.5);
      trackAt(track, s, pt);
      const rx = -pt.dz, rz = pt.dx;
      const lat = (p.x - pt.x) * rx + (p.z - pt.z) * rz;
      if (Math.abs(lat) >= 0.37) continue;
      const sign = Math.abs(lat) > 1e-3 ? Math.sign(lat) : rand(p.seed, 'aside', held) < 0.5 ? -1 : 1;
      const step = Math.max(-0.02, Math.min(0.02, 0.38 * sign - lat));
      const cell = p.cell, cx = keyX(cell), cz = keyZ(cell);
      const nx = Math.max(cx + 0.05, Math.min(cx + 0.95, p.x + rx * step)), nz = Math.max(cz + 0.05, Math.min(cz + 0.95, p.z + rz * step));
      if (p.mode === 'walk') {
        p.offX += nx - p.x;
        p.offZ += nz - p.z;
      }
      // Turned into the step aside (nobody sidles or backs away).
      if (Math.hypot(nx - p.x, nz - p.z) > 1e-4) p.heading = Math.atan2(nx - p.x, nz - p.z);
      p.x = nx;
      p.z = nz;
    }
  };

  /** The town is changing under the column, or it has arrived: everybody walks to their place in the ring round the couple. */
  const toRing = (board: Board): void => {
    if (!square) return;
    const nav = board.nav!;
    const sq = square;
    const c0 = couple[0];
    const cx = c0 && marching ? (couple[0]!.x + (couple[1]?.x ?? couple[0]!.x)) / 2 : board.centre(sq.cell).x;
    const cz = c0 && marching ? (couple[0]!.z + (couple[1]?.z ?? couple[0]!.z)) / 2 : board.centre(sq.cell).z;
    const cell = nav.nodeAt.has(sq.cell) ? sq.cell : couple[0]!.cell;
    centre = { x: cx, y: board.centre(cell).y, z: cz, cell };
    const ring = active().filter((m) => m.row >= 0 && m.role !== 'bride' && m.role !== 'groom');
    ring.forEach((m, i) => {
      const plan = board.plans.get(m.p);
      if (!plan || plan.chain !== chain || m.p.mode !== 'linger') return;
      const a = (i / Math.max(1, ring.length)) * Math.PI * 2 + rand(board.seed, 'ring', held) * 6;
      let spot: { x: number; z: number; cell: CellKey } | null = null;
      for (const r of [0.85, 0.65, 0.48, 0.32]) {
        const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
        if (x < 0 || z < 0) continue;
        const k = key(Math.floor(x), keyY(cell), Math.floor(z));
        const node = nav.nodeAt.get(k);
        if (node !== undefined && !nav.nodes[node]!.clutter && nav.part[node] === nav.part[nav.nodeAt.get(cell) ?? node]) {
          spot = { x, z, cell: k };
          break;
        }
      }
      const s = spot ?? { x: cx + Math.cos(a) * 0.3, z: cz + Math.sin(a) * 0.3, cell };
      const ringStep = board.stepAt(s.cell, { spot: { x: s.x, z: s.z }, face: Math.atan2(cx - s.x, cz - s.z), pose: m.p.child ? 'cheer' : i % 3 === 0 ? 'cheer' : 'clap', linger: 1e6, load: m.p.load, tag: 'wedding:ring' });
      plan.steps.splice(plan.at, 0, ringStep);
      m.p.timer = Math.min(m.p.timer, 0.2 + (i % 5) * 0.25);
    });
    // The couple: where they stand is the middle of the ring; if the column never got there, they walk there too.
    if (!marching || !c0) {
      for (const p of couple) {
        const plan = board.plans.get(p);
        if (!plan || plan.chain !== chain || p.mode !== 'linger') continue;
        const side = p === couple[0] ? -0.09 : 0.09;
        plan.steps.splice(plan.at, 0, board.stepAt(cell, { spot: { x: cx + side, z: cz }, face: p === couple[0] ? Math.PI / 2 : -Math.PI / 2, pose: 'chat', linger: 1e6, load: p.load, tag: 'wedding:dance' }));
        p.timer = 0;
      }
    }
  };

  /** The first dance: round each other in the middle of the ring, a little bob on the beat. */
  const dance = (board: Board): void => {
    if (!centre || !marching) return;
    const [a, b] = couple;
    if (!a || !b || !inPlace(board, memberOf(a)!) || !inPlace(board, memberOf(b)!)) return;
    const ang = t * 1.1;
    const r = 0.085;
    const cell = a.cell;
    const kx = keyX(cell), kz = keyZ(cell);
    const clampX = (x: number): number => Math.max(kx + 0.04, Math.min(kx + 0.96, x));
    const clampZ = (z: number): number => Math.max(kz + 0.04, Math.min(kz + 0.96, z));
    const mx = clampX((a.x + b.x) / 2), mz = clampZ((a.z + b.z) / 2);
    for (const [p, k] of [[a, 0], [b, Math.PI]] as const) {
      const x = clampX(mx + Math.cos(ang + k) * r), z = clampZ(mz + Math.sin(ang + k) * r);
      const walked = Math.hypot(x - p.x, z - p.z);
      p.x = x;
      p.z = z;
      p.heading = Math.atan2(mx - x, mz - z);
      p.pose = Math.floor(t * 1.5) % 4 === 3 ? 'wave' : 'stand';
      p.stride += walked * PERSON.stepsPerCell * 0.5;
      p.lift = Math.abs(Math.sin(t * Math.PI * 1.4)) * 0.018;
      p.react = null;
    }
  };

  const throwBouquet = (board: Board): void => {
    const bride = couple[0];
    if (!bride || bride.load !== 'bouquet' || bouquet) return;
    const catchers = active().filter((m) => m.p.mode === 'linger' && m.p.goal?.errand?.tag === 'wedding:ring' && !m.p.load && !m.p.child);
    const to = catchers[Math.floor(rand(board.seed, 'catch', held) * catchers.length)]?.p;
    if (!to) return;
    bride.load = null;
    bride.react = 'cheer';
    const h = board.stage ? board.stage.spawnMesh(carriedMesh('bouquet'), place(bride.x, bride.y + 0.4, bride.z)) : null;
    bouquet = { h, from: bride, to, t: 0 };
  };

  const flyBouquet = (dt: number): void => {
    if (!bouquet) return;
    bouquet.t += dt / 1.3;
    const { from, to } = bouquet;
    const k = Math.min(1, bouquet.t);
    const x = from.x + (to.x - from.x) * k, z = from.z + (to.z - from.z) * k;
    const y = from.y + 0.4 + (to.y - from.y) * k + Math.sin(k * Math.PI) * 1.3;
    bouquet.h?.setMatrix(place(x, y, z, k * 9, 1.4, 1.4, 1.4));
    if (k >= 1) {
      bouquet.h?.release();
      // Caught.
      to.load = 'bouquet';
      to.pose = 'cheer';
      bouquet = { h: null, from, to, t: Infinity };
    }
  };

  /** Strikes up the band, if there is a bandstand near the square. */
  const band = (board: Board): void => {
    const show = board.chains.find((c) => c.id === 'show') as ShowChain | undefined;
    if (!show?.strike || !centre) return;
    show.strike(board, centre.cell, 14);
  };

  /** The petals have lain long enough: somebody comes out with a broom. */
  const sweep = (board: Board): void => {
    const pe = petalsOf(board);
    const nav = board.nav;
    const cells = pe.cells();
    if (!nav || !door) {
      pe.blow();
      putArch(board, false);
      return;
    }
    // Who: the priest if they are still about, else anybody free near the chapel.
    let who = priest && board.claimedBy(priest) === chain && priest.mode !== 'gone' && !priest.leaving ? priest : null;
    if (!who) {
      const d = door;
      who =
        board.crowd.people
          .filter((p) => canWork(p) && !board.claimedBy(p) && !board.plans.has(p) && !p.scuffle && !p.load && !p.party && reaches(board, p, d.cell))
          .sort((a, b) => board.dist(a.cell, d.cell) - board.dist(b.cell, d.cell) || (a.id < b.id ? -1 : 1))[0] ?? null;
      if (!who) {
        pe.blow();
        putArch(board, false);
        return;
      }
      board.claim(who, chain);
    }
    // In order along the way: from the doorstep, each next the nearest.
    const walkable = cells.filter((c) => nav.nodeAt.has(c) && !nav.nodes[nav.nodeAt.get(c)!]!.clutter);
    pe.blow(cells.filter((c) => !walkable.includes(c)));
    const order: CellKey[] = [];
    let at = door.cell;
    const left = new Set(walkable);
    while (left.size > 0 && order.length < 48) {
      let best = -1, bestD = Infinity;
      for (const c of left) {
        const d = board.dist(c, at) + Math.abs(keyY(c) - keyY(at)) * 2;
        if (d < bestD || (d === bestD && c < best)) {
          best = c;
          bestD = d;
        }
      }
      left.delete(best);
      order.push(best);
      at = best;
    }
    if (left.size > 0) pe.blow([...left]);
    const steps: PlanStep[] = [];
    const d = door;
    steps.push(board.stepAt(d.cell, { pose: 'sweep', linger: 1.6, tag: 'wedding:sweep', done: () => void (pe.sweep(d.cell), putArch(board, false)) }));
    for (const c of order) if (c !== d.cell) steps.push(board.stepAt(c, { pose: 'sweep', linger: 1.3, tag: 'wedding:sweep', done: () => void pe.sweep(c) }));
    const home = board.homeStep(who, { tag: 'wedding:home', linger: 0.5, done: (q) => void (undress(board, q), q === sweeper && (sweeper = null), board.claimedBy(q) === chain && board.unclaim(q)) });
    if (home) steps.push(home);
    sweeper = who;
    const sw = who;
    reassigning = true;
    board.assign(sw, {
      chain,
      at: 0,
      steps,
      fail: () => {
        if (reassigning) return;
        // Could not finish: what is left blows away.
        sweeper = null;
        if (board.claimedBy(sw) === chain && !dressed.has(sw)) board.unclaim(sw);
        pe.blow();
        putArch(board, false);
      },
    });
    reassigning = false;
  };

  /** Mischief at the chapel or near the party: called off. */
  const trouble = (board: Board): boolean => {
    if (!board.stage || !door) return false;
    const d = mischiefOf(board.stage);
    const chapel = door.structure;
    for (const b of d.engine.burning()) if (b.structure === chapel) return true;
    const cx = keyX(door.cell) + 0.5, cz = keyZ(door.cell) + 0.5;
    for (const b of d.bombs) if (b.nuke || Math.hypot(b.point[0] - cx, b.point[2] - cz) < 10) return true;
    // Raiders ashore near the chapel (src/life/raid).
    if (d.threats.some((t) => Math.hypot(t.x - cx, t.z - cz) < 9)) return true;
    return d.engine.sinceHit(door.cell) < 3;
  };

  const chain: WeddingChain = {
    id: 'wedding',
    get phase() {
      return phase;
    },
    get couple() {
      return couple;
    },
    get guests() {
      return members.filter((m) => m.role !== 'bride' && m.role !== 'groom').map((m) => m.p);
    },
    get members() {
      return members;
    },
    get track() {
      return track;
    },
    get head() {
      return head;
    },
    get marching() {
      return marching;
    },
    get held() {
      return held;
    },
    get calledOff() {
      return calledOff;
    },
    get next() {
      return next;
    },
    get focus() {
      if (phase === 'none') return null;
      const c = couple[0];
      if (c && c.visible) return { x: c.x, y: c.y, z: c.z };
      if (door && boardRef) {
        const k = boardRef.centre(door.cell);
        return { x: k.x, y: k.y, z: k.z };
      }
      return null;
    },
    get petals() {
      return petals;
    },
    get doves() {
      return doves?.count ?? 0;
    },
    begin,
    sync(board) {
      boardRef = board;
      const posts = board.posts('wedding');
      door = posts.find((p) => p.role === 'door');
      square = posts.find((p) => p.role === 'square');
      if (phase === 'none') return;
      if (!door || !square) {
        finish(board, true);
        return;
      }
      // The town changed under the party: the way is planned again; a column on the march breaks up and walks to the square as it can.
      if (phase === 'procession' || phase === 'out') {
        phase = 'celebrate';
        marching = false;
        t = 0;
        toRing(board);
        return;
      }
      if (phase === 'gather' || phase === 'vows') {
        const tr = plan(board);
        if (!tr) finish(board, true);
        else track = tr;
      }
    },
    step(dt, time, board) {
      boardRef = board;
      if (board.stage) onStage.set(board.stage, chain);
      if (seen < 0) {
        seen = board.now;
        next = seen + WEDDING.first + rand(board.seed, 'wedding-at', 0) * WEDDING.firstSpread;
      }
      moving = lastPhase >= 0 && time.phase !== lastPhase;
      lastPhase = time.phase;
      petals?.step(dt, board.now, AIR);
      // The doves: over the couple while it lasts, then away on the wind.
      if (doves) {
        const c = couple.length === 2 && (phase === 'out' || phase === 'procession' || phase === 'celebrate') ? couple : null;
        doves.step(dt, board.now, c ? { x: (c[0]!.x + c[1]!.x) / 2, y: (c[0]!.y + c[1]!.y) / 2, z: (c[0]!.z + c[1]!.z) / 2 } : null, AIR);
      }
      // Change back, at home.
      for (const p of [...dressed]) {
        if (memberOf(p)) continue;
        if (p.mode === 'home') undress(board, p);
        // Still standing where the wedding put them (it is over): off home, soon.
        else if (p.mode === 'linger' && p.timer > 4 && p !== sweeper && (p.goal?.errand?.tag ?? '').startsWith('wedding:') && p.goal?.errand?.tag !== 'wedding:sweep') release(board, p, 0.5 + rand(p.seed, 'wed-go', held) * 3);
      }
      // The petals have lain long enough.
      if (board.now >= sweepAt && phase !== 'procession' && phase !== 'out') {
        sweepAt = Infinity;
        sweep(board);
      }
      if (petals && sweepAt === Infinity && !sweeper && phase === 'none' && petals.lying > 0 && petals.oldest(board.now) > WEDDING.lie + 150) petals.blow();
      t += dt;
      total += dt;
      if (phase === 'none') {
        if (!door || !square || !time.isDay || board.now < next) return;
        // (Over before night: by the end of dusk, with the time of day running.)
        const dayLeft = moving ? (partPhases().dusk.end - time.phase) * loopSeconds() : Infinity;
        if (dayLeft < WEDDING.needs) return;
        if (!begin(board)) next = board.now + 30;
        return;
      }
      // Trouble: called off.
      if (board.now >= checkAt) {
        checkAt = board.now + 0.5;
        if (trouble(board)) {
          finish(board, true);
          return;
        }
      }
      const [bride, groom] = couple;
      const coupleOk = couple.length === 2 && couple.every((p) => p.mode !== 'gone' && !p.leaving && !memberOf(p)?.lost);
      if (!coupleOk || total > WEDDING.most) {
        finish(board, true);
        return;
      }
      // Members called when their time comes; those whose plan ended or was taken over fall out of it.
      for (const m of members) {
        if (m.lost) continue;
        if (!m.called) {
          if (board.now < m.calls) continue;
          m.called = true;
          board.crowd.rethink(m.p);
          continue;
        }
        const plan = board.plans.get(m.p);
        if (plan && plan.chain !== chain) m.lost = true;
      }
      if (phase === 'gather') {
        const inside = couple.every((p) => p.mode === 'visit' && board.plans.get(p)?.steps[board.plans.get(p)!.at]?.tag === 'wedding:out');
        const guard = active().filter((m) => m.row >= 0 && m.p !== bride && m.p !== groom);
        const waiting = guard.filter((m) => m.p.mode === 'linger' && m.p.goal?.errand?.tag === 'wedding:wait').length;
        const ready = waiting >= Math.ceil(guard.length * 0.75) && t > 12;
        if (inside && (ready || t > WEDDING.gatherMost)) {
          phase = 'vows';
          t = 0;
          if (board.stage) ringPeal(board.stage, board.now);
        }
        if (t > WEDDING.gatherMost + 40) finish(board, true);
      } else if (phase === 'vows') {
        if (t > WEDDING.vows) for (const p of couple) if (p.mode === 'visit') release(board, p, 0);
        if (atDoor >= 2) {
          phase = 'out';
          t = 0;
          // The guard that did not come in time is not in it.
          // Anybody not yet called or still dressing is not in it; those on their way may still take their place.
          for (const m of active()) if (m.row >= 0 && m.p !== bride && m.p !== groom && (!m.called || board.plans.get(m.p)?.steps[board.plans.get(m.p)!.at]?.tag === 'wedding:dress')) m.lost = true;
          for (const m of members) if (m.lost && board.plans.get(m.p)?.chain === chain && m.p.mode !== 'home') sendHome(board, m.p);
          if (board.stage) ringPeal(board.stage, board.now);
          const c = board.centre(door!.cell);
          shower(board, (bride!.x + groom!.x) / 2, c.y, (bride!.z + groom!.z) / 2, 60, 0);
          // White doves let go over the doorstep.
          (doves ??= createDoves(board.stage)).release(c.x, c.y + 0.6, c.z, 9, rand(board.seed, 'doves', held) * 1e6);
        }
        if (t > WEDDING.vows + 40) finish(board, true);
      } else if (phase === 'out') {
        // The kiss: turned to each other, up on their toes.
        if (t > 1.4 && t < 3) {
          bride!.heading = Math.atan2(groom!.x - bride!.x, groom!.z - bride!.z);
          groom!.heading = Math.atan2(bride!.x - groom!.x, bride!.z - groom!.z);
          bride!.lift = groom!.lift = Math.sin(((t - 1.4) / 1.6) * Math.PI) * 0.025;
          bride!.pose = groom!.pose = 'stand';
        } else bride!.lift = groom!.lift = 0;
        if (t > 2.6 && t - dt <= 2.6) shower(board, (bride!.x + groom!.x) / 2, bride!.y, (bride!.z + groom!.z) / 2, 40, 1);
        if (t > WEDDING.step) {
          phase = 'procession';
          t = 0;
          aisle = Math.min(nearestOnTrack(track!, (bride!.x + groom!.x) / 2, (bride!.z + groom!.z) / 2), 0.3);
          marching = false;
          for (const p of couple) if (board.plans.get(p)?.chain === chain && p.goal?.errand) p.goal = { ...p.goal, face: NaN, errand: { ...p.goal.errand, tag: 'wedding:march' } };
        }
      } else if (phase === 'procession') {
        march(dt, board);
        strew(board);
        audience(board);
        // The priest goes back in once the column is on its way.
        if (priest && memberOf(priest) && head > front + 2 && priest.mode === 'linger' && priest.goal?.errand?.tag === 'wedding:priest') release(board, priest, 0);
        if (track && head >= track.length - 1e-6) {
          phase = 'celebrate';
          t = 0;
          toRing(board);
          shower(board, centre!.x, centre!.y, centre!.z, 50, 2);
          band(board);
        }
      } else if (phase === 'celebrate') {
        dance(board);
        flyBouquet(dt);
        if (t > 9 && !bouquet) throwBouquet(board);
        for (const k of [16, 24]) if (t > k && t - dt <= k && centre) shower(board, centre.x, centre.y, centre.z, 30, k);
        if (t > WEDDING.square) {
          // Home, and out of their finery.
          for (const m of members) {
            const p = m.p;
            if (board.plans.get(p)?.chain !== chain || p === priest) continue;
            if (m.lost) sendHome(board, p);
            else if (p.mode === 'linger') release(board, p, 0.3 + rand(p.seed, 'wed-home', held) * 3);
          }
          sweepAt = board.now + WEDDING.lie;
          const keep = priest;
          finish(board, false);
          priest = keep;
        }
      }
    },
    offer(p, _time, board) {
      // Somebody still in their finery after it is over: home to change.
      const m = memberOf(p);
      if (!m || m.lost) {
        if (dressed.has(p) && p !== sweeper) return p.mode === 'home' ? (undress(board, p), null) : homePlan(board, p);
        return null;
      }
      if (phase === 'none' || !door || !square || !m.called) return null;
      if (phase !== 'gather' && phase !== 'vows') {
        // Too late to take a place: they stay out of it.
        m.lost = true;
        return null;
      }
      const plan = memberPlan(board, m);
      if (!plan) m.lost = true;
      return plan;
    },
    dispose(board) {
      if (phase !== 'none') finish(board, true);
      if (scene) scenesOf(board).end(scene);
      scene = null;
      putArch(board, false);
      petals?.dispose();
      petals = null;
      doves?.dispose();
      doves = null;
    },
  };
  return chain;
}
