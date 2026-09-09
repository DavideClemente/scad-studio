import * as THREE from 'three';

/**
 * Triangle-level connectivity for a rendered mesh.
 *
 * An STL is a bag of loose triangles: it has no faces, no edges and no circles,
 * only corners that happen to sit in the same place. Measuring against one means
 * putting that structure back first — welding coincident corners so triangles
 * know their neighbours, which is what everything in `measureFeatures` walks.
 *
 * Corners are matched on a grid a millionth of the model across, rather than by
 * exact equality the way `countShells` does. OpenSCAD writes a shared corner as
 * the same three floats every time and would be welded either way, but a mesh
 * that has been through a rotation or an export elsewhere carries corners that
 * miss each other in the last bit — and a single missed weld is a gap a ring walk
 * stops dead at, which loses the whole circle it was tracing.
 */
export type Topology = {
  faceCount: number;
  /** Welded vertex index of each face's three corners, three entries per face. */
  corners: Int32Array;
  /** Welded vertex positions in the geometry's own space, three floats each. */
  positions: Float32Array;
  /** Unit face normal, three floats each. Zero for a degenerate triangle. */
  normals: Float32Array;
  /**
   * The face on the other side of each corner's outgoing edge — corner c to
   * corner c+1 — or -1 where the edge is a boundary or the mesh is not manifold.
   */
  neighbors: Int32Array;
  /** Start of each vertex's run in `vertexFaces`; length is vertexCount + 1. */
  vertexFaceStart: Int32Array;
  /** Faces meeting at each vertex, grouped by vertex. */
  vertexFaces: Int32Array;
  /** Length of the model's bounding-box diagonal, the scale tolerances work in. */
  scale: number;
};

/**
 * Builds the topology of a geometry. Linear in triangle count but not free — a
 * six-figure mesh takes a moment — so callers build it once, lazily, when the
 * user actually asks to measure something.
 */
export function buildTopology(geometry: THREE.BufferGeometry): Topology {
  const position = geometry.getAttribute('position');
  const index = geometry.getIndex();
  const faceCount = Math.floor((index ? index.count : position.count) / 3);

  geometry.computeBoundingBox();
  const size = new THREE.Vector3();
  geometry.boundingBox?.getSize(size);
  const scale = Math.max(size.length(), 1e-6);
  const grid = scale * 1e-6;

  const corners = new Int32Array(faceCount * 3);
  const ids = new Map<string, number>();
  const welded: number[] = [];

  for (let c = 0; c < faceCount * 3; c++) {
    const i = index ? index.getX(c) : c;
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    const cx = Math.round(x / grid);
    const cy = Math.round(y / grid);
    const cz = Math.round(z / grid);

    const key = `${cx},${cy},${cz}`;
    let id = ids.get(key);
    // Two corners a hair apart can still round into different cells, so a miss
    // looks around before giving up. Only a corner genuinely new to the mesh
    // pays for the search; every repeat of one already placed hits its cell.
    if (id === undefined) {
      search: for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dz = -1; dz <= 1; dz++) {
            const near = ids.get(`${cx + dx},${cy + dy},${cz + dz}`);
            if (near !== undefined) {
              id = near;
              break search;
            }
          }
        }
      }
      if (id === undefined) {
        id = welded.length / 3;
        welded.push(x, y, z);
      }
      ids.set(key, id);
    }
    corners[c] = id;
  }

  const positions = new Float32Array(welded);
  const vertexCount = positions.length / 3;

  const normals = new Float32Array(faceCount * 3);
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  const normal = new THREE.Vector3();
  for (let f = 0; f < faceCount; f++) {
    const a = corners[f * 3] * 3;
    const b = corners[f * 3 + 1] * 3;
    const c = corners[f * 3 + 2] * 3;
    ab.set(positions[b] - positions[a], positions[b + 1] - positions[a + 1], positions[b + 2] - positions[a + 2]);
    ac.set(positions[c] - positions[a], positions[c + 1] - positions[a + 1], positions[c + 2] - positions[a + 2]);
    normal.crossVectors(ab, ac);
    // A zero-area triangle has no direction to report. Left at zero, it fails
    // every angle test it takes part in, which keeps it out of regions rather
    // than letting a random direction drag one off course.
    if (normal.lengthSq() > 0) normal.normalize();
    normals[f * 3] = normal.x;
    normals[f * 3 + 1] = normal.y;
    normals[f * 3 + 2] = normal.z;
  }

  // Each undirected edge is claimed by the first face to reach it; the second
  // face to arrive pairs up with it. A third would mean a non-manifold edge, and
  // is left unpaired rather than picking a side.
  const neighbors = new Int32Array(faceCount * 3).fill(-1);
  const edgeOwner = new Map<string, number>();
  for (let f = 0; f < faceCount; f++) {
    for (let c = 0; c < 3; c++) {
      const v0 = corners[f * 3 + c];
      const v1 = corners[f * 3 + ((c + 1) % 3)];
      if (v0 === v1) continue;
      const key = v0 < v1 ? `${v0}_${v1}` : `${v1}_${v0}`;
      const owner = edgeOwner.get(key);
      if (owner === undefined) {
        edgeOwner.set(key, f * 3 + c);
      } else if (neighbors[owner] === -1) {
        neighbors[owner] = f;
        neighbors[f * 3 + c] = Math.floor(owner / 3);
      }
    }
  }

  // Vertex-to-face lists, packed end to end: count, prefix-sum, then fill.
  const vertexFaceStart = new Int32Array(vertexCount + 1);
  for (let c = 0; c < faceCount * 3; c++) vertexFaceStart[corners[c] + 1]++;
  for (let v = 0; v < vertexCount; v++) vertexFaceStart[v + 1] += vertexFaceStart[v];
  const vertexFaces = new Int32Array(faceCount * 3);
  const cursor = Int32Array.from(vertexFaceStart.subarray(0, vertexCount));
  for (let f = 0; f < faceCount; f++) {
    for (let c = 0; c < 3; c++) vertexFaces[cursor[corners[f * 3 + c]]++] = f;
  }

  return { faceCount, corners, positions, normals, neighbors, vertexFaceStart, vertexFaces, scale };
}

export function vertexPosition(topology: Topology, vertex: number, target: THREE.Vector3): THREE.Vector3 {
  const i = vertex * 3;
  return target.set(topology.positions[i], topology.positions[i + 1], topology.positions[i + 2]);
}

export function faceNormal(topology: Topology, face: number, target: THREE.Vector3): THREE.Vector3 {
  const i = face * 3;
  return target.set(topology.normals[i], topology.normals[i + 1], topology.normals[i + 2]);
}

/** The welded vertex at corner `corner` (0, 1 or 2) of a face. */
export function faceCorner(topology: Topology, face: number, corner: number): number {
  return topology.corners[face * 3 + corner];
}

/** The faces meeting at a vertex. */
export function facesAtVertex(topology: Topology, vertex: number): Int32Array {
  return topology.vertexFaces.subarray(topology.vertexFaceStart[vertex], topology.vertexFaceStart[vertex + 1]);
}
