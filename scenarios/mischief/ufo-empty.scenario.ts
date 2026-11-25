// The UFO with nobody to take (design section 13b): a street and a square with
// no houses on them, so nobody lives here and nobody is out. Called here, the
// saucer comes, its pilot leans over the dome's edge peering down while it
// sweeps its beam about the empty street, gives up and flies off.
//
//   node src/life/testing/sequence.mjs ufo-empty --edit 'ufo@14,1,14' --frames 12 --every 400

import { scenario } from '@/scenario';

export default scenario({
  name: 'ufo-empty',
  seed: 11,
  about: 'An empty street and square: nobody lives here, so a UFO called here finds nobody.',
  build(b) {
    b.path(8, 14, 20, 14);
    b.plaza(12, 10, 16, 13);
    b.put('tree', 9, 12);
    b.put('tree', 18, 12);
  },
  cameras: [{ name: 'front', yaw: 45, pitch: 32, zoom: 4, target: [14, 2, 13] }],
  expect(_plan, dressing, check) {
    check.equal(dressing.actors.filter((a) => a.type === 'resident').length, 0, 'residents');
  },
});
