// L66 · A picnic on the grass (posts from L66.picnic.rule.ts). In spring (and
// in summer in a town with no beach), in fair weather, by day, a few families
// carry a rolled blanket and a basket out to the grass under the trees,
// spread the blanket and sit round it in the sun; the children chase each
// other round it. Then the blanket is rolled up and they go home.
//
//   called   one household a spot: a grown-up (who brings the blanket), the
//            children, another grown-up (who brings the basket); called over
//            a few seconds, the farthest first
//   setup    the blanket is shaken out and spread (a puff, and there it is,
//            checked, with the pie, the loaf, the apples and the jug on it),
//            the basket set at its corner
//   stay     the grown-ups sit at its sides facing in, talking (a squiggle
//            over one head, then another), now and then one lies back; the
//            children run round and round it, one chasing the other
//   pack     the blanket rolled up and shouldered, the basket picked up, home
//
// Rain packs it up at once; the grass built over takes the blanket with a puff
// and sends everybody home. Cost per step: a few comparisons per picnicker;
// two instances a family, placed once.

import { phrase } from '@/core/phrase';
import { keyX, keyZ } from '@/core/grid';
import { rand } from '@/core/rand';
import type { InstanceHandle } from '@/life/api';
import { hamperMesh, parasolMesh } from '@/parts/people/beach';
import { kiteMesh, lineMesh } from '@/parts/people/extras';
import type { Load } from '@/parts/people/loads';
import { blanketMesh, BLANKET } from '@/parts/people/picnic';
import { PERSON } from '@/style/people';
import { PICNIC } from '@/style/scenes';
import { fxOf } from '../../fx/fx';
import { place } from '../../motion/pose';
import type { Person } from '../../people/crowd';
import { type Board, type Chain, type Plan, type Post } from '../board';
import { canWork, homeCell, reaches, unbusy } from '../hands';
import { scenesOf, type Scene } from '../scenes';

type Role = 'blanket' | 'hamper' | 'child';

interface Picnicker {
  p: Person;
  role: Role;
  spot: Spot;
  /** Which side of the blanket they sit at (0–3), or for a child, where round it they run. */
  side: number;
  state: 'coming' | 'setup' | 'stay' | 'pack' | 'gone';
  t: number;
  /** Lying back until, life seconds. */
  lieUntil: number;
  lost: boolean;
}

interface Spot {
  post: Post;
  colour: number;
  x: number;
  y: number;
  z: number;
  blanket: InstanceHandle | null;
  /** The basket, or (at the first blanket of the ground) a big parasol over it, carried by the second grown-up. */
  hamper: InstanceHandle | null;
  parasol: boolean;
  people: Picnicker[];
}

export interface PicnicChain extends Chain {
  readonly on: boolean;
  readonly held: number;
  readonly picnickers: readonly Picnicker[];
  /** Blankets spread now. */
  readonly spread: number;
  begin(board: Board): boolean;
}

const DUMMY = (): InstanceHandle => ({ setMatrix() {}, setVisible() {}, setParams() {}, release() {} }) as unknown as InstanceHandle;

export function picnicChain(): PicnicChain {
  let posts: Post[] = [];
  let spots: Spot[] = [];
  let held = 0;
  let next = Infinity;
  let until = Infinity;
  let scene: Scene | null = null;
  let reassigning = false;
  let hasBeach = false;

  const puff = (board: Board, x: number, y: number, z: number, n = 3): void => {
    if (!board.stage) return;
    for (let i = 0; i < n; i++) {
      const a = i * 2.1 + x;
      fxOf(board.stage).play({ actor: 'puff', variant: 'dust' }, 0.45, (k, m) => place(x + Math.cos(a) * 0.2, y + 0.04 + k * 0.1, z + Math.sin(a) * 0.2, 0, 0.22 + k * 0.3, 0.22 + k * 0.3, 0.22 + k * 0.3, m), { delay: i * 0.05 });
    }
  };
  const all = (): Picnicker[] => spots.flatMap((s) => s.people);
  const blanketLoad = (s: Spot): Load => `blanket-${(s.colour % 4) as 0 | 1 | 2 | 3}`;
  const basketLoad = (s: Spot): Load => (s.parasol ? `parasol-${((s.colour + 1) % 6) as 0 | 1 | 2 | 3 | 4 | 5}` : 'hamper');
  const sideSpot = (s: Spot, side: number, r = BLANKET + 0.05): { x: number; z: number; face: number } => {
    const a = (side * Math.PI) / 2 + 0.35;
    const x = s.x + Math.sin(a) * r, z = s.z + Math.cos(a) * r;
    return { x, z, face: Math.atan2(s.x - x, s.z - z) };
  };

  const begin = (board: Board): boolean => {
    if (spots.length > 0 || posts.length === 0 || !board.nav) return false;
    const taken = new Set<Person>();
    const out: Spot[] = [];
    for (const [k, post] of posts.entries()) {
      const target = post.cell;
      const free = board.crowd.people.filter((p) => !taken.has(p) && !p.shutIn && !p.leaving && p.mode !== 'gone' && unbusy(board, p) && !p.scuffle && !p.load && !p.party && reaches(board, p, target));
      const houses = new Map<number, Person[]>();
      for (const p of free) houses.set(p.home, [...(houses.get(p.home) ?? []), p]);
      const far = (list: Person[]): number => {
        const h = homeCell(board, list[0]!);
        return h === null ? Infinity : board.dist(h, target) + rand(board.seed, 'picnic-house', list[0]!.home, held) * 8;
      };
      const fam = [...houses.values()].filter((l) => l.some(canWork) && far(l) <= PICNIC.reach).sort((a, b) => far(a) - far(b) || a[0]!.home - b[0]!.home)[0];
      if (!fam) continue;
      const adults = fam.filter(canWork).sort((a, b) => (a.id < b.id ? -1 : 1));
      const kids = fam.filter((p) => p.child).sort((a, b) => (a.id < b.id ? -1 : 1));
      const crew = [adults[0]!, ...kids.slice(0, 2), ...adults.slice(1, 2)].slice(0, 4);
      const c = board.centre(target);
      const spot: Spot = { post, colour: Math.floor(rand(board.seed, 'picnic-colour', fam[0]!.home, held) * 4), x: c.x, y: c.y, z: c.z, blanket: null, hamper: null, parasol: out.length === 0, people: [] };
      let side = 0;
      for (const p of crew) {
        taken.add(p);
        const role: Role = p === adults[0] ? 'blanket' : p.child ? 'child' : 'hamper';
        spot.people.push({ p, role, spot, side: p.child ? spot.people.filter((q) => q.role === 'child').length * 2 : side++, state: 'coming', t: 0, lieUntil: 0, lost: false });
      }
      out.push(spot);
      void k;
    }
    if (out.length === 0) return false;
    spots = out;
    for (const pk of all()) {
      const plan = plannerOf(board, pk);
      if (!plan) {
        pk.lost = true;
        continue;
      }
      board.claim(pk.p, chain);
      pk.p.party = true;
      reassigning = true;
      board.assign(pk.p, plan);
      reassigning = false;
      pk.p.timer = Math.min(pk.p.timer, rand(pk.p.seed, 'picnic-call', held) * 10);
    }
    held++;
    until = Infinity;
    scene = scenesOf(board).begin({
      kind: 'picnic',
      title: phrase('Picnics on the grass'),
      big: true,
      focus: () => (spots[0] ? { x: spots[0].x, y: spots[0].y, z: spots[0].z } : null),
      noteworthy: () => spots.filter((s) => s.blanket).length >= 1,
      gathering: () => false,
    });
    return true;
  };

  const plannerOf = (board: Board, pk: Picnicker): Plan | null => {
    const s = pk.spot;
    const at = pk.role === 'child' ? sideSpot(s, pk.side, BLANKET + 0.1) : sideSpot(s, pk.side);
    const load: Load | null = pk.role === 'blanket' ? blanketLoad(s) : pk.role === 'hamper' ? basketLoad(s) : null;
    const sit = board.stepAt(s.post.cell, { spot: { x: at.x, z: at.z }, face: NaN, pose: 'stand', linger: 1e6, load, tag: 'picnic:here', done: (q) => {
      const me = all().find((x) => x.p === q);
      if (me && me.state === 'coming') {
        me.state = 'setup';
        me.t = 0;
      }
    } });
    const home = board.homeStep(pk.p, { tag: 'picnic:home', linger: 0.5, load: null, done: (q) => void ((q.load = null), (q.party = false), (q.seat = -1), board.claimedBy(q) === chain && board.unclaim(q)) });
    if (!home) return null;
    return { chain, at: 0, steps: [sit, home], fail: (q) => {
      if (reassigning) return;
      const me = all().find((x) => x.p === q);
      if (me) {
        me.lost = true;
        me.state = 'gone';
      }
      q.party = false;
      q.seat = -1;
    } };
  };

  const here = (board: Board, pk: Picnicker): boolean => !pk.lost && pk.p.mode === 'linger' && board.plans.get(pk.p)?.chain === chain && pk.p.goal?.errand?.tag === 'picnic:here';
  const carry = (board: Board, p: Person): void => {
    const plan = board.plans.get(p);
    if (plan?.chain !== chain) return;
    for (let i = plan.at; i < plan.steps.length; i++) plan.steps[i]!.load = p.load;
  };
  const hold = (p: Person, pose: Person['pose'], seat = -1): void => {
    if (p.pose !== pose) {
      p.pose = pose;
      p.poseTime = 0;
    }
    p.seat = seat;
  };
  const walkTo = (p: Person, x: number, z: number, dt: number, pace: number): boolean => {
    const dx = x - p.x, dz = z - p.z, d = Math.hypot(dx, dz);
    p.seat = -1;
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

  const putBlanket = (board: Board, s: Spot, on: boolean): void => {
    if (on && !s.blanket) {
      s.blanket = board.stage ? board.stage.spawnMesh(blanketMesh(s.colour), place(s.x, s.y, s.z, rand(s.post.cell, 'blanket-turn') * 0.6 - 0.3)) : DUMMY();
      puff(board, s.x, s.y, s.z);
    } else if (!on && s.blanket) {
      s.blanket.release();
      s.blanket = null;
      puff(board, s.x, s.y, s.z, 2);
    }
  };
  const putHamper = (board: Board, s: Spot, on: boolean): void => {
    const x = s.x + BLANKET * (s.parasol ? 0.75 : 0.9), z = s.z - BLANKET * (s.parasol ? 0.75 : 0.9);
    if (on && !s.hamper) {
      s.hamper = board.stage ? board.stage.spawnMesh(s.parasol ? parasolMesh(s.colour + 1) : hamperMesh(), place(x, s.y, z, s.parasol ? Math.atan2(s.x - x, s.z - z) : 0.6)) : DUMMY();
      puff(board, x, s.y, z, 1);
    } else if (!on && s.hamper) {
      s.hamper.release();
      s.hamper = null;
      puff(board, x, s.y, z, 1);
    }
  };

  /** The kite over the picnic ground: who flies it, and its drawings. */
  const WIND = { x: 0.6, z: 0.8 };
  let kite: { kite: InstanceHandle; line: InstanceHandle } | null = null;
  let kiteUp = 0;
  const kiter = (): Picnicker | undefined => all().find((k) => k.role === 'child' && !k.lost && k.state !== 'gone');
  const flyKite = (board: Board, p: Person, up: number): void => {
    if (!board.stage) return;
    kite ??= { kite: board.stage.spawnMesh(kiteMesh(p.look % 10), place(p.x, p.y, p.z, 0)), line: board.stage.spawnMesh(lineMesh(), place(p.x, p.y, p.z, 0)) };
    if (up >= 1) kiteUp = 1;
    const t = board.now;
    const k = Math.min(1, up);
    const weave = Math.sin(t * 1.3) * 0.25, bob = Math.sin(t * 0.9) * 0.12;
    const out = 1.5 * k;
    const kx = p.x + WIND.x * out - WIND.z * weave * k, ky = p.y + 0.4 + 1.3 * k + bob * k, kz = p.z + WIND.z * out + WIND.x * weave * k;
    const hx = p.x + Math.sin(p.heading) * 0.05, hy = p.y + 0.46, hz = p.z + Math.cos(p.heading) * 0.05;
    // The kite faces back toward the child, tipped up into the wind (as people.system draws the children's).
    const zx = -WIND.x * 0.8, zy = 0.6, zz = -WIND.z * 0.8;
    const xl = Math.hypot(zz, zx) || 1;
    const xx = zz / xl, xz = -zx / xl;
    kite.kite.setMatrix([xx * 1.5, 0, xz * 1.5, 0, (zy * xz) * 1.5, (zz * xx - zx * xz) * 1.5, -zy * xx * 1.5, 0, zx * 1.5, zy * 1.5, zz * 1.5, 0, kx, ky, kz, 1]);
    const lx = kx - hx, ly = ky - hy, lz = kz - hz;
    const ll = Math.hypot(lx, ly, lz) || 1, lh = Math.hypot(lx, lz) || 1;
    const sx = lz / lh, sz = -lx / lh;
    kite.line.setMatrix([lx, ly, lz, 0, (-ly * sz) / ll, (sz * lx - sx * lz) / ll, (ly * sx) / ll, 0, sx, 0, sz, 0, hx, hy, hz, 1]);
  };

  /** Everybody home; with `off`, at once (what is down goes with a puff). */
  const finish = (board: Board, off: boolean): void => {
    for (const s of spots) {
      if (off) {
        putBlanket(board, s, false);
        putHamper(board, s, false);
      }
      for (const pk of s.people) {
        const p = pk.p;
        p.seat = -1;
        p.bubble = false;
        if (pk.lost || pk.state === 'gone') continue;
        const coming = pk.state === 'coming';
        pk.state = 'gone';
        if (board.plans.get(p)?.chain === chain) {
          if (off || coming) {
            const home = board.homeStep(p, { tag: 'picnic:home', linger: 0.5, load: p.load, done: (q) => void ((q.load = null), (q.party = false), board.claimedBy(q) === chain && board.unclaim(q)) });
            reassigning = true;
            if (home) board.assign(p, { chain, at: 0, steps: [home] });
            else board.drop(p);
            reassigning = false;
          } else p.timer = Math.min(p.timer, 0.2 + rand(p.seed, 'picnic-go', held) * 2);
        } else {
          p.party = false;
          if (board.claimedBy(p) === chain) board.unclaim(p);
        }
      }
    }
    if (kite) {
      kite.kite.release();
      kite.line.release();
      kite = null;
    }
    spots = [];
    if (scene) scenesOf(board).end(scene);
    scene = null;
    next = board.now + PICNIC.every + rand(board.seed, 'picnic-next', held) * PICNIC.everySpread;
  };

  const chain: PicnicChain = {
    id: 'picnic',
    get on() {
      return spots.length > 0;
    },
    get held() {
      return held;
    },
    get picnickers() {
      return all();
    },
    get spread() {
      return spots.filter((s) => s.blanket).length;
    },
    begin,
    sync(board) {
      posts = [...board.posts('picnic')].filter((p) => p.role === 'spot');
      hasBeach = board.posts('beach').some((p) => p.role === 'pitch');
      if (spots.length > 0 && spots.some((s) => !posts.some((p) => p.cell === s.post.cell))) finish(board, true);
    },
    step(dt, time, board) {
      if (next === Infinity && spots.length === 0 && held === 0) next = board.now + PICNIC.first;
      const w = board.season.weights;
      const fair = board.weather.rain < 0.05 && board.weather.snow <= 0 && board.weather.cloud <= 0.85;
      if (spots.length === 0) {
        const season = w.spring >= PICNIC.spring || (!hasBeach && w.summer >= PICNIC.spring);
        if (season && fair && time.isDay && board.now >= next && posts.length > 0 && scenesOf(board).may('picnic')) {
          if (!begin(board)) next = board.now + 30;
        }
        return;
      }
      if (board.weather.rain > 0.15) {
        // Rain: everything grabbed up and home at once.
        for (const s of spots) for (const pk of s.people) {
          if (!here(board, pk) || pk.state === 'gone') continue;
          if (pk.role === 'blanket' && s.blanket) {
            putBlanket(board, s, false);
            pk.p.load = blanketLoad(s);
          } else if (pk.role === 'hamper' && s.hamper) {
            putHamper(board, s, false);
            pk.p.load = basketLoad(s);
          }
          carry(board, pk.p);
          const plan = board.plans.get(pk.p);
          if (plan) for (let i = plan.at; i < plan.steps.length; i++) plan.steps[i] = { ...plan.steps[i]!, brisk: true };
        }
        finish(board, false);
        return;
      }
      let waiting = 0, live = 0;
      for (const s of spots) {
        for (const pk of s.people) {
          if (pk.lost || pk.state === 'gone') continue;
          live++;
          const p = pk.p;
          if (pk.state === 'coming') {
            waiting++;
            const plan = board.plans.get(p);
            if (plan && plan.chain !== chain) pk.lost = true;
            continue;
          }
          if (!here(board, pk)) {
            if (board.plans.get(p)?.chain !== chain) pk.lost = true;
            continue;
          }
          pk.t += dt;
          if (pk.state === 'setup') {
            waiting++;
            // The blanket first: the others wait for it.
            if (pk.role === 'blanket') {
              hold(p, 'tend');
              p.heading = Math.atan2(s.x - p.x, s.z - p.z);
              if (pk.t > 1.8) {
                putBlanket(board, s, true);
                p.load = null;
                carry(board, p);
                pk.state = 'stay';
              }
            } else if (pk.role === 'hamper') {
              hold(p, 'tend');
              if (pk.t > 1.2 && s.blanket) {
                putHamper(board, s, true);
                p.load = null;
                carry(board, p);
                pk.state = 'stay';
              }
            } else if (s.blanket) pk.state = 'stay';
            else hold(p, 'hop');
            continue;
          }
          if (pk.state === 'stay') {
            if (pk === kiter()) {
              // Flying a kite from the blanket's edge, high over the picnic ground.
              const st = sideSpot(s, 2, BLANKET + 0.04);
              if (walkTo(p, st.x, st.z, dt, 0.6)) {
                p.heading = Math.atan2(WIND.x, WIND.z);
                hold(p, 'kite');
                flyKite(board, p, 1);
              }
              continue;
            }
            if (pk.role === 'child') {
              // Round and round the blanket, the other child after them.
              const a = board.now * 1.4 + pk.side * 1.6;
              const r = BLANKET + 0.1;
              const cx = keyX(s.post.cell), cz = keyZ(s.post.cell);
              const tx = Math.max(cx + 0.04, Math.min(cx + 0.96, s.x + Math.sin(a) * r)), tz = Math.max(cz + 0.04, Math.min(cz + 0.96, s.z + Math.cos(a) * r));
              if (Math.floor(board.now / 9 + pk.side) % 3 === 2) {
                // A rest on the blanket's edge between chases.
                const st = sideSpot(s, pk.side + 1, BLANKET - 0.02);
                if (walkTo(p, st.x, st.z, dt, 0.6)) {
                  p.heading = st.face;
                  hold(p, 'sit', 0);
                }
              } else walkTo(p, tx, tz, dt, 0.75);
              continue;
            }
            const st = sideSpot(s, pk.side);
            if (!walkTo(p, st.x, st.z, dt, 0.35)) continue;
            p.heading = st.face;
            if (board.now < pk.lieUntil) hold(p, 'lie', 0);
            else {
              hold(p, 'sit', 0);
              if (rand(p.seed, 'picnic-lie', Math.floor(board.now / 10)) < 0.06) pk.lieUntil = board.now + 12;
            }
            const turn = Math.floor((board.now + pk.side * 1.3) / 2.4);
            p.bubble = rand(p.seed, 'picnic-talk', turn) < 0.2;
            continue;
          }
          if (pk === kiter() && kite) {
            // Reeled in before anything else.
            kiteUp = Math.max(0, kiteUp - dt / 2.5);
            flyKite(board, p, kiteUp);
            if (kiteUp > 0) continue;
            kite.kite.release();
            kite.line.release();
            kite = null;
          }
          if (pk.state === 'pack') {
            hold(p, 'tend');
            p.bubble = false;
            if (pk.t < 1.4) continue;
            if (pk.role === 'blanket') {
              putBlanket(board, s, false);
              p.load = blanketLoad(s);
            } else if (pk.role === 'hamper') {
              putHamper(board, s, false);
              p.load = basketLoad(s);
            }
            carry(board, p);
            pk.state = 'gone';
            p.seat = -1;
            p.timer = Math.min(p.timer, 0.2 + rand(p.seed, 'picnic-go', held) * 1.5);
          }
        }
      }
      if (until === Infinity && live > 0 && waiting === 0) until = board.now + PICNIC.stay + rand(board.seed, 'picnic-stay', held) * PICNIC.staySpread;
      if (board.now > until || !time.isDay) {
        until = Infinity;
        // Packing up: the blanket rolled, the basket picked up.
        for (const pk of all()) {
          if (pk.state !== 'stay' && pk.state !== 'setup') continue;
          // A blanket or basket that never went down stays in the hands.
          pk.state = (pk.role === 'blanket' && pk.spot.blanket) || (pk.role === 'hamper' && pk.spot.hamper) || (pk === kiter() && kite) ? 'pack' : 'gone';
          pk.t = 0;
          if (pk.state === 'gone') {
            pk.p.seat = -1;
            pk.p.timer = Math.min(pk.p.timer, 0.5);
          }
        }
      }
      if (live === 0 || all().every((pk) => pk.lost || pk.state === 'gone')) {
        // Anything still down with nobody left to take it goes with its family's last puff.
        finish(board, spots.some((s) => s.blanket || s.hamper));
      }
    },
    offer(p, _time, board) {
      if (board.claimedBy(p) === chain && !all().some((pk) => pk.p === p && !pk.lost && pk.state !== 'gone')) {
        board.unclaim(p);
        p.party = false;
        const home = board.homeStep(p, { tag: 'picnic:home', linger: 0.5, load: p.load, done: (q) => void (q.load = null) });
        return home ? { chain, at: 0, steps: [home] } : null;
      }
      return null;
    },
    dispose(board) {
      if (spots.length > 0) finish(board, true);
    },
  };
  return chain;
}
