// Edits: every placement, colour and erase rule in design section 7. Owner: Logic.
//
// canApply never throws; applyEdit returns a new World (the input is never
// touched) and throws only if canApply says no. The helpers below (solidity,
// walkable tops, edge validity) are exported because town logic and the UI
// ask the same questions.

import { phrase, type Vars } from '@/core/phrase';
import {
  above,
  below,
  columnIndex,
  edgeCells,
  edgeOf,
  inBounds,
  inColumnBounds,
  keyX,
  keyY,
  keyZ,
  neighbor,
  NO_CELL,
  type CellKey,
  type Dir4,
  type EdgeKey,
} from '@/core/grid';
import { AUTO_KINDS, EDGE_KINDS, FLOOR_KINDS, KINDS, PALETTE_SIZE, placedInfo, type EdgeKind, type PlacedKind } from '@/core/kinds';
import { hash } from '@/core/rand';
import type { Block, Edit, EditResult, Rot, Terrain, World } from '@/core/world';
import { isHouseStyle } from '@/style/houses';
import { isRuin } from './damage';
import { islandOf } from '@/terrain/land';
import { canShapeLand, shapeLand } from './land';

export type { Block, Edit, EditResult, Rot, World } from '@/core/world';

export function emptyWorld(seed: number, terrainGen: 1 | 2 = 1): World {
  const w: World = { version: 1, seed, nextSeq: 1, blocks: new Map(), floors: new Map(), edges: new Map() };
  // Generator 1 leaves the field out, so its worlds are exactly what they always were.
  return terrainGen === 2 ? { ...w, terrainGen } : w;
}

// ───────────────────────────────────────────────────────── questions ──

/** A valid cell key inside the 48 × 32 × 48 grid. */
export function cellInGrid(cell: unknown): cell is CellKey {
  return (
    typeof cell === 'number' &&
    Number.isInteger(cell) &&
    cell >= 0 &&
    cell < 1 << 17 &&
    inBounds(keyX(cell), keyY(cell), keyZ(cell))
  );
}

/** Terrain height of a column; 0 (water) outside the map. */
export function groundAt(t: Terrain, x: number, z: number): number {
  return inColumnBounds(x, z) ? t.height[columnIndex(x, z)]! : 0;
}

/** The cell is inside the terrain (y below its column's height). */
export function insideTerrain(t: Terrain, cell: CellKey): boolean {
  return keyY(cell) < t.height[columnIndex(keyX(cell), keyZ(cell))]!;
}

/**
 * Solid (design section 5): terrain, or a block whose kind is solid. An Auto
 * block is always solid. NO_CELL is not solid.
 */
export function isSolid(w: World, t: Terrain, cell: CellKey): boolean {
  if (cell === NO_CELL) return false;
  if (insideTerrain(t, cell)) return true;
  const b = w.blocks.get(cell);
  return b !== undefined && placedInfo(b.kind).solid;
}

/**
 * The cell sits directly on a walkable top: the terrain top of a land
 * column, or the top of a solid block. Open water is not a walkable top.
 */
export function onWalkableTop(w: World, t: Terrain, cell: CellKey): boolean {
  const y = keyY(cell);
  const h = t.height[columnIndex(keyX(cell), keyZ(cell))]!;
  if (y < h) return false;
  if (y === h) return h > 0;
  return isSolid(w, t, below(cell));
}

/** A person could stand in this cell: on a walkable top, and no solid block in it. */
export function isStandable(w: World, t: Terrain, cell: CellKey): boolean {
  if (!onWalkableTop(w, t, cell)) return false;
  const b = w.blocks.get(cell);
  return b === undefined || !placedInfo(b.kind).solid;
}

/** Edge-piece rule: at least one of the two cells is on a walkable top and holds no solid block. */
export function edgeIsValid(w: World, t: Terrain, edge: EdgeKey): boolean {
  const [a, b] = edgeCells(edge);
  if (a === NO_CELL || b === NO_CELL) return false;
  return isStandable(w, t, a) || isStandable(w, t, b);
}

/** A floor may lie in this cell with this block in it (design section 7). */
function blockKeepsFloor(w: World, t: Terrain, cell: CellKey, kind: PlacedKind): boolean {
  if (kind === 'arch') return isSolid(w, t, below(cell));
  return kind !== 'auto' && KINDS[kind].keepsFloor;
}

/**
 * The directions a new stairs block at `cell` could point: towards each
 * neighbouring column whose walkable top is exactly one level higher (the
 * neighbour at this level is solid, the one above it is not). In N, E, S, W
 * order; the UI picks the one nearest the pointer, or away from the camera
 * when the list is empty.
 */
export function stairsUpDirs(w: World, t: Terrain, cell: CellKey): Dir4[] {
  const out: Dir4[] = [];
  for (let d = 0 as Dir4; d < 4; d = (d + 1) as Dir4) {
    const n = neighbor(cell, d);
    if (n === NO_CELL) continue;
    if (isSolid(w, t, n) && !isSolid(w, t, above(n))) out.push(d);
  }
  return out;
}

/** The colour an 'auto'-coloured block gets on bare ground or water: hashed for Auto, house and tower, 0 otherwise. */
export function bareGroundColor(seed: number, cell: CellKey, kind: PlacedKind): number {
  return placedInfo(kind).variedColor ? hash(seed, cell) % PALETTE_SIZE : 0;
}

function validColor(c: unknown): c is number {
  return typeof c === 'number' && Number.isInteger(c) && c >= 0 && c < PALETTE_SIZE;
}
function validRot(r: unknown): r is Rot {
  return r === 0 || r === 1 || r === 2 || r === 3;
}
const PLACED_KINDS = new Set<string>(['auto', ...Object.keys(KINDS)]);
function validPlacedKind(k: unknown): k is PlacedKind {
  return typeof k === 'string' && PLACED_KINDS.has(k);
}
function edgeInGrid(edge: unknown): edge is EdgeKey {
  if (typeof edge !== 'number' || !Number.isInteger(edge) || edge < 0) return false;
  const [a, b] = edgeCells(edge);
  return cellInGrid(a) && b !== NO_CELL;
}

/** The kinds the Change tool steps through (design section 7). */
const CHANGEABLE = new Set<PlacedKind>(['auto', ...AUTO_KINDS]);

// ───────────────────────────────────────────────────────────── verdicts ──

/** Refused, and why: a plain English line (the player reads it in their language through src/i18n `say()`), a piece by `{kind}`. */
const no = (line: string, vars?: Vars): EditResult => ({ ok: false, reason: vars ? phrase(line, vars) : line });
const yes: EditResult = { ok: true };

function canPlaceBlockKind(w: World, t: Terrain, cell: CellKey, kind: PlacedKind): EditResult {
  const info = placedInfo(kind);
  const x = keyX(cell);
  const z = keyZ(cell);
  const y = keyY(cell);
  if (info.waterOnly && !(y === 0 && groundAt(t, x, z) === 0)) return no('a dock goes on open water, at sea level');
  const under = below(cell);
  const underBlock = under === NO_CELL ? undefined : w.blocks.get(under);
  const onWindmill = kind === 'windmill' && underBlock?.kind === 'windmill';
  if (underBlock && !placedInfo(underBlock.kind).solid && !onWindmill) {
    return no('nothing can be built on a {kind}', { kind: underBlock.kind });
  }
  if (info.needsWalkableTop && !onWindmill && !onWalkableTop(w, t, cell)) {
    return no('a {kind} needs firm ground or the top of a solid block', { kind });
  }
  return yes;
}

/** Would this edit be legal? Never throws; an illegal edit comes back with a plain reason. */
export function canApply(w: World, t: Terrain, e: Edit): EditResult {
  try {
    // The world's own island: the terrain passed may be the generated one, or one from before a land edit.
    return verdict(w, islandOf(w, t), e);
  } catch {
    return no('that edit could not be read');
  }
}

function verdict(w: World, t: Terrain, e: Edit): EditResult {
  if (!e || typeof e !== 'object') return no('that edit could not be read');
  switch (e.type) {
    case 'placeBlock': {
      if (!cellInGrid(e.cell)) return no('outside the map');
      if (!validPlacedKind(e.kind)) return no('unknown piece');
      if (e.color !== 'auto' && !validColor(e.color)) return no('unknown colour');
      if (e.rot !== undefined && !validRot(e.rot)) return no('unknown rotation');
      if (e.style !== undefined && !isHouseStyle(e.style)) return no('unknown house style');
      if (insideTerrain(t, e.cell)) return no('inside the ground');
      if (w.blocks.has(e.cell)) return no('something is already there');
      return canPlaceBlockKind(w, t, e.cell, e.kind);
    }
    case 'placeFloor': {
      if (!cellInGrid(e.cell)) return no('outside the map');
      if (!FLOOR_KINDS.includes(e.floor)) return no('unknown floor');
      if (insideTerrain(t, e.cell)) return no('inside the ground');
      if (!onWalkableTop(w, t, e.cell)) {
        const water = keyY(e.cell) === 0 && groundAt(t, keyX(e.cell), keyZ(e.cell)) === 0;
        return water ? no('floors cannot go on water') : no('a floor needs firm ground or the top of a solid block');
      }
      const b = w.blocks.get(e.cell);
      if (b && !blockKeepsFloor(w, t, e.cell, b.kind)) return no('a floor cannot share a cell with a {kind}', { kind: b.kind });
      if (w.floors.get(e.cell) === e.floor) return no('there is already a {kind} there', { kind: e.floor });
      return yes;
    }
    case 'placeEdge': {
      if (!edgeInGrid(e.edge)) return no('outside the map');
      if (!EDGE_KINDS.includes(e.kind)) return no('unknown edge piece');
      if (w.edges.get(e.edge) === e.kind) return no('there is already a {kind} there', { kind: e.kind });
      if (!edgeIsValid(w, t, e.edge)) return no('a {kind} edge needs open, firm ground on at least one side', { kind: e.kind });
      return yes;
    }
    case 'eraseBlock':
      if (!cellInGrid(e.cell)) return no('outside the map');
      return w.blocks.has(e.cell) ? yes : no('nothing there');
    case 'eraseFloor':
      if (!cellInGrid(e.cell)) return no('outside the map');
      return w.floors.has(e.cell) ? yes : no('nothing there');
    case 'eraseEdge':
      if (!edgeInGrid(e.edge)) return no('outside the map');
      return w.edges.has(e.edge) ? yes : no('nothing there');
    case 'setKind': {
      if (!cellInGrid(e.cell)) return no('outside the map');
      const b = w.blocks.get(e.cell);
      if (!b) return no('nothing there');
      if (!validPlacedKind(e.kind)) return no('unknown piece');
      if (!CHANGEABLE.has(b.kind) || !CHANGEABLE.has(e.kind)) return no('a {kind} cannot change into a {into}', { kind: b.kind, into: e.kind });
      if (b.kind === e.kind) return no('it is already a {kind}', { kind: e.kind });
      return canPlaceBlockKind(w, t, e.cell, e.kind);
    }
    case 'setRot': {
      if (!cellInGrid(e.cell)) return no('outside the map');
      const b = w.blocks.get(e.cell);
      if (!b) return no('nothing there');
      if (b.kind !== 'stairs') return no('only stairs turn');
      if (!validRot(e.rot)) return no('unknown rotation');
      return yes;
    }
    case 'paint': {
      if (!cellInGrid(e.cell)) return no('outside the map');
      if (!w.blocks.has(e.cell)) return no('nothing there');
      if (!validColor(e.color)) return no('unknown colour');
      return yes;
    }
    case 'setRuin': {
      // Mischief (design section 13b): never terrain, only a block that is there.
      if (!cellInGrid(e.cell)) return no('outside the map');
      const b = w.blocks.get(e.cell);
      if (!b) return no('nothing there');
      if (e.ruin !== 0 && !isRuin(e.ruin)) return no('unknown damage');
      if ((b.ruin ?? 0) === e.ruin) return no(e.ruin ? 'it is already like that' : 'it is not damaged');
      return yes;
    }
    case 'repair': {
      if (!cellInGrid(e.cell)) return no('outside the map');
      const b = w.blocks.get(e.cell);
      if (!b) return no('nothing there');
      return b.ruin ? yes : no('it is not damaged');
    }
    case 'land':
      return canShapeLand(w, t, e);
    default:
      return no('unknown edit');
  }
}

// ──────────────────────────────────────────────────────────── applying ──

/** The four edges around a cell at its own level. */
function edgesAround(cell: CellKey): EdgeKey[] {
  const out: EdgeKey[] = [];
  for (let d = 0 as Dir4; d < 4; d = (d + 1) as Dir4) {
    const e = edgeOf(cell, d);
    if (e !== NO_CELL) out.push(e);
  }
  return out;
}

/** Applies a legal edit and returns a new World; the input is untouched. Throws if canApply says no. */
export function applyEdit(w: World, t: Terrain, e: Edit): World {
  const v = canApply(w, t, e);
  if (!v.ok) throw new Error(`applyEdit(${e?.type}): ${v.reason}`);
  t = islandOf(w, t);
  switch (e.type) {
    case 'placeBlock': {
      let color: number;
      if (e.color !== 'auto') color = e.color;
      else if (e.from !== null && e.from !== undefined && w.blocks.has(e.from)) color = w.blocks.get(e.from)!.color;
      else color = bareGroundColor(w.seed, e.cell, e.kind);
      let rot: Rot = 0;
      if (e.kind === 'stairs') rot = e.rot ?? stairsUpDirs(w, t, e.cell)[0] ?? 0;
      const blocks = new Map(w.blocks);
      // Only a house keeps a style (design section 7: Auto blocks have none); 0 is Random and is not stored.
      const style = e.kind === 'house' && e.style ? e.style : 0;
      blocks.set(e.cell, style ? { kind: e.kind, color, rot, seq: w.nextSeq, style } : { kind: e.kind, color, rot, seq: w.nextSeq });
      const next: World = { ...w, blocks, nextSeq: w.nextSeq + 1 };
      return afterBlockChange(next, t, e.cell);
    }
    case 'placeFloor': {
      const floors = new Map(w.floors);
      floors.set(e.cell, e.floor);
      return { ...w, floors };
    }
    case 'placeEdge': {
      const edges = new Map(w.edges);
      edges.set(e.edge, e.kind);
      return { ...w, edges };
    }
    case 'eraseBlock': {
      const blocks = new Map(w.blocks);
      blocks.delete(e.cell);
      const next: World = { ...w, blocks };
      return afterErase(next, t, e.cell);
    }
    case 'eraseFloor': {
      const floors = new Map(w.floors);
      floors.delete(e.cell);
      return { ...w, floors };
    }
    case 'eraseEdge': {
      const edges = new Map(w.edges);
      edges.delete(e.edge);
      return { ...w, edges };
    }
    case 'setKind': {
      const blocks = new Map(w.blocks);
      blocks.set(e.cell, { ...w.blocks.get(e.cell)!, kind: e.kind });
      return afterBlockChange({ ...w, blocks }, t, e.cell);
    }
    case 'setRot': {
      const blocks = new Map(w.blocks);
      blocks.set(e.cell, { ...w.blocks.get(e.cell)!, rot: e.rot });
      return { ...w, blocks };
    }
    case 'paint': {
      const blocks = new Map(w.blocks);
      blocks.set(e.cell, { ...w.blocks.get(e.cell)!, color: e.color });
      return { ...w, blocks };
    }
    case 'setRuin':
    case 'repair': {
      // The block keeps everything else (kind, colour, style, seq): repairing restores exactly what was built.
      const blocks = new Map(w.blocks);
      const { ruin: _old, ...rest } = w.blocks.get(e.cell)!;
      const ruin = e.type === 'setRuin' ? e.ruin : 0;
      blocks.set(e.cell, ruin ? { ...rest, ruin } : rest);
      return { ...w, blocks };
    }
    case 'land': {
      const r = shapeLand(w, t, e);
      return typeof r === 'string' ? w : r.world;
    }
  }
}

/**
 * Applies edits in order, skipping the ones canApply refuses (against the world so far).
 * A run of setRuin/repair edits shares one copy of `blocks`, written in place; the input
 * world is untouched. Any other edit goes through applyEdit. Same result as folding applyEdit.
 */
export function applyEdits(w: World, t: Terrain, edits: readonly Edit[]): { world: World; applied: number } {
  let cur = w;
  let mine: Map<CellKey, Block> | null = null; // our private copy of blocks, once made
  let applied = 0;
  for (const e of edits) {
    if (!canApply(cur, t, e).ok) continue;
    if (e.type === 'setRuin' || e.type === 'repair') {
      if (!mine || cur.blocks !== mine) cur = { ...cur, blocks: (mine = new Map(cur.blocks)) };
      const { ruin: _old, ...rest } = mine.get(e.cell)!;
      const ruin = e.type === 'setRuin' ? e.ruin : 0;
      mine.set(e.cell, ruin ? { ...rest, ruin } : rest);
    } else {
      cur = applyEdit(cur, t, e);
    }
    applied++;
  }
  return { world: applied === 0 ? w : cur, applied };
}

/**
 * Side effects of a block appearing (or changing kind) in `cell`: a floor
 * in the cell stays only beside the pieces that keep it; an edge piece goes
 * only when both of its sides are now solid.
 */
function afterBlockChange(next: World, t: Terrain, cell: CellKey): World {
  const block = next.blocks.get(cell)!;
  let floors = next.floors;
  if (floors.has(cell) && !blockKeepsFloor(next, t, cell, block.kind)) {
    const f = new Map(floors);
    f.delete(cell);
    floors = f;
  }
  let edges: Map<EdgeKey, EdgeKind> | null = null;
  if (placedInfo(block.kind).solid) {
    for (const e of edgesAround(cell)) {
      if (!next.edges.has(e)) continue;
      const [a, b] = edgeCells(e);
      if (isSolid(next, t, a) && isSolid(next, t, b)) (edges ??= new Map(next.edges)).delete(e);
    }
  }
  return floors === next.floors && !edges ? next : { ...next, floors, edges: edges ?? next.edges };
}

/**
 * Side effects of erasing the block in `cell`: blocks above stay (they get
 * generated supports), but a floor lying on its top goes, and so does an
 * edge piece on its top unless the other side still has a walkable top.
 */
function afterErase(next: World, t: Terrain, cell: CellKey): World {
  const up = above(cell);
  if (up === NO_CELL) return next;
  let floors = next.floors;
  if (floors.has(up) && !onWalkableTop(next, t, up)) {
    const f = new Map(floors);
    f.delete(up);
    floors = f;
  }
  let edges: Map<EdgeKey, EdgeKind> | null = null;
  for (const e of edgesAround(up)) {
    if (next.edges.has(e) && !edgeIsValid(next, t, e)) (edges ??= new Map(next.edges)).delete(e);
  }
  return floors === next.floors && !edges ? next : { ...next, floors, edges: edges ?? next.edges };
}

// ───────────────────────────────────────────────────────── conveniences ──

/** The Change tool's next kind for a block, or null if it does not change (design section 7). */
export function nextChangeKind(w: World, t: Terrain, cell: CellKey): PlacedKind | null {
  const b = w.blocks.get(cell);
  if (!b || !CHANGEABLE.has(b.kind)) return null;
  const cycle: PlacedKind[] = ['auto', ...AUTO_KINDS];
  for (let i = 1; i < cycle.length; i++) {
    const k = cycle[(cycle.indexOf(b.kind) + i) % cycle.length]!;
    if (canApply(w, t, { type: 'setKind', cell, kind: k }).ok) return k;
  }
  return null;
}
