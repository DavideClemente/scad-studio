import * as THREE from 'three';
import { facesAtVertex, faceCorner, faceNormal, vertexPosition } from './meshTopology';
import type { Topology } from './meshTopology';

/**
 * Turning a click on a triangle mesh into the thing the designer drew.
 *
 * A rendered model remembers none of the design that produced it: a cylinder
 * arrives as a fan of flat strips, a hole as a ring of corners. Every feature
 * here is inferred back out of that — an edge from the crease between two
 * triangles, a circle from a ring of corners that all sit the same distance from
 * a common centre, a face from triangles that share a plane.
 */

/** Two faces meeting at a sharper angle than this have a real edge between them. */
const SHARP_ANGLE = THREE.MathUtils.degToRad(18);
/**
 * How sharply the shape must turn at a vertex for it to be a corner someone
 * could mean. Below this it is a point part-way along something — a curve drawn
 * in straight pieces, or an edge that happened to be split — and picking it says
 * nothing the edge or circle it belongs to does not say better.
 */
const CORNER_TURN = THREE.MathUtils.degToRad(40);
/** Triangles within this angle of each other are treated as one flat face. */
const COPLANAR_ANGLE = THREE.MathUtils.degToRad(0.5);
/** How far a curved surface may bend between neighbours and still be one surface. */
const SMOOTH_ANGLE = THREE.MathUtils.degToRad(40);
/** Corners closer to a fitted circle than this fraction of its radius accept it. */
const CIRCLE_TOLERANCE = 0.01;
/**
 * The fewest corners a ring may have and still be read as a circle. OpenSCAD
 * never draws a circle with fewer than five segments, so this does let a genuine
 * octagon be called a circle — which is why a circle's segment count is reported
 * alongside its radius rather than hidden.
 */
const CIRCLE_MIN_POINTS = 8;
/** A guard against following a fill across an entire large model. */
const MAX_REGION_FACES = 50000;

export type Circle = {
  center: THREE.Vector3;
  radius: number;
  /** Unit normal of the circle's plane, which is a cylinder's axis. */
  axis: THREE.Vector3;
  /** Corners the circle was fitted through, when it came from a ring of them. */
  segments?: number;
};

export type Feature =
  | { kind: 'point'; point: THREE.Vector3 }
  | { kind: 'edge'; a: THREE.Vector3; b: THREE.Vector3 }
  | ({ kind: 'circle'; from: 'rim' | 'cylinder'; faces?: number[] } & Circle)
  | {
      kind: 'plane';
      point: THREE.Vector3;
      normal: THREE.Vector3;
      area: number;
      faces: number[];
      /** The ring nearest the point picked, when the face has any. */
      circle?: Circle;
      /** Every ring bounding the face — a plate with holes has several. */
      rings?: Circle[];
    };

export type SnapContext = {
  topology: Topology;
  /** Screen position of a point given in the geometry's own space. */
  project: (point: THREE.Vector3) => THREE.Vector2 | null;
  /**
   * Where the model is being looked at from, in that same space. What can be
   * picked is what can be seen: an edge on the far side of the solid lands close
   * to the pointer on screen just as easily as the one in front of it, and
   * offering it would let the pointer reach through the part.
   */
  viewPoint: THREE.Vector3;
  /** Where the pointer is, in that same screen space. */
  pointer: THREE.Vector2;
  /** How near the pointer must come to a corner, in screen units, to land on it. */
  vertexTolerance: number;
  /** The same, for an edge. Looser than a corner so corners win where they meet. */
  edgeTolerance: number;
  /**
   * Whether a point on the model can actually be seen from where it is being
   * looked at, rather than sitting behind some other part of it.
   *
   * Which way a triangle faces is not enough on its own: the far base of a boss
   * standing on a plate belongs to the plate's top, which faces the viewer
   * squarely, while the boss sits in front of it hiding the thing completely.
   * Answering this properly means asking the model, so it is asked only about the
   * candidate about to be chosen — never about all of them.
   */
  isVisible?: (point: THREE.Vector3) => boolean;
  /**
   * Surfaces already worked out, keyed by every face belonging to one. Growing a
   * region and fitting it is the expensive half of a pick, and hovering moves
   * across the same face hundreds of times; the caller owns the map so that a new
   * model starts with an empty one.
   */
  surfaceCache?: Map<number, Feature>;
};

// Scratch vectors. Snapping runs on every pointer move, so nothing in this file
// allocates per candidate.
const vA = new THREE.Vector3();
const vB = new THREE.Vector3();
const vC = new THREE.Vector3();
const vD = new THREE.Vector3();
const vE = new THREE.Vector3();
const nA = new THREE.Vector3();
const nB = new THREE.Vector3();
const p2A = new THREE.Vector2();
const p2B = new THREE.Vector2();

/** Whether the edge leaving corner `corner` of `face` is a crease or a border. */
function isSharp(topology: Topology, face: number, corner: number): boolean {
  const other = topology.neighbors[face * 3 + corner];
  if (other === -1) return true;
  faceNormal(topology, face, nA);
  faceNormal(topology, other, nB);
  return nA.dot(nB) < Math.cos(SHARP_ANGLE);
}

/** The far ends of every sharp edge meeting at a vertex. */
function sharpNeighborsOf(topology: Topology, vertex: number): number[] {
  const out: number[] = [];
  const seen = new Set<number>();
  for (const face of facesAtVertex(topology, vertex)) {
    for (let c = 0; c < 3; c++) {
      const v0 = faceCorner(topology, face, c);
      const v1 = faceCorner(topology, face, (c + 1) % 3);
      if (v0 !== vertex && v1 !== vertex) continue;
      const other = v0 === vertex ? v1 : v0;
      if (seen.has(other)) continue;
      seen.add(other);
      // The edge is the one leaving corner c whichever of its two ends matched,
      // and either of its faces answers the same, so this face will do.
      if (isSharp(topology, face, c)) out.push(other);
    }
  }
  return out;
}

/**
 * Squared distance from a point to a segment in screen space, along with how far
 * along the segment the nearest point lies — which is the part of the edge the
 * pointer is actually aiming at, and so the part whose visibility decides
 * whether the edge can be picked at all.
 */
function distanceToSegmentSq(p: THREE.Vector2, a: THREE.Vector2, b: THREE.Vector2): { distanceSq: number; t: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  let t = 0;
  if (lengthSq > 0) t = THREE.MathUtils.clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq, 0, 1);
  const cx = a.x + dx * t - p.x;
  const cy = a.y + dy * t - p.y;
  return { distanceSq: cx * cx + cy * cy, t };
}

/**
 * Solves a symmetric 3x3 system by Cramer's rule, returning null when the rows
 * are too close to dependent for the answer to mean anything.
 */
function solve3(m: number[], rhs: number[]): [number, number, number] | null {
  const det =
    m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
  if (Math.abs(det) < 1e-12) return null;
  const col = (i: number, v: number[]) => {
    const c = m.slice();
    c[i] = v[0];
    c[i + 3] = v[1];
    c[i + 6] = v[2];
    return c;
  };
  const detOf = (c: number[]) =>
    c[0] * (c[4] * c[8] - c[5] * c[7]) - c[1] * (c[3] * c[8] - c[5] * c[6]) + c[2] * (c[3] * c[7] - c[4] * c[6]);
  return [detOf(col(0, rhs)) / det, detOf(col(1, rhs)) / det, detOf(col(2, rhs)) / det];
}

/** A pair of unit vectors spanning the plane perpendicular to `axis`. */
function basisFor(axis: THREE.Vector3): [THREE.Vector3, THREE.Vector3] {
  const u = new THREE.Vector3(1, 0, 0);
  if (Math.abs(axis.x) > 0.9) u.set(0, 1, 0);
  u.crossVectors(axis, u).normalize();
  const v = new THREE.Vector3().crossVectors(axis, u).normalize();
  return [u, v];
}

/**
 * Fits a circle through points that lie on one, in the plane given by `axis`.
 *
 * Kåsa's algebraic fit: writing the circle as x² + y² + Ax + By + C = 0 makes it
 * linear in A, B and C, so one small least-squares solve places it. The points a
 * mesh offers are already very nearly exact, which is what makes an algebraic fit
 * rather than a geometric one enough here.
 */
export function fitCircle(points: THREE.Vector3[], axis: THREE.Vector3): (Circle & { rms: number }) | null {
  if (points.length < 3) return null;
  const normal = axis.clone().normalize();
  if (normal.lengthSq() < 0.5) return null;
  const [u, v] = basisFor(normal);

  const centroid = new THREE.Vector3();
  for (const point of points) centroid.add(point);
  centroid.divideScalar(points.length);

  let sxx = 0, sxy = 0, syy = 0, sx = 0, sy = 0, sxz = 0, syz = 0, sz = 0;
  const xs = new Float64Array(points.length);
  const ys = new Float64Array(points.length);
  for (let i = 0; i < points.length; i++) {
    vA.copy(points[i]).sub(centroid);
    const x = vA.dot(u);
    const y = vA.dot(v);
    const z = x * x + y * y;
    xs[i] = x;
    ys[i] = y;
    sxx += x * x;
    sxy += x * y;
    syy += y * y;
    sx += x;
    sy += y;
    sxz += x * z;
    syz += y * z;
    sz += z;
  }
  const n = points.length;
  const solution = solve3([sxx, sxy, sx, sxy, syy, sy, sx, sy, n], [-sxz, -syz, -sz]);
  if (!solution) return null;
  const [a, b, c] = solution;
  const cx = -a / 2;
  const cy = -b / 2;
  const inside = cx * cx + cy * cy - c;
  if (!(inside > 0)) return null;
  const radius = Math.sqrt(inside);

  let squared = 0;
  for (let i = 0; i < n; i++) {
    const error = Math.hypot(xs[i] - cx, ys[i] - cy) - radius;
    squared += error * error;
  }

  const center = centroid.clone().addScaledVector(u, cx).addScaledVector(v, cy);
  return { center, radius, axis: normal, rms: Math.sqrt(squared / n) };
}

/** Newell's normal: the plane a closed ring of points lies in, if it lies in one. */
function loopNormal(points: THREE.Vector3[]): THREE.Vector3 {
  const normal = new THREE.Vector3();
  for (let i = 0; i < points.length; i++) {
    const current = points[i];
    const next = points[(i + 1) % points.length];
    normal.x += (current.y - next.y) * (current.z + next.z);
    normal.y += (current.z - next.z) * (current.x + next.x);
    normal.z += (current.x - next.x) * (current.y + next.y);
  }
  return normal.normalize();
}

/** A ring of points, read as a circle only if every one of them sits on it. */
export function circleFromLoop(points: THREE.Vector3[]): Circle | null {
  if (points.length < CIRCLE_MIN_POINTS) return null;
  const normal = loopNormal(points);
  if (normal.lengthSq() < 0.5) return null;
  const fit = fitCircle(points, normal);
  if (!fit || fit.radius <= 0) return null;
  if (fit.rms > CIRCLE_TOLERANCE * fit.radius) return null;
  return { center: fit.center, radius: fit.radius, axis: fit.axis, segments: points.length };
}

/** Follows sharp edges from one edge until the trail closes, forks or runs out. */
function walkSharpChain(topology: Topology, from: number, to: number): { vertices: number[]; closed: boolean } {
  const vertices = [from, to];
  let previous = from;
  let current = to;
  for (let step = 0; step < 4096; step++) {
    const options = sharpNeighborsOf(topology, current).filter((v) => v !== previous);
    // A fork has no single continuation, so the trail ends rather than guessing.
    if (options.length !== 1) break;
    const next = options[0];
    if (next === from) return { vertices, closed: true };
    vertices.push(next);
    previous = current;
    current = next;
  }
  return { vertices, closed: false };
}

/** Extends an edge through corners that carry straight on, in both directions. */
function extendStraight(topology: Topology, from: number, to: number): [number, number] {
  const direction = vertexPosition(topology, to, new THREE.Vector3()).sub(vertexPosition(topology, from, vA)).normalize();

  const run = (start: number, previous: number, forward: boolean): number => {
    let current = start;
    let last = previous;
    for (let step = 0; step < 4096; step++) {
      let found = -1;
      for (const candidate of sharpNeighborsOf(topology, current)) {
        if (candidate === last) continue;
        vertexPosition(topology, candidate, vC).sub(vertexPosition(topology, current, vD)).normalize();
        const aligned = forward ? vC.dot(direction) : -vC.dot(direction);
        if (aligned > 0.9999) {
          found = candidate;
          break;
        }
      }
      if (found === -1) return current;
      last = current;
      current = found;
    }
    return current;
  };

  return [run(from, to, false), run(to, from, true)];
}

/** Grows a set of faces outward from a seed while `accept` keeps saying yes. */
function growRegion(topology: Topology, seed: number, accept: (face: number) => boolean): number[] {
  const region = [seed];
  const visited = new Set<number>([seed]);
  for (let i = 0; i < region.length && region.length < MAX_REGION_FACES; i++) {
    const face = region[i];
    for (let c = 0; c < 3; c++) {
      const next = topology.neighbors[face * 3 + c];
      if (next === -1 || visited.has(next)) continue;
      visited.add(next);
      if (accept(next)) region.push(next);
    }
  }
  return region;
}

/** The triangles sharing a plane with the seed triangle. */
function planarRegion(topology: Topology, seed: number): number[] {
  const seedNormal = faceNormal(topology, seed, new THREE.Vector3());
  const limit = Math.cos(COPLANAR_ANGLE);
  return growRegion(topology, seed, (face) => faceNormal(topology, face, nA).dot(seedNormal) > limit);
}

/** The triangles reachable from the seed without crossing a crease. */
function smoothRegion(topology: Topology, seed: number): number[] {
  const seedNormal = faceNormal(topology, seed, new THREE.Vector3());
  const limit = Math.cos(SMOOTH_ANGLE);
  // Compared against the seed rather than against the neighbour each face was
  // reached from: walking neighbour to neighbour lets a slow bend wander all the
  // way around a sphere and call the whole thing one surface.
  return growRegion(topology, seed, (face) => faceNormal(topology, face, nA).dot(seedNormal) > limit);
}

/** Edges of a region with nothing on the far side, chained into closed rings. */
function boundaryLoops(topology: Topology, region: number[]): number[][] {
  const inRegion = new Set(region);
  const next = new Map<number, number>();
  for (const face of region) {
    for (let c = 0; c < 3; c++) {
      const neighbor = topology.neighbors[face * 3 + c];
      if (neighbor !== -1 && inRegion.has(neighbor)) continue;
      const from = faceCorner(topology, face, c);
      const to = faceCorner(topology, face, (c + 1) % 3);
      // Consistent winding across the region means each boundary vertex starts
      // exactly one boundary edge, except where a region pinches to a point —
      // there the first one found stands and the rest are dropped.
      if (!next.has(from)) next.set(from, to);
    }
  }

  const loops: number[][] = [];
  const used = new Set<number>();
  for (const start of next.keys()) {
    if (used.has(start)) continue;
    const loop: number[] = [];
    let current = start;
    while (!used.has(current)) {
      used.add(current);
      loop.push(current);
      const following = next.get(current);
      if (following === undefined) break;
      current = following;
    }
    if (current === start && loop.length >= 3) loops.push(loop);
  }
  return loops;
}

function regionArea(topology: Topology, region: number[]): number {
  let area = 0;
  for (const face of region) {
    vertexPosition(topology, faceCorner(topology, face, 0), vA);
    vertexPosition(topology, faceCorner(topology, face, 1), vB).sub(vA);
    vertexPosition(topology, faceCorner(topology, face, 2), vC).sub(vA);
    area += vB.cross(vC).length() / 2;
  }
  return area;
}

/**
 * Reads a curved region as a cylinder, if it is one.
 *
 * Every normal on a cylinder is perpendicular to its axis, so two normals far
 * enough apart cross to give the axis directly — no eigenvalue solve needed. The
 * fit only stands if the rest of the normals agree with that axis and the corners
 * projected along it land on one circle.
 */
function cylinderFromRegion(topology: Topology, region: number[]): Circle | null {
  if (region.length < CIRCLE_MIN_POINTS) return null;

  const seedNormal = faceNormal(topology, region[0], new THREE.Vector3());
  let axis: THREE.Vector3 | null = null;
  let widest = 0;
  for (const face of region) {
    faceNormal(topology, face, nA);
    const cross = vA.crossVectors(seedNormal, nA).length();
    if (cross > widest) {
      widest = cross;
      axis = vA.clone();
    }
  }
  // Normals that all point much the same way describe a flat face, and give no
  // reliable axis to cross out of them.
  if (!axis || widest < 0.2) return null;
  axis.normalize();

  for (const face of region) {
    if (Math.abs(faceNormal(topology, face, nA).dot(axis)) > 0.06) return null;
  }

  const vertices = new Set<number>();
  for (const face of region) {
    for (let c = 0; c < 3; c++) vertices.add(faceCorner(topology, face, c));
  }
  const points: THREE.Vector3[] = [];
  for (const vertex of vertices) points.push(vertexPosition(topology, vertex, new THREE.Vector3()));

  const fit = fitCircle(points, axis);
  if (!fit || fit.radius <= 0 || fit.rms > CIRCLE_TOLERANCE * fit.radius) return null;
  return { center: fit.center, radius: fit.radius, axis: fit.axis };
}

/**
 * Whether a vertex is a corner of the shape, rather than a point part-way along
 * a curve or a spare vertex the triangulation left in the middle of a face.
 */
function isCorner(topology: Topology, vertex: number): boolean {
  const sharp = sharpNeighborsOf(topology, vertex);
  if (sharp.length > 2) return true;
  if (sharp.length < 2) return false;
  vertexPosition(topology, vertex, vD);
  vertexPosition(topology, sharp[0], vA).sub(vD).normalize();
  vertexPosition(topology, sharp[1], vB).sub(vD).normalize();
  // The two edges lead away from the vertex, so an edge carrying straight on
  // through it leaves them pointing opposite ways.
  return vA.dot(vB) > -Math.cos(CORNER_TURN);
}

/**
 * Every face touching the one under the pointer, corners included.
 *
 * Not just the three across its edges: which triangle a ray lands on near a
 * corner is a detail of how the surface happened to be cut up, and a corner two
 * triangles away is still the corner the pointer is plainly next to.
 */
function nearbyFaces(ctx: SnapContext, face: number): Set<number> {
  const { topology } = ctx;
  // The face under the pointer is visible by definition — the ray reached it.
  const faces = new Set<number>([face]);
  for (let c = 0; c < 3; c++) {
    for (const neighbor of facesAtVertex(topology, faceCorner(topology, face, c))) {
      if (facesViewer(ctx, neighbor)) faces.add(neighbor);
    }
  }
  return faces;
}

/** Whether a triangle has its front towards the viewer. */
function facesViewer(ctx: SnapContext, face: number): boolean {
  vertexPosition(ctx.topology, faceCorner(ctx.topology, face, 0), vE);
  vE.subVectors(ctx.viewPoint, vE);
  return faceNormal(ctx.topology, face, nA).dot(vE) > 0;
}

/** The corner nearest the pointer among the faces around it, if one is near. */
function snapVertex(ctx: SnapContext, face: number): THREE.Vector3 | null {
  const { topology } = ctx;
  const candidates = new Set<number>();
  for (const f of nearbyFaces(ctx, face)) {
    for (let c = 0; c < 3; c++) candidates.add(faceCorner(topology, f, c));
  }

  const near: { vertex: number; distance: number }[] = [];
  const tolerance = ctx.vertexTolerance * ctx.vertexTolerance;
  for (const vertex of candidates) {
    const screen = ctx.project(vertexPosition(topology, vertex, vA));
    if (!screen) continue;
    const distance = screen.distanceToSquared(ctx.pointer);
    if (distance < tolerance) near.push({ vertex, distance });
  }

  // Nearest first, so the cost of deciding what counts as a corner, and of
  // asking whether it can be seen, is paid only until one is found.
  near.sort((a, b) => a.distance - b.distance);
  for (const { vertex } of near) {
    if (!isCorner(topology, vertex)) continue;
    vertexPosition(topology, vertex, vA);
    if (ctx.isVisible && !ctx.isVisible(vA)) continue;
    return vA.clone();
  }
  return null;
}

/** The sharp edge nearest the pointer among the faces around it, if one is near. */
function snapEdge(ctx: SnapContext, face: number): Feature | null {
  const { topology } = ctx;

  const near: { from: number; to: number; distance: number; t: number }[] = [];
  const tolerance = ctx.edgeTolerance * ctx.edgeTolerance;
  const seen = new Set<string>();
  for (const f of nearbyFaces(ctx, face)) {
    for (let c = 0; c < 3; c++) {
      if (!isSharp(topology, f, c)) continue;
      const from = faceCorner(topology, f, c);
      const to = faceCorner(topology, f, (c + 1) % 3);
      const key = from < to ? `${from}_${to}` : `${to}_${from}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const a = ctx.project(vertexPosition(topology, from, vA));
      if (!a) continue;
      p2A.copy(a);
      const b = ctx.project(vertexPosition(topology, to, vB));
      if (!b) continue;
      p2B.copy(b);
      const { distanceSq, t } = distanceToSegmentSq(ctx.pointer, p2A, p2B);
      if (distanceSq < tolerance) near.push({ from, to, distance: distanceSq, t });
    }
  }

  near.sort((a, b) => a.distance - b.distance);
  let bestFrom = -1;
  let bestTo = -1;
  for (const candidate of near) {
    if (ctx.isVisible) {
      // The stretch of the edge the pointer is over, which is what has to be in
      // view — an edge can perfectly well have one end showing and the rest of it
      // buried behind something.
      vertexPosition(topology, candidate.from, vA);
      vertexPosition(topology, candidate.to, vB).sub(vA);
      if (!ctx.isVisible(vA.addScaledVector(vB, candidate.t))) continue;
    }
    bestFrom = candidate.from;
    bestTo = candidate.to;
    break;
  }
  if (bestFrom === -1) return null;

  // A ring of sharp edges that closes on itself is the outline of a hole or the
  // rim of a boss, and is far more useful reported as a circle than as the one
  // short segment the pointer happened to be over.
  const chain = walkSharpChain(topology, bestFrom, bestTo);
  if (chain.closed) {
    const points = chain.vertices.map((vertex) => vertexPosition(topology, vertex, new THREE.Vector3()));
    const circle = circleFromLoop(points);
    if (circle) return { kind: 'circle', from: 'rim', ...circle };
  }

  const [from, to] = extendStraight(topology, bestFrom, bestTo);
  return {
    kind: 'edge',
    a: vertexPosition(topology, from, new THREE.Vector3()),
    b: vertexPosition(topology, to, new THREE.Vector3()),
  };
}

/** The surface the pointer is over: a cylinder if it is one, otherwise a face. */
function snapSurface(ctx: SnapContext, face: number, hit: THREE.Vector3): Feature {
  const { topology } = ctx;

  const cached = ctx.surfaceCache?.get(face);
  if (cached) return placeOnSurface(cached, hit);

  const smooth = smoothRegion(topology, face);
  const cylinder = cylinderFromRegion(topology, smooth);
  if (cylinder) {
    const found: Feature = {
      kind: 'circle',
      from: 'cylinder',
      center: cylinder.center,
      radius: cylinder.radius,
      axis: cylinder.axis,
      faces: smooth,
    };
    return remember(ctx, smooth, found, hit);
  }

  const region = planarRegion(topology, face);
  const normal = faceNormal(topology, face, new THREE.Vector3());

  // A round face is still a face — it measures plane to plane — but its radius is
  // the number most likely being looked for, so every ring around it is fitted
  // and carried along. Which one answers is settled per click, not here: on a
  // plate with two holes the ring meant is the one under the pointer.
  const rings: Circle[] = [];
  for (const loop of boundaryLoops(topology, region)) {
    const points = loop.map((vertex) => vertexPosition(topology, vertex, new THREE.Vector3()));
    const fitted = circleFromLoop(points);
    if (fitted) rings.push(fitted);
  }

  const found: Feature = {
    kind: 'plane',
    point: hit.clone(),
    normal,
    area: regionArea(topology, region),
    faces: region,
    rings,
  };
  return remember(ctx, region, found, hit);
}

/** How far a point is from a ring itself, rather than from the disc it bounds. */
function distanceToRing(ring: Circle, point: THREE.Vector3): number {
  vB.copy(point).sub(ring.center);
  const along = vB.dot(ring.axis);
  const radial = vC.copy(vB).addScaledVector(ring.axis, -along).length();
  return Math.hypot(radial - ring.radius, along);
}

/**
 * Files a surface under every face that makes it up, so the next pointer move
 * anywhere on it is a lookup, and hands back the copy that belongs to this hit.
 */
function remember(ctx: SnapContext, region: number[], feature: Feature, hit: THREE.Vector3): Feature {
  if (ctx.surfaceCache) {
    for (const face of region) ctx.surfaceCache.set(face, feature);
  }
  return placeOnSurface(feature, hit);
}

/**
 * A surface is the same wherever it is clicked, but where on it the click landed
 * still matters: it is the end of the dimension line drawn for a face, which of
 * the face's rings is being asked about, and the height a cylinder's circle sits
 * at.
 */
function placeOnSurface(feature: Feature, hit: THREE.Vector3): Feature {
  if (feature.kind === 'plane') {
    let circle: Circle | undefined;
    let nearest = Infinity;
    for (const ring of feature.rings ?? []) {
      const distance = distanceToRing(ring, hit);
      if (distance < nearest) {
        nearest = distance;
        circle = ring;
      }
    }
    return { ...feature, point: hit.clone(), circle };
  }
  if (feature.kind === 'circle' && feature.from === 'cylinder') {
    const center = feature.center
      .clone()
      .addScaledVector(feature.axis, vA.copy(hit).sub(feature.center).dot(feature.axis));
    return { ...feature, center };
  }
  return feature;
}

/**
 * What the pointer is on: the nearest corner, else the nearest edge, else the
 * surface itself. Corners beat edges beat surfaces because that is the order of
 * how precisely each one names a place, and the pointer can only be near a corner
 * by being near its edges and face too.
 */
export function snapFeature(ctx: SnapContext, face: number, hit: THREE.Vector3): Feature {
  const vertex = snapVertex(ctx, face);
  if (vertex) return { kind: 'point', point: vertex };

  const edge = snapEdge(ctx, face);
  if (edge) return edge;

  return snapSurface(ctx, face, hit);
}
