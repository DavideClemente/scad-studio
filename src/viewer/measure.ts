import * as THREE from 'three';
import { basisFor } from './measureFeatures';
import type { Feature } from './measureFeatures';

/**
 * What a pair of picked features measures to.
 *
 * The pairing decides the question: two points ask for a distance, two faces for
 * a distance if they are parallel and an angle if they are not, a point and an
 * edge for the perpendicular between them. Each answer comes with the two places
 * it was taken between, so the viewer can draw the dimension it is quoting.
 */

export type MeasureRow = { label: string; value: string };

export type Measurement = {
  primary: MeasureRow;
  rows: MeasureRow[];
  /** The ends of the dimension line the viewer draws. */
  from: THREE.Vector3;
  to: THREE.Vector3;
};

/** Directions this close to parallel are treated as parallel. */
const PARALLEL_EPSILON = 1e-4;

export function formatLength(value: number): string {
  const magnitude = Math.abs(value);
  const digits = magnitude >= 100 ? 2 : magnitude >= 1 ? 3 : 4;
  return `${value.toFixed(digits)} mm`;
}

export function formatAngle(radians: number): string {
  return `${THREE.MathUtils.radToDeg(radians).toFixed(2)}°`;
}

/**
 * The reference geometry a feature measures as.
 *
 * A circle measures as the ring itself, from wherever on it comes closest to the
 * other feature — so a hole against the side of a plate gives the wall left
 * between them. Its centre is a separate thing to pick, and measures as the
 * point it is.
 */
type Reference =
  | { t: 'point'; p: THREE.Vector3 }
  | { t: 'line'; p: THREE.Vector3; d: THREE.Vector3; a: THREE.Vector3; b: THREE.Vector3 }
  | { t: 'plane'; p: THREE.Vector3; n: THREE.Vector3 }
  | { t: 'ring'; center: THREE.Vector3; axis: THREE.Vector3; radius: number };

type Ring = Extract<Reference, { t: 'ring' }>;

function referenceOf(feature: Feature): Reference {
  switch (feature.kind) {
    case 'point':
      return { t: 'point', p: feature.point };
    case 'edge':
      return {
        t: 'line',
        p: feature.a,
        d: feature.b.clone().sub(feature.a).normalize(),
        a: feature.a,
        b: feature.b,
      };
    case 'circle':
      return { t: 'ring', center: feature.center, axis: feature.axis, radius: feature.radius };
    case 'plane':
      return { t: 'plane', p: feature.point, n: feature.normal };
  }
}

/** The point of a reference that lies closest to some point in space. */
function closestPointOn(reference: Reference, point: THREE.Vector3): THREE.Vector3 {
  switch (reference.t) {
    case 'point':
      return reference.p.clone();
    case 'line': {
      // Along the edge, but no further than its ends. An edge is a finite thing
      // and measuring to where its line would have gone answers a question
      // nobody asked: run it out far enough and it passes near anything.
      const length = reference.a.distanceTo(reference.b);
      const along = THREE.MathUtils.clamp(point.clone().sub(reference.p).dot(reference.d), 0, length);
      return reference.p.clone().addScaledVector(reference.d, along);
    }
    case 'plane':
      return point.clone().addScaledVector(reference.n, -point.clone().sub(reference.p).dot(reference.n));
    case 'ring': {
      // Straight out from the axis, through the point, as far as the radius.
      const offset = point.clone().sub(reference.center);
      const outward = offset.addScaledVector(reference.axis, -offset.dot(reference.axis));
      // On the axis itself every point of the ring is equally close, so any
      // direction across it will do.
      if (outward.lengthSq() < 1e-20) outward.copy(basisFor(reference.axis)[0]);
      return reference.center.clone().addScaledVector(outward.normalize(), reference.radius);
    }
  }
}

/**
 * The point on a ring that comes closest to another reference.
 *
 * Against a point or a plane there is a formula for this; against an edge or a
 * second ring there is not — the condition comes out as a quartic — so the ring
 * is walked at five degrees and the best step narrowed down. Forty rounds of that
 * settle it to far more decimals than are ever shown, and the search only runs
 * when a measurement is taken, never while the pointer is moving.
 */
function nearestOnRingTo(ring: Ring, other: Reference): THREE.Vector3 {
  const [u, v] = basisFor(ring.axis);
  const at = new THREE.Vector3();
  const pointAt = (angle: number) =>
    at
      .copy(ring.center)
      .addScaledVector(u, Math.cos(angle) * ring.radius)
      .addScaledVector(v, Math.sin(angle) * ring.radius);
  const gap = (angle: number) => {
    const point = pointAt(angle);
    return point.distanceTo(closestPointOn(other, point));
  };

  const steps = 72;
  let bestAngle = 0;
  let bestGap = Infinity;
  for (let i = 0; i < steps; i++) {
    const angle = (i / steps) * Math.PI * 2;
    const found = gap(angle);
    if (found < bestGap) {
      bestGap = found;
      bestAngle = angle;
    }
  }

  const step = (Math.PI * 2) / steps;
  let low = bestAngle - step;
  let high = bestAngle + step;
  for (let i = 0; i < 40; i++) {
    const third = (high - low) / 3;
    if (gap(low + third) < gap(high - third)) high -= third;
    else low += third;
  }
  return pointAt((low + high) / 2).clone();
}

/** Between a ring and anything: the shortest way from the circle to the other. */
function ringMeasurement(a: Reference, b: Reference): Measurement {
  const ring = (a.t === 'ring' ? a : b) as Ring;
  const other = a.t === 'ring' ? b : a;

  const onRing = nearestOnRingTo(ring, other);
  const onOther = closestPointOn(other, onRing);

  // The number the other pick would have given, which is worth having beside it
  // rather than making anyone measure twice to compare.
  const rows: MeasureRow[] =
    other.t === 'ring'
      ? [{ label: 'Between centres', value: formatLength(ring.center.distanceTo(other.center)) }]
      : [
          {
            label: 'From the centre',
            value: formatLength(ring.center.distanceTo(closestPointOn(other, ring.center))),
          },
        ];

  const label =
    other.t === 'ring'
      ? 'Between circles'
      : other.t === 'plane'
        ? 'Distance to face'
        : other.t === 'line'
          ? 'Distance to edge'
          : 'Distance';

  const measurement: Measurement = {
    primary: { label, value: formatLength(onRing.distanceTo(onOther)) },
    rows,
    from: onRing,
    to: onOther,
  };
  return a.t === 'ring' ? measurement : flip(measurement);
}

/** A short name for a feature, and the numbers that belong to it on its own. */
export function describeFeature(feature: Feature, origin = new THREE.Vector3()): { name: string; rows: MeasureRow[] } {
  switch (feature.kind) {
    case 'point': {
      const p = feature.point.clone().add(origin);
      const rows: MeasureRow[] = [
        { label: 'X', value: formatLength(p.x) },
        { label: 'Y', value: formatLength(p.y) },
        { label: 'Z', value: formatLength(p.z) },
      ];
      if (feature.circle) {
        rows.unshift({ label: 'Diameter', value: formatLength(feature.circle.radius * 2) });
      }
      return { name: feature.circle ? 'Centre' : 'Point', rows };
    }
    case 'edge':
      return {
        name: 'Edge',
        rows: [{ label: 'Length', value: formatLength(feature.a.distanceTo(feature.b)) }],
      };
    case 'circle': {
      const rows: MeasureRow[] = [
        { label: 'Diameter', value: formatLength(feature.radius * 2) },
        { label: 'Radius', value: formatLength(feature.radius) },
      ];
      // How many straight segments stand in for the curve: the honest caveat on
      // calling a polygon a circle, and a direct read of the design's $fn.
      if (feature.segments) rows.push({ label: 'Segments', value: String(feature.segments) });
      return { name: feature.from === 'cylinder' ? 'Cylinder' : 'Circle', rows };
    }
    case 'plane': {
      const rows: MeasureRow[] = [{ label: 'Area', value: `${feature.area.toFixed(2)} mm²` }];
      if (feature.circle) {
        rows.unshift({ label: 'Diameter', value: formatLength(feature.circle.radius * 2) });
      }
      return { name: feature.circle ? 'Round face' : 'Face', rows };
    }
  }
}

/** The one-line label the viewer shows beside a pick. */
export function summarizeFeature(feature: Feature): string {
  switch (feature.kind) {
    case 'point':
      return feature.circle ? `Centre ⌀${formatLength(feature.circle.radius * 2)}` : 'Point';
    case 'edge':
      return `Edge ${formatLength(feature.a.distanceTo(feature.b))}`;
    case 'circle':
      return `${feature.from === 'cylinder' ? 'Cylinder' : 'Circle'} ⌀${formatLength(feature.radius * 2)}`;
    case 'plane':
      return feature.circle ? `Round face ⌀${formatLength(feature.circle.radius * 2)}` : 'Face';
  }
}

function pointToPoint(a: THREE.Vector3, b: THREE.Vector3): Measurement {
  const delta = b.clone().sub(a);
  return {
    primary: { label: 'Distance', value: formatLength(delta.length()) },
    rows: [
      { label: 'ΔX', value: formatLength(delta.x) },
      { label: 'ΔY', value: formatLength(delta.y) },
      { label: 'ΔZ', value: formatLength(delta.z) },
    ],
    from: a.clone(),
    to: b.clone(),
  };
}

function pointToLine(point: THREE.Vector3, line: Extract<Reference, { t: 'line' }>): Measurement {
  const foot = closestPointOn(line, point);
  return {
    primary: { label: 'Distance to edge', value: formatLength(point.distanceTo(foot)) },
    rows: [],
    from: point.clone(),
    to: foot,
  };
}

/**
 * The closest pair of points on two segments, ends included.
 *
 * The perpendicular between two lines can easily fall off the end of both of
 * them, and then the shortest way from one edge to the other runs from a corner.
 */
function closestBetweenSegments(
  a: Extract<Reference, { t: 'line' }>,
  b: Extract<Reference, { t: 'line' }>,
): [THREE.Vector3, THREE.Vector3] {
  const d1 = a.b.clone().sub(a.a);
  const d2 = b.b.clone().sub(b.a);
  const r = a.a.clone().sub(b.a);
  const squared1 = d1.dot(d1);
  const squared2 = d2.dot(d2);
  const f = d2.dot(r);

  let s = 0;
  let t = 0;
  if (squared1 < 1e-12 && squared2 < 1e-12) {
    // Both edges are points.
  } else if (squared1 < 1e-12) {
    t = THREE.MathUtils.clamp(f / squared2, 0, 1);
  } else {
    const c = d1.dot(r);
    if (squared2 < 1e-12) {
      s = THREE.MathUtils.clamp(-c / squared1, 0, 1);
    } else {
      const between = d1.dot(d2);
      const denominator = squared1 * squared2 - between * between;
      s = denominator > 1e-12 ? THREE.MathUtils.clamp((between * f - c * squared2) / denominator, 0, 1) : 0;
      t = (between * s + f) / squared2;
      if (t < 0) {
        t = 0;
        s = THREE.MathUtils.clamp(-c / squared1, 0, 1);
      } else if (t > 1) {
        t = 1;
        s = THREE.MathUtils.clamp((between - c) / squared1, 0, 1);
      }
    }
  }
  return [a.a.clone().addScaledVector(d1, s), b.a.clone().addScaledVector(d2, t)];
}

function pointToPlane(point: THREE.Vector3, plane: Extract<Reference, { t: 'plane' }>): Measurement {
  const signed = point.clone().sub(plane.p).dot(plane.n);
  return {
    primary: { label: 'Distance to face', value: formatLength(Math.abs(signed)) },
    rows: [],
    from: point.clone(),
    to: point.clone().addScaledVector(plane.n, -signed),
  };
}

function lineToLine(a: Extract<Reference, { t: 'line' }>, b: Extract<Reference, { t: 'line' }>): Measurement {
  const cross = new THREE.Vector3().crossVectors(a.d, b.d);
  const angle = Math.acos(THREE.MathUtils.clamp(Math.abs(a.d.dot(b.d)), -1, 1));
  const [footA, footB] = closestBetweenSegments(a, b);
  const gap = footA.distanceTo(footB);

  if (cross.lengthSq() < PARALLEL_EPSILON) {
    return {
      primary: { label: 'Distance between edges', value: formatLength(gap) },
      rows: [],
      from: footA,
      to: footB,
    };
  }

  return {
    primary: { label: 'Angle between edges', value: formatAngle(angle) },
    rows: [{ label: gap < 1e-6 ? 'Crossing' : 'Closest approach', value: formatLength(gap) }],
    from: footA,
    to: footB,
  };
}

function lineToPlane(line: Extract<Reference, { t: 'line' }>, plane: Extract<Reference, { t: 'plane' }>): Measurement {
  const alignment = line.d.dot(plane.n);
  if (Math.abs(alignment) < PARALLEL_EPSILON) {
    const measurement = pointToPlane(line.a, plane);
    return { ...measurement, primary: { label: 'Distance to face', value: measurement.primary.value } };
  }
  const angle = Math.asin(THREE.MathUtils.clamp(Math.abs(alignment), -1, 1));
  const midpoint = line.a.clone().add(line.b).multiplyScalar(0.5);
  const signed = midpoint.clone().sub(plane.p).dot(plane.n);
  return {
    primary: { label: 'Angle to face', value: formatAngle(angle) },
    rows: [],
    from: midpoint,
    to: midpoint.clone().addScaledVector(plane.n, -signed),
  };
}

function planeToPlane(a: Extract<Reference, { t: 'plane' }>, b: Extract<Reference, { t: 'plane' }>): Measurement {
  const alignment = THREE.MathUtils.clamp(a.n.dot(b.n), -1, 1);
  if (1 - Math.abs(alignment) < PARALLEL_EPSILON) {
    const measurement = pointToPlane(a.p, b);
    return { ...measurement, primary: { label: 'Distance between faces', value: measurement.primary.value } };
  }
  // The angle between two planes is the angle between their normals, read as the
  // acute one: which side a normal points is an artefact of which face was
  // clicked, not something the shape says.
  return {
    primary: { label: 'Angle between faces', value: formatAngle(Math.acos(Math.abs(alignment))) },
    rows: [],
    from: a.p.clone(),
    to: b.p.clone(),
  };
}

/** Measures between two picked features. */
export function measure(featureA: Feature, featureB: Feature): Measurement {
  const a = referenceOf(featureA);
  const b = referenceOf(featureB);

  if (a.t === 'ring' || b.t === 'ring') return ringMeasurement(a, b);
  if (a.t === 'point' && b.t === 'point') return pointToPoint(a.p, b.p);
  if (a.t === 'point' && b.t === 'line') return pointToLine(a.p, b);
  if (a.t === 'line' && b.t === 'point') return flip(pointToLine(b.p, a));
  if (a.t === 'point' && b.t === 'plane') return pointToPlane(a.p, b);
  if (a.t === 'plane' && b.t === 'point') return flip(pointToPlane(b.p, a));
  if (a.t === 'line' && b.t === 'line') return lineToLine(a, b);
  if (a.t === 'line' && b.t === 'plane') return lineToPlane(a, b);
  if (a.t === 'plane' && b.t === 'line') return flip(lineToPlane(b, a));
  return planeToPlane(a as Extract<Reference, { t: 'plane' }>, b as Extract<Reference, { t: 'plane' }>);
}

/** Keeps the drawn dimension running from the first pick to the second. */
function flip(measurement: Measurement): Measurement {
  return { ...measurement, from: measurement.to, to: measurement.from };
}
