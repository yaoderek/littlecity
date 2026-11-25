// What moving a prop or an actor means for the grounding picture (slots.ts, SlotKind). Pure.

import { isAirMesh } from '@/gen/airborne';
import type { MeshData } from '@/gen/mesh';
import { SLOT_AIR, SLOT_GROUNDED, type SlotKind } from './slots';

/**
 * Things that swing where they hang. They stand in the picture and throw their shade, but a few degrees of
 * swing does not move it: shop signs, never quite still in the wind, kept the picture (the costliest pass)
 * being redrawn many times a second in every town with a shop.
 */
const SWINGS: ReadonlySet<string> = new Set(['hanging-sign']);

/** Whether a mesh is all in the air (src/gen/airborne.ts), remembered per mesh. */
const airMeshes = new WeakMap<MeshData, boolean>();

export function meshInAir(mesh: MeshData): boolean {
  let air = airMeshes.get(mesh);
  if (air === undefined) airMeshes.set(mesh, (air = isAirMesh(mesh)));
  return air;
}

export function itemKind(type: string, mesh: MeshData): SlotKind {
  return SWINGS.has(type) || meshInAir(mesh) ? SLOT_AIR : SLOT_GROUNDED;
}
