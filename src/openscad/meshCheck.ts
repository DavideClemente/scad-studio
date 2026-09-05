/**
 * Counts how many separate solids a binary STL contains.
 *
 * A design that renders as several disconnected shells looks fine on screen but
 * falls apart on the print bed, which is the single easiest mistake to make with
 * cut-out designs like lettering inside a frame. Vertices are matched by exact
 * position (OpenSCAD emits shared corners identically), then union-find groups
 * the triangles that touch.
 */
export function countShells(stl: ArrayBuffer): number {
  const view = new DataView(stl);
  if (view.byteLength < 84) return 0;
  const triangles = view.getUint32(80, true);
  if (view.byteLength < 84 + triangles * 50) return 0;

  const ids = new Map<string, number>();
  const parent: number[] = [];

  const find = (a: number): number => {
    let root = a;
    while (parent[root] !== root) root = parent[root];
    while (parent[a] !== root) {
      const next = parent[a];
      parent[a] = root;
      a = next;
    }
    return root;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };

  const vertexId = (offset: number): number => {
    const key = `${view.getFloat32(offset, true)},${view.getFloat32(offset + 4, true)},${view.getFloat32(offset + 8, true)}`;
    let id = ids.get(key);
    if (id === undefined) {
      id = parent.length;
      ids.set(key, id);
      parent.push(id);
    }
    return id;
  };

  for (let i = 0; i < triangles; i++) {
    const base = 84 + i * 50 + 12;
    const a = vertexId(base);
    const b = vertexId(base + 12);
    const c = vertexId(base + 24);
    union(a, b);
    union(a, c);
  }

  const roots = new Set<number>();
  for (let i = 0; i < parent.length; i++) roots.add(find(i));
  return roots.size;
}
