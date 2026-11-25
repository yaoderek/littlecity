// A VertexPool on the GPU (Look, Stage 1): one BufferGeometry and one Mesh
// per pool (plus a second Mesh on the same geometry for the overlay pass).
// `sync()` uploads only the spans the pool says changed.

import * as THREE from 'three';
import { SIZE_X, SIZE_Z } from '@/core/grid';
import { VertexPool, type Span } from './pool';

export class PoolMesh {
  readonly pool = new VertexPool();
  readonly mesh: THREE.Mesh;
  /** The same geometry, drawn by the overlay pass (light beams). */
  readonly overlay: THREE.Mesh;
  private geometry = new THREE.BufferGeometry();
  private generation = -1;
  private readonly views: THREE.Mesh[] = [];

  constructor(material: THREE.Material, overlayMaterial: THREE.Material, private readonly cull: boolean) {
    this.mesh = new THREE.Mesh(this.geometry, material);
    this.overlay = new THREE.Mesh(this.geometry, overlayMaterial);
    for (const m of [this.mesh, this.overlay]) {
      m.matrixAutoUpdate = false;
      m.frustumCulled = cull;
      m.visible = false;
    }
  }

  /** Another mesh on the same geometry, for a pass with its own material. The caller shows and hides it. */
  addView(material: THREE.Material): THREE.Mesh {
    const m = new THREE.Mesh(this.geometry, material);
    m.matrixAutoUpdate = false;
    m.frustumCulled = false;
    this.views.push(m);
    return m;
  }

  /** Brings the GPU buffers up to date with the pool. Call once per frame, before drawing. Returns whether anything changed. */
  sync(): boolean {
    const pool = this.pool;
    let changed = true;
    if (pool.generation !== this.generation) {
      this.generation = pool.generation;
      this.geometry.dispose();
      const g = new THREE.BufferGeometry();
      const attr = (array: THREE.TypedArray, size: number, normalized: boolean): THREE.BufferAttribute => {
        const a = new THREE.BufferAttribute(array, size, normalized);
        a.setUsage(THREE.DynamicDrawUsage);
        return a;
      };
      g.setAttribute('position', attr(pool.position, 3, false));
      g.setAttribute('normal', attr(pool.normal, 4, true));
      g.setAttribute('color', attr(pool.color, 4, true));
      g.setAttribute('ink', attr(pool.ink, 2, false));
      g.setAttribute('slot', attr(pool.slot, 1, false));
      // A pool that is never culled: three would still work out a sphere round every vertex of it, to sort
      // by (a 33 ms pause on a slow phone each time the pool grew). The middle of the town will do.
      if (!this.cull) g.boundingSphere = new THREE.Sphere(new THREE.Vector3(SIZE_X / 2, 0, SIZE_Z / 2), SIZE_X);
      this.geometry = g;
      this.mesh.geometry = g;
      this.overlay.geometry = g;
      for (const v of this.views) v.geometry = g;
      pool.takeDirty();
    } else {
      const { data, slots } = pool.takeDirty();
      changed = data.length > 0 || slots.length > 0;
      const mark = (name: string, size: number, spans: Span[]): void => {
        if (spans.length === 0) return;
        const a = this.geometry.getAttribute(name) as THREE.BufferAttribute;
        for (const [start, end] of spans) a.addUpdateRange(start * size, (end - start) * size);
        a.needsUpdate = true;
      };
      mark('position', 3, data);
      mark('normal', 4, data);
      mark('color', 4, data);
      mark('ink', 2, data);
      mark('slot', 1, slots);
    }
    this.geometry.setDrawRange(0, pool.count);
    const live = pool.count - pool.garbage > 0;
    this.mesh.visible = live && pool.solidEntries > 0;
    this.overlay.visible = live && pool.beamEntries > 0;
    if (this.cull && live) {
      // Generous: lifted structures bounce and trees sway a little outside their rest bounds.
      const { min, max } = pool;
      const sphere = (this.geometry.boundingSphere ??= new THREE.Sphere());
      sphere.center.set((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
      sphere.radius = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2 + 2;
    }
    return changed;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.overlay.removeFromParent();
    for (const v of this.views) v.removeFromParent();
    this.geometry.dispose();
  }
}
