// L68 · Waving the ship in (run time; the places are L27's way-out sockets on
// dock decks, the water's edge of the piers and quays). When a big ship
// (L38–L40) comes in under way toward the town, the children (and a grown-up
// or two) come running down to the end of the pier nearest it and wave and
// jump and cheer as it comes in, turning to follow it, until it has stopped
// at its berth; then they go home. The quay's crowd that gathers while a ship
// is in (L38) does the rest.
//
// Cost per step: a distance per big ship on the water; a few comparisons per
// waver while it lasts.

import { phrase } from '@/core/phrase';
import { keyX, keyZ, type CellKey } from '@/core/grid';
import { rand } from '@/core/rand';
import type { LifeStage } from '@/life/api';
import { bigShipsOf, type BigShipNews } from '../../ships/news';
import type { Person } from '../../people/crowd';
import { type Board, type Chain } from '../board';
import { canWork, homeCell, reaches, unbusy } from '../hands';
import { scenesOf, type Scene } from '../scenes';

export interface WelcomeChain extends Chain {
  /** Ships waved in so far, and the people waving now. */
  readonly welcomed: number;
  readonly waving: readonly Person[];
}

/** How near (cells) a ship under way must come to the pier's end for them to come running. */
const NEAR = 14;

export function welcomeChain(shipsOf: (stage: LifeStage | null) => readonly BigShipNews[] = (s) => (s ? bigShipsOf(s) : [])): WelcomeChain {
  let ends: CellKey[] = [];
  let ship: BigShipNews | null = null;
  let at: CellKey | null = null;
  let waving: Person[] = [];
  let since = 0;
  let stopped = -1;
  let welcomed = 0;
  let scene: Scene | null = null;
  let rest = 0;
  /** The nearest a ship under way was to the pier ends at the last look (a second ago): coming in, or going out. */
  let last: { x: number; z: number; d: number }[] = [];
  let lookAt = 0;
  const nearestTo = (x: number, z: number): number => Math.min(...ends.map((e) => Math.hypot(keyX(e) + 0.5 - x, keyZ(e) + 0.5 - z)));

  const finish = (board: Board): void => {
    for (const p of waving) {
      if (board.plans.get(p)?.chain === chain && p.mode === 'linger') p.timer = Math.min(p.timer, 0.3 + rand(p.seed, 'welcome-go', welcomed) * 2);
      p.party = false;
    }
    waving = [];
    ship = null;
    at = null;
    if (scene) scenesOf(board).end(scene);
    scene = null;
    rest = board.now + 60;
  };

  const begin = (board: Board, s: BigShipNews): void => {
    const nearest = ends.slice().sort((a, b) => Math.hypot(keyX(a) + 0.5 - s.x, keyZ(a) + 0.5 - s.z) - Math.hypot(keyX(b) + 0.5 - s.x, keyZ(b) + 0.5 - s.z) || a - b)[0];
    if (nearest === undefined) return;
    const far = (p: Person): number => {
      const h = homeCell(board, p);
      return h === null ? Infinity : board.dist(h, nearest) * 0.5 + board.dist(p.cell, nearest);
    };
    const free = board.crowd.people.filter((p) => !p.shutIn && !p.leaving && p.mode !== 'gone' && unbusy(board, p) && !p.load && !p.party && !p.scuffle && reaches(board, p, nearest) && far(p) <= 28);
    free.sort((a, b) => far(a) - far(b) || (a.id < b.id ? -1 : 1));
    const crew = [...free.filter((p) => p.child).slice(0, 4), ...free.filter(canWork).slice(0, 2)].slice(0, 5);
    if (crew.length < 2) return;
    const c = board.centre(nearest);
    crew.forEach((p, i) => {
      const a = (i / crew.length) * Math.PI * 2;
      const spot = { x: c.x + Math.cos(a) * 0.28, z: c.z + Math.sin(a) * 0.28 };
      const wave = board.stepAt(nearest, { spot, face: NaN, pose: 'wave', linger: 1e6, brisk: true, tag: 'welcome:wave' });
      const home = board.homeStep(p, { tag: 'welcome:home', linger: 0.5, done: (q) => void (q.party = false) });
      if (!home) return;
      p.party = true;
      board.assign(p, { chain, at: 0, steps: [wave, home], fail: (q) => void (q.party = false) });
      waving.push(p);
    });
    if (waving.length === 0) return;
    ship = s;
    at = nearest;
    since = board.now;
    stopped = -1;
    welcomed++;
    scene = scenesOf(board).begin({ kind: 'welcome', title: phrase('Children waving a ship in'), big: false, focus: () => (at !== null ? board.centre(at) : null), noteworthy: () => false, gathering: () => false });
  };

  const chain: WelcomeChain = {
    id: 'welcome',
    get welcomed() {
      return welcomed;
    },
    get waving() {
      return waving;
    },
    sync(board) {
      const nav = board.nav;
      ends = nav ? (board.dressing?.sockets ?? []).filter((s) => s.type === 'way-out' && nav.nodes[nav.nodeAt.get(s.cell) ?? -1]?.surface === 'deck').map((s) => s.cell) : [];
      if (ship && (at === null || !ends.includes(at))) finish(board);
    },
    step(_dt, time, board) {
      if (!ship) {
        if (!time.isDay || ends.length === 0 || board.now < rest || board.now < lookAt) return;
        lookAt = board.now + 1;
        // A ship under way coming IN: nearer the pier ends than the same ship was a second ago (the news is
        // drawn afresh each frame, so the same ship is the one nearest where one was).
        let best: BigShipNews | null = null, d = Infinity;
        const now: { x: number; z: number; d: number }[] = [];
        for (const sh of shipsOf(board.stage)) {
          const n = nearestTo(sh.x, sh.z);
          now.push({ x: sh.x, z: sh.z, d: n });
          if (sh.speed < 0.05) continue;
          const before = last.find((o) => Math.hypot(o.x - sh.x, o.z - sh.z) < 1.5);
          if (before && n < before.d - 0.05 && n < d) {
            d = n;
            best = sh;
          }
        }
        last = now;
        const coming = best !== null;
        if (best && d < NEAR && coming) begin(board, best);
        return;
      }
      // The same ship this frame: the news is drawn afresh each frame, so follow the one nearest where it was.
      let s = ship;
      let dd = Infinity;
      for (const sh of shipsOf(board.stage)) {
        const n = Math.hypot(sh.x - ship.x, sh.z - ship.z);
        if (n < dd && n < 1.5) {
          dd = n;
          s = sh;
        }
      }
      ship = s;
      waving = waving.filter((p) => board.plans.get(p)?.chain === chain);
      for (const p of waving) {
        if (p.mode !== 'linger' || p.goal?.errand?.tag !== 'welcome:wave') continue;
        p.heading = Math.atan2(s.x - p.x, s.z - p.z);
        const beat = Math.floor(board.now * 1.4 + p.rank * 5) % 5;
        p.pose = p.child ? (beat === 2 ? 'hop' : beat === 4 ? 'cheer' : 'wave') : beat === 1 ? 'cheer' : 'wave';
      }
      if (s.speed < 0.02 && stopped < 0) stopped = board.now;
      if (waving.length === 0 || (stopped > 0 && board.now - stopped > 20) || board.now - since > 75) finish(board);
    },
    offer() {
      return null;
    },
    dispose(board) {
      if (ship) finish(board);
    },
  };
  return chain;
}
