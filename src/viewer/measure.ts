import * as THREE from 'three';
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
 * The reference geometry a feature measures as. A circle measures from its
 * centre, which is what makes hole-to-hole spacing a single pick each.
 */
type Reference =
  | { t: 'point'; p: THREE.Vector3 }
  | { t: 'line'; p: THREE.Vector3; d: THREE.Vector3; a: THREE.Vector3; b: THREE.Vector3 }
  | { t: 'plane'; p: THREE.Vector3; n: THREE.Vector3 };

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
      return { t: 'point', p: feature.center };
    case 'plane':
      return { t: 'plane', p: feature.point, n: feature.normal };
  }
}

/** A short name for a feature, and the numbers that belong to it on its own. */
export function describeFeature(feature: Feature, origin = new THREE.Vector3()): { name: string; rows: MeasureRow[] } {
  switch (feature.kind) {
    case 'point': {
      const p = feature.point.clone().add(origin);
      return {
        name: 'Point',
        rows: [
          { label: 'X', value: formatLength(p.x) },
          { label: 'Y', value: formatLength(p.y) },
          { label: 'Z', value: formatLength(p.z) },
        ],
      };
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
      return 'Point';
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
  const offset = point.clone().sub(line.p);
  const along = offset.dot(line.d);
  const foot = line.p.clone().addScaledVector(line.d, along);

  const rows: MeasureRow[] = [];
  // The perpendicular can land past the end of a finite edge. The number quoted
  // is still the distance to the edge's line — that is what a perpendicular
  // measurement means — but the shorter, physical distance is worth saying too.
  const length = line.a.distanceTo(line.b);
  if (along < 0 || along > length) {
    const nearest = along < 0 ? line.a : line.b;
    rows.push({ label: 'To nearest end', value: formatLength(point.distanceTo(nearest)) });
  }

  return {
    primary: { label: 'Distance to edge', value: formatLength(point.distanceTo(foot)) },
    rows,
    from: point.clone(),
    to: foot,
  };
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

  if (cross.lengthSq() < PARALLEL_EPSILON) {
    const measurement = pointToLine(a.a, b);
    return { ...measurement, primary: { label: 'Distance between edges', value: measurement.primary.value } };
  }

  // Skew or crossing: the shortest link between two lines runs along their common
  // perpendicular, and the feet of it are where each line comes closest.
  const between = b.p.clone().sub(a.p);
  const dd = a.d.dot(b.d);
  const denominator = 1 - dd * dd;
  const ta = (between.dot(a.d) - dd * between.dot(b.d)) / denominator;
  const tb = (dd * between.dot(a.d) - between.dot(b.d)) / denominator;
  const footA = a.p.clone().addScaledVector(a.d, ta);
  const footB = b.p.clone().addScaledVector(b.d, tb);
  const gap = footA.distanceTo(footB);

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
