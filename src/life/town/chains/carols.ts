// L67 · Carol singers (posts from L67.carols.rule.ts). In winter (or while
// the festival is up), at dusk, a little band of singers, grown-ups and
// children each with a lantern on a pole, goes from door to door round the
// middle of the town. At each door they stand in a half ring and sing (music
// notes float up from them); whoever is at home comes out onto the step to
// listen and clap; then on to the next door, and home at the end of the round.
//
// With the time of day running it comes once an evening; held at dusk or
// night, one round every CAROLS.every seconds after the last. Called off (home
// they go) if the round's doors change, or a bomb falls near.
//
// Cost per step: a few comparisons per singer; a handful of notes in the air
// (pooled drawings, never re-meshed).

import { phrase } from '@/core/phrase';
import { DIR4 } from '@/core/grid';
import { rand } from '@/core/rand';
import type { InstanceHandle } from '@/life/api';
import { noteMesh } from '@/parts/people/carols';
import { CAROLS } from '@/style/scenes';
import { mischiefOf } from '../../mischief/director';
import { place } from '../../motion/pose';
import type { Person } from '../../people/crowd';
import { DIR_HEADING, type Board, type Chain, type Plan, type PlanStep, type Post } from '../board';
import { canWork, homeCell, reaches, unbusy } from '../hands';
import { scenesOf, type Scene } from '../scenes';

interface Singer {
  p: Person;
  slot: number;
  lost: boolean;
}

interface Note {
  x: number;
  y: number;
  z: number;
  age: number;
  spin: number;
  h: InstanceHandle | null;
}

export interface CarolChain extends Chain {
  readonly on: boolean;
  readonly rounds: number;
  readonly singers: readonly Singer[];
  /** The door they are at or going to (−1 when none is on), and doors sung to this round. */
  readonly door: number;
  readonly sung: number;
  /** Residents who came out to listen, this round. */
  readonly listeners: number;
  readonly notes: number;
  begin(board: Board): boolean;
}

export function carolChain(): CarolChain {
  let doors: Post[] = [];
  let singers: Singer[] = [];
  let cur = -1;
  let singing = -1;
  let waitFrom = 0;
  let sung = 0;
  let listeners = 0;
  let rounds = 0;
  let next = -1;
  let tonight = false;
  let lastPhase = -1;
  let scene: Scene | null = null;
  let reassigning = false;
  const notes: Note[] = [];
  let noteAt = 0;

  const spotAt = (board: Board, door: Post, slot: number, n: number): { x: number; z: number; face: number } => {
    const c = board.centre(door.cell);
    const [fx, fz] = DIR4[door.dir ?? 0]!;
    // A half ring on the doorstep, facing the door: the middle ones a step nearer.
    const across = (slot - (n - 1) / 2) * 0.17;
    const back = -0.08 - Math.abs(across) * 0.35;
    return { x: c.x + fx * back - fz * across, z: c.z + fz * back + fx * across, face: DIR_HEADING[door.dir ?? 0] };
  };

  const begin = (board: Board): boolean => {
    if (cur >= 0 || doors.length < 3 || !board.nav) return false;
    const first = doors[0]!.cell;
    const far = (p: Person): number => {
      const h = homeCell(board, p);
      return h === null ? Infinity : board.dist(h, first);
    };
    const free = board.crowd.people.filter((p) => !p.shutIn && !p.leaving && p.mode !== 'gone' && unbusy(board, p) && !p.scuffle && !p.load && !p.party && reaches(board, p, first) && far(p) <= 30);
    free.sort((a, b) => far(a) - far(b) || (a.id < b.id ? -1 : 1));
    const grown = free.filter(canWork);
    if (grown.length === 0) return false;
    // A grown-up or two, and children if there are any.
    const crew = [...grown.slice(0, 2), ...free.filter((p) => p.child).slice(0, 3), ...grown.slice(2)].slice(0, Math.round(CAROLS.singers));
    if (crew.length < 3) return false;
    singers = crew.map((p, slot) => ({ p, slot, lost: false }));
    for (const s of singers) {
      const steps: PlanStep[] = doors.map((d, i) => {
        const at = spotAt(board, d, s.slot, singers.length);
        return board.stepAt(d.cell, { spot: { x: at.x, z: at.z }, face: at.face, pose: 'stand', linger: 1e6, load: 'lantern', tag: `carol:${i}` });
      });
      const home = board.homeStep(s.p, { tag: 'carol:home', linger: 0.5, load: 'lantern', done: (q) => void ((q.load = null), (q.party = false), board.claimedBy(q) === chain && board.unclaim(q)) });
      if (!home) {
        s.lost = true;
        continue;
      }
      steps.push(home);
      board.claim(s.p, chain);
      s.p.party = true;
      reassigning = true;
      board.assign(s.p, { chain, at: 0, steps, fail: (q) => {
        if (reassigning) return;
        const me = singers.find((x) => x.p === q);
        if (me) me.lost = true;
        q.party = false;
      } } satisfies Plan);
      reassigning = false;
    }
    cur = 0;
    singing = -1;
    waitFrom = board.now;
    sung = 0;
    listeners = 0;
    rounds++;
    scene = scenesOf(board).begin({
      kind: 'carols',
      title: phrase('Carol singers going door to door'),
      big: true,
      focus: () => {
        const s = singers.find((x) => !x.lost && x.p.visible);
        return s ? { x: s.p.x, y: s.p.y, z: s.p.z } : null;
      },
      noteworthy: () => singing >= 0,
      gathering: () => false,
    });
    return true;
  };

  const finish = (board: Board, off: boolean): void => {
    for (const s of singers) {
      const p = s.p;
      if (s.lost) continue;
      const plan = board.plans.get(p);
      if (plan?.chain === chain) {
        // Called off, or still on the way to a door when the round is over: straight home.
        if (off || plan.steps[plan.at]?.tag !== 'carol:home') {
          const home = board.homeStep(p, { tag: 'carol:home', linger: 0.5, load: p.load, done: (q) => void ((q.load = null), (q.party = false), board.claimedBy(q) === chain && board.unclaim(q)) });
          reassigning = true;
          if (home) board.assign(p, { chain, at: 0, steps: [home] });
          else board.drop(p);
          reassigning = false;
        }
        // Still standing at a door: on home.
        else if (p.mode === 'linger') p.timer = Math.min(p.timer, 0.2);
      } else {
        p.party = false;
        if (board.claimedBy(p) === chain) board.unclaim(p);
      }
    }
    singers = [];
    cur = -1;
    singing = -1;
    if (scene) scenesOf(board).end(scene);
    scene = null;
    next = board.now + CAROLS.every + rand(board.seed, 'carols-next', rounds) * CAROLS.everySpread;
  };

  /** Whoever is at home in the house comes out onto the step to listen. */
  const callOut = (board: Board, door: Post): void => {
    const p = board.crowd.people.find((q) => q.home === door.structure && q.mode === 'home' && unbusy(board, q) && !q.shutIn);
    if (!p) return;
    const c = board.centre(door.cell);
    const [fx, fz] = DIR4[door.dir ?? 0]!;
    const listen = board.stepAt(door.cell, { spot: { x: c.x + fx * 0.36, z: c.z + fz * 0.36 }, face: DIR_HEADING[((door.dir ?? 0) + 2) % 4 as 0 | 1 | 2 | 3], pose: 'clap', linger: CAROLS.sing + 1, tag: 'carol:listen' });
    const home = board.homeStep(p, { tag: 'carol:in', linger: 0.5 });
    if (!home) return;
    board.assign(p, { chain, at: 0, steps: [listen, home] });
    listeners++;
  };

  const stepNotes = (board: Board, dt: number): void => {
    for (let i = notes.length - 1; i >= 0; i--) {
      const n = notes[i]!;
      n.age += dt;
      n.y += dt * 0.32;
      n.x += Math.sin(n.age * 3 + n.spin) * dt * 0.08;
      n.h?.setMatrix(place(n.x, n.y, n.z, n.spin + n.age * 1.6, 1.6, 1.6, 1.6));
      if (n.age > 2.6) {
        n.h?.release();
        notes.splice(i, 1);
      }
    }
    if (singing < 0 || board.now < noteAt) return;
    noteAt = board.now + 0.45;
    const here = singers.filter((s) => !s.lost && s.p.mode === 'linger');
    const s = here[Math.floor(rand(board.seed, 'note-who', Math.floor(board.now * 3)) * here.length)];
    if (!s) return;
    const n: Note = { x: s.p.x, y: s.p.y + 0.5, z: s.p.z, age: 0, spin: rand(board.seed, 'note-spin', Math.floor(board.now * 3)) * 6, h: null };
    n.h = board.stage ? board.stage.spawnMesh(noteMesh(rand(board.seed, 'note-kind', Math.floor(board.now * 3)) < 0.4), place(n.x, n.y, n.z, n.spin, 1.6, 1.6, 1.6)) : null;
    notes.push(n);
  };

  const chain: CarolChain = {
    id: 'carols',
    get on() {
      return cur >= 0;
    },
    get rounds() {
      return rounds;
    },
    get singers() {
      return singers;
    },
    get door() {
      return cur;
    },
    get sung() {
      return sung;
    },
    get listeners() {
      return listeners;
    },
    get notes() {
      return notes.length;
    },
    begin,
    sync(board) {
      const was = doors.map((d) => d.cell).join(',');
      doors = [...board.posts('carol')].filter((p) => p.role === 'door').sort((a, b) => Number(a.ref) - Number(b.ref));
      if (cur >= 0 && doors.map((d) => d.cell).join(',') !== was) finish(board, true);
    },
    step(dt, time, board) {
      stepNotes(board, dt);
      const moving = lastPhase >= 0 && time.phase !== lastPhase;
      lastPhase = time.phase;
      if (time.isDay) tonight = false;
      if (next < 0) next = board.now + 20;
      const evening = time.isDusk || time.isNight;
      const season = board.season.weights.winter >= CAROLS.winter || board.season.festival > 0.3;
      if (cur < 0) {
        const due = moving ? !tonight && time.isDusk : board.now >= next;
        if (evening && season && due && board.weather.rain < 0.3 && doors.length >= 3 && scenesOf(board).may('carols')) {
          if (begin(board)) tonight = true;
          else next = board.now + 30;
        }
        return;
      }
      if (board.stage && (mischiefOf(board.stage).bombs.length > 0 || mischiefOf(board.stage).threats.length > 0)) {
        finish(board, true);
        return;
      }
      const live = singers.filter((s) => !s.lost && board.plans.get(s.p)?.chain === chain);
      for (const s of singers) if (!s.lost && board.plans.get(s.p)?.chain !== chain && s.p.mode !== 'home') s.lost = true;
      if (live.length === 0) {
        finish(board, false);
        return;
      }
      // Anybody who came late to a door the others have left: on after them.
      for (const s of live) {
        const tag = s.p.goal?.errand?.tag ?? '';
        if (s.p.mode === 'linger' && tag.startsWith('carol:') && Number(tag.slice(6)) < cur) s.p.timer = Math.min(s.p.timer, 0.2);
      }
      if (cur >= doors.length) {
        // The round is done: they are walking home.
        if (live.every((s) => s.p.goal?.errand?.tag === 'carol:home' || s.p.mode !== 'linger')) finish(board, false);
        return;
      }
      const tag = `carol:${cur}`;
      const there = live.filter((s) => s.p.mode === 'linger' && s.p.goal?.errand?.tag === tag);
      if (singing < 0) {
        for (const s of there) s.p.pose = 'stand';
        if (there.length >= live.length || (there.length >= 2 && board.now - waitFrom > 20)) {
          singing = board.now;
          callOut(board, doors[cur]!);
        }
        return;
      }
      // Singing: heads up, a sway, a hand lifting the lantern now and then.
      for (const s of there) {
        const beat = Math.floor((board.now - singing) * 1.5 + s.slot) % 4;
        s.p.pose = beat === 0 ? 'look' : 'stand';
        s.p.lift = beat === 2 ? 0.008 : 0;
      }
      if (board.now - singing > CAROLS.sing) {
        sung++;
        singing = -1;
        for (const s of live) {
          s.p.lift = 0;
          s.p.timer = Math.min(s.p.timer, 0.2 + s.slot * 0.25);
        }
        cur++;
        waitFrom = board.now;
      }
    },
    offer(p, _time, board) {
      if (board.claimedBy(p) === chain && !singers.some((s) => s.p === p && !s.lost)) {
        board.unclaim(p);
        p.party = false;
        const home = board.homeStep(p, { tag: 'carol:home', linger: 0.5, load: p.load, done: (q) => void (q.load = null) });
        return home ? { chain, at: 0, steps: [home] } : null;
      }
      return null;
    },
    dispose(board) {
      if (cur >= 0) finish(board, true);
      for (const n of notes) n.h?.release();
      notes.length = 0;
    },
  };
  return chain;
}
