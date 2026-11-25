// The town being played: the world, its terrain, undo history and the
// staged resolver, behind one small object. Owner: Interface.
//
// It has no DOM and no renderer in it. Whoever creates it says what
// "showing a town" means (main.ts: view.setTown, life.sync, the landing
// signal, autosave), so tests drive it with nothing but a callback.
//
// Every edit goes through canApply first (the world module decides what is
// legal; nothing here or in the UI does) and is one undo step, unless it is
// made between begin() and end(): a Shift-drag run undoes as one.

import type { Edit, EditResult, Terrain, World } from '@/core/world';
import type { ResolveOptions } from '@/resolve/index';
import type { DressingPlan, ShapePlan } from '@/resolve/plan';
import { createStagedResolver, type StagedResolver } from '@/resolve/staged';
import { canRedo, canUndo, createHistory, pushHistory, redo, replacePresent, undo, type History } from '@/world/history';
import { islandOf } from '@/terrain/land';
import { applyEdit, applyEdits, canApply } from '@/world/world';

export interface GameStart {
  world: World;
  /** The island the world was made on (generated or hand-made); the world's reshaped columns are laid over it. */
  terrain: Terrain;
  /** Passed to every resolve (a scenario's own rules). */
  resolve?: ResolveOptions;
}

export interface GameEvents {
  /**
   * The town to draw changed. `landed` is the edit that changed it (null for
   * undo, redo, a new island or a restyle); `more`, the others of a run that
   * landed with it. Called once at creation too.
   */
  show(shape: ShapePlan, landed: Edit | null, more?: readonly Edit[]): void;
  /** The world or the history changed: refresh buttons, schedule a save. */
  changed?(): void;
}

export interface Game {
  readonly world: World;
  /** The island as it stands now, reshaped land included. */
  readonly terrain: Terrain;
  /** The shape of the world as shown. */
  readonly shape: ShapePlan;
  /** Would this edit be legal now? */
  can(e: Edit): EditResult;
  /** Applies the edit if it is legal and shows the result. */
  edit(e: Edit): EditResult;
  /**
   * Applies every legal edit of a list in order and shows the result once
   * (no landing: a whole town at a time). One undo step unless a batch is
   * open. Returns how many were applied.
   */
  editAll(edits: readonly Edit[]): number;
  /**
   * Applies every legal edit of a list in order and shows the result once,
   * each of them landing (a town growing on a slow device, several pieces at
   * a time: working the town out costs the same for one as for ten).
   */
  editRun(edits: readonly Edit[]): number;
  /** Opens a batch: the edits until end() are one undo step. */
  begin(): void;
  end(): void;
  /** A batch is open. */
  readonly batching: boolean;
  /**
   * Closes the open batch without recording it: the town goes back to how it
   * was when the batch began (mischief: undo in the middle of a fire).
   * False if no batch was open.
   */
  abort(): boolean;
  /**
   * Applies every legal edit of a list and shows the result, as part of
   * whatever undo step is current: inside a batch it joins the batch,
   * otherwise it changes the present step instead of making a new one (the
   * town mending itself). Returns how many were applied.
   */
  amend(edits: readonly Edit[]): number;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  undo(): boolean;
  redo(): boolean;
  /** A what-if shape for the ghost preview. Changes nothing. */
  preview(world: World): ShapePlan;
  /** Once per frame: the dressing for the newest world when it is ready, else null. */
  poll(): { shape: ShapePlan; dressing: DressingPlan } | null;
  /** A different town altogether (new island, a loaded town): history starts over. */
  restart(start: GameStart): void;
  /** Resolves and shows the same world again (style values changed). */
  refresh(): void;
}

export function createGame(start: GameStart, events: GameEvents): Game {
  let terrain = start.terrain;
  let resolver: StagedResolver = createStagedResolver(terrain, start.resolve ?? {});
  let history: History = createHistory(start.world);
  let world = start.world;
  let shape: ShapePlan;
  /** The world when the open batch began, or null. */
  let batch: World | null = null;

  const show = (next: World, landed: Edit | null, more?: readonly Edit[]): void => {
    world = next;
    shape = resolver.update(world);
    if (more) events.show(shape, landed, more);
    else events.show(shape, landed);
    events.changed?.();
  };

  const closeBatch = (): void => {
    if (batch === null) return;
    batch = null;
    if (world !== history.present) {
      history = pushHistory(history, world);
      events.changed?.();
    }
  };

  const step = (next: History): boolean => {
    if (next === history) return false;
    history = next;
    show(history.present, null);
    return true;
  };

  shape = resolver.update(world);
  events.show(shape, null);
  events.changed?.();

  return {
    get world() {
      return world;
    },
    get terrain() {
      // The island as the player has shaped it (World.terrainEdits over the start's island).
      return islandOf(world, terrain);
    },
    get shape() {
      return shape;
    },
    can: (e) => canApply(world, terrain, e),
    edit(e) {
      const verdict = canApply(world, terrain, e);
      if (!verdict.ok) return verdict;
      const next = applyEdit(world, terrain, e);
      if (batch === null) history = pushHistory(history, next);
      show(next, e);
      return verdict;
    },
    editAll(edits) {
      const { world: next, applied: n } = applyEdits(world, terrain, edits);
      if (n === 0) return 0;
      if (batch === null) history = pushHistory(history, next);
      show(next, null);
      return n;
    },
    editRun(edits) {
      let next = world;
      const done: Edit[] = [];
      for (const e of edits) {
        if (!canApply(next, terrain, e).ok) continue;
        next = applyEdit(next, terrain, e);
        done.push(e);
      }
      if (done.length === 0) return 0;
      if (batch === null) history = pushHistory(history, next);
      show(next, done[0]!, done.slice(1));
      return done.length;
    },
    begin() {
      closeBatch();
      batch = world;
    },
    end: closeBatch,
    get batching() {
      return batch !== null;
    },
    abort() {
      if (batch === null) return false;
      const before = batch;
      batch = null;
      if (world !== before) show(before, null);
      else events.changed?.();
      return true;
    },
    amend(edits) {
      const { world: next, applied: n } = applyEdits(world, terrain, edits);
      if (n === 0) return 0;
      if (batch === null) history = replacePresent(history, next);
      show(next, null);
      return n;
    },
    get canUndo() {
      return batch === null && canUndo(history);
    },
    get canRedo() {
      return batch === null && canRedo(history);
    },
    undo: () => batch === null && canUndo(history) && step(undo(history)),
    redo: () => batch === null && canRedo(history) && step(redo(history)),
    preview: (w) => resolver.preview(w),
    poll: () => resolver.poll(),
    restart(next) {
      batch = null;
      terrain = next.terrain;
      resolver = createStagedResolver(terrain, next.resolve ?? {});
      history = createHistory(next.world);
      show(next.world, null);
    },
    refresh() {
      show(world, null);
    },
  };
}
