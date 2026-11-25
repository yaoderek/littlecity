import { expect, test } from 'vitest';
import { identity } from '@/core/mat4';
import { AIRBORNE } from '@/gen/airborne';
import { MeshBuilder, PATTERN } from '@/gen/mesh';
import { itemKind } from './item-kind';
import { SLOT_AIR, SLOT_GROUNDED, SlotTable } from './slots';

const board = new MeshBuilder().setPattern(PATTERN.planks).box([0, 0, 0], [1, 1, 1]).build();
const bird = new MeshBuilder().setPattern(PATTERN.planks | AIRBORNE).box([0, 0, 0], [1, 1, 1]).build();

test('a swinging shop sign never makes the grounding picture stale; a thing that really moves does', () => {
  expect(itemKind('lamp', board)).toBe(SLOT_GROUNDED);
  expect(itemKind('lamp', bird)).toBe(SLOT_AIR);
  const slots = new SlotTable();
  const redrawn = (type: string): boolean => {
    const s = slots.alloc();
    slots.setKind(s, itemKind(type, board));
    slots.moved = false;
    slots.setMatrix(s, identity());
    return slots.moved;
  };
  expect(redrawn('hanging-sign')).toBe(false);
  expect(redrawn('lamp')).toBe(true);
});
