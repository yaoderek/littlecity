// The raids of a town (design section 13b): one register per stage, shared by
// the Raid tool (src/ui/mischief.ts), the menu's Raiders switch, the raid
// system (which plans, steps and draws them) and the raid's chain on the
// board (which sends the band about ashore).
//
//   const raids = raidsOf(view.stage);
//   raids.summon({ x, z });     // the Raid tool: a longship off the nearest coast; returns why not, or null
//   raids.auto = false;         // the menu's switch: none come on their own
//   raids.current               // the raid going on, or null
//
// One raid at a time.

import { phrase } from '@/core/phrase';
import type { LifeStage } from '../api';
import type { Board } from '../town/board';
import type { DressingPlan, ShapePlan } from '@/resolve/plan';
import type { Raid, RaidSound } from './raid';
import type { RaidKind } from './site';

export interface Summon {
  at: { x: number; z: number } | null;
  kind?: RaidKind;
  /** Came on its own (the switch), not from the tool. */
  auto?: boolean;
}

export interface Raids {
  /** The raid going on now, or null. */
  current: Raid | null;
  /** Raids come on their own (the menu's Raiders switch, kept in the browser). */
  auto: boolean;
  /** The Raid tool: a raid near this point (or the town). Null if it is on its way; else why not. */
  summon(s: Summon): string | null;
  /** Ends the raid going on now, at once, with nothing left (undo, a new town). */
  end(): void;
  /** Sounds of the raid (the sound system listens). */
  on(fn: (s: RaidSound) => void): () => void;
  emit(s: RaidSound): void;
  /** Why the last raid on its own did not come (for watching and tests), or ''. */
  why: string;
  /** Raids begun on this stage, and the life time the last one began (for the cadence). */
  count: number;
  lastAt: number;
  /** Set by the system and the chain: the town now, and its board. */
  shape: ShapePlan | null;
  dressing: DressingPlan | null;
  board: Board | null;
  /** Set by the system: starts a raid now (planning it on the town as it is). */
  start: ((s: Summon) => string | null) | null;
}

const byStage = new WeakMap<object, Raids>();

export function raidsOf(stage: LifeStage | object): Raids {
  let r = byStage.get(stage);
  if (!r) {
    let listeners: ((s: RaidSound) => void)[] = [];
    const raids: Raids = {
      current: null,
      auto: true,
      why: '',
      count: 0,
      lastAt: -Infinity,
      shape: null,
      dressing: null,
      board: null,
      start: null,
      summon(s) {
        if (raids.current) return phrase('raiders are already here');
        if (!raids.start) return phrase('the town is not ready yet');
        return raids.start(s);
      },
      end() {
        raids.current?.end(raids.board);
        raids.current = null;
      },
      on(fn) {
        listeners.push(fn);
        return () => {
          listeners = listeners.filter((f) => f !== fn);
        };
      },
      emit(s) {
        for (const fn of listeners) fn(s);
      },
    };
    byStage.set(stage, (r = raids));
  }
  return r;
}
