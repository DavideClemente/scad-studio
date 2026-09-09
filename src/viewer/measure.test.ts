import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { buildTopology, faceCorner, faceNormal, vertexPosition } from './meshTopology';
import type { Topology } from './meshTopology';
import { circleFromLoop, findRings, fitCircle, snapFeature, snapThroughGap } from './measureFeatures';
import type { Feature } from './measureFeatures';
import { describeFeature, measure } from './measure';

/** Triangle soup, the way an STL arrives: no index, no shared corners. */
function soup(geometry: THREE.BufferGeometry): Topology {
  return buildTopology(geometry.toNonIndexed());
}

function centroid(topology: Topology, face: number): THREE.Vector3 {
  const point = new THREE.Vector3();
  const corner = new THREE.Vector3();
  for (let c = 0; c < 3; c++) point.add(vertexPosition(topology, faceCorner(topology, face, c), corner));
  return point.divideScalar(3);
}

/** The first face whose normal points a given way. */
function faceFacing(topology: Topology, direction: THREE.Vector3): number {
  const normal = new THREE.Vector3();
  for (let f = 0; f < topology.faceCount; f++) {
    if (faceNormal(topology, f, normal).dot(direction) > 0.999) return f;
  }
  throw new Error('no face facing that way');
}

type PickOptions = {
  /** Which two of the point's coordinates stand in for the screen. */
  axes?: [Axis, Axis];
  at?: THREE.Vector3;
  vertexTolerance?: number;
  edgeTolerance?: number;
  /** Where the model is looked at from; by default, straight down the third axis. */
  from?: THREE.Vector3;
};

type Axis = 'x' | 'y' | 'z';

function pick(topology: Topology, face: number, hit: THREE.Vector3, options: PickOptions = {}): Feature {
  const [ax, ay] = options.axes ?? (['x', 'y'] as [Axis, Axis]);
  const project = (point: THREE.Vector3) => new THREE.Vector2(point[ax], point[ay]);
  const target = options.at ?? hit;
  // Looking along whichever axis the screen does not use, from far enough away
  // that the view is effectively straight on.
  const viewPoint = new THREE.Vector3();
  viewPoint[(['x', 'y', 'z'] as Axis[]).find((axis) => axis !== ax && axis !== ay)!] = 1000;
  return snapFeature(
    {
      topology,
      project,
      viewPoint: options.from ?? viewPoint,
      pointer: project(target),
      // Zero by default, so a pick lands on the surface rather than snapping to
      // whatever corner or edge happens to be nearby.
      vertexTolerance: options.vertexTolerance ?? 0,
      edgeTolerance: options.edgeTolerance ?? 0,
    },
    face,
    hit,
  );
}

describe('topology', () => {
  it('welds a box back into eight corners with every triangle paired up', () => {
    const topology = soup(new THREE.BoxGeometry(20, 10, 4));
    expect(topology.faceCount).toBe(12);
    expect(topology.positions.length / 3).toBe(8);
    expect(Array.from(topology.neighbors).every((neighbor) => neighbor >= 0)).toBe(true);
  });

  it('leaves a lone triangle with no neighbours', () => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3),
    );
    const topology = buildTopology(geometry);
    expect(topology.faceCount).toBe(1);
    expect(Array.from(topology.neighbors)).toEqual([-1, -1, -1]);
  });
});

describe('circle fitting', () => {
  it('recovers the centre and radius of a ring of points', () => {
    const points: THREE.Vector3[] = [];
    for (let i = 0; i < 24; i++) {
      const angle = (i / 24) * Math.PI * 2;
      points.push(new THREE.Vector3(3 + 7 * Math.cos(angle), 3 + 7 * Math.sin(angle), 5));
    }
    const fit = fitCircle(points, new THREE.Vector3(0, 0, 1));
    expect(fit).not.toBeNull();
    expect(fit!.radius).toBeCloseTo(7, 6);
    expect(fit!.center.x).toBeCloseTo(3, 6);
    expect(fit!.center.y).toBeCloseTo(3, 6);
    expect(fit!.rms).toBeLessThan(1e-6);
  });

  it('reads a polygon with enough sides as the circle through its corners', () => {
    const points: THREE.Vector3[] = [];
    for (let i = 0; i < 30; i++) {
      const angle = (i / 30) * Math.PI * 2;
      points.push(new THREE.Vector3(4 * Math.cos(angle), 4 * Math.sin(angle), 0));
    }
    expect(circleFromLoop(points)?.radius).toBeCloseTo(4, 6);
  });

  it('refuses a rectangle', () => {
    const outline = [
      [0, 0],
      [10, 0],
      [10, 4],
      [0, 4],
    ];
    // Subdivided so it clears the corner count and can only be rejected on shape.
    const points: THREE.Vector3[] = [];
    for (let i = 0; i < outline.length; i++) {
      const [x0, y0] = outline[i];
      const [x1, y1] = outline[(i + 1) % outline.length];
      for (let t = 0; t < 3; t++) {
        points.push(new THREE.Vector3(x0 + ((x1 - x0) * t) / 3, y0 + ((y1 - y0) * t) / 3, 0));
      }
    }
    expect(circleFromLoop(points)).toBeNull();
  });
});

describe('snapping', () => {
  const box = () => soup(new THREE.BoxGeometry(20, 10, 4));

  it('lands on a corner when the pointer is over one', () => {
    const topology = box();
    const face = faceFacing(topology, new THREE.Vector3(0, 0, 1));
    const corner = vertexPosition(topology, faceCorner(topology, face, 0), new THREE.Vector3());
    const feature = pick(topology, face, centroid(topology, face), {
      at: corner,
      vertexTolerance: 0.5,
      edgeTolerance: 1,
    });
    expect(feature.kind).toBe('point');
    if (feature.kind === 'point') expect(feature.point.distanceTo(corner)).toBeLessThan(1e-6);
  });

  it('lands on the whole edge when the pointer is over one', () => {
    const topology = box();
    const face = faceFacing(topology, new THREE.Vector3(0, 0, 1));
    // Halfway along the top face's long edge, seen from above.
    const feature = pick(topology, face, new THREE.Vector3(0, 5, 2), {
      at: new THREE.Vector3(0, 5, 2),
      vertexTolerance: 0.01,
      edgeTolerance: 0.5,
    });
    expect(feature.kind).toBe('edge');
    if (feature.kind === 'edge') expect(feature.a.distanceTo(feature.b)).toBeCloseTo(20, 5);
  });

  it('ignores a spare vertex the triangulation left inside a face', () => {
    // A flat sheet cut into four, so the middle of it is a vertex the shape
    // itself has no corner at — and no ring anywhere to offer a centre instead.
    const points: number[] = [];
    for (const [x0, x1] of [[-10, 0], [0, 10]]) {
      for (const [y0, y1] of [[-10, 0], [0, 10]]) {
        points.push(x0, y0, 0, x1, y0, 0, x1, y1, 0, x0, y0, 0, x1, y1, 0, x0, y1, 0);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    const topology = buildTopology(geometry);

    const feature = pick(topology, 0, new THREE.Vector3(-3, -3, 0), {
      at: new THREE.Vector3(0, 0, 0),
      vertexTolerance: 2,
      edgeTolerance: 0,
    });
    expect(feature.kind).toBe('plane');
  });

  it('offers a hole its circle rather than one of the corners around it', () => {
    const topology = soup(new THREE.CylinderGeometry(5, 5, 10, 32));
    const face = faceFacing(topology, new THREE.Vector3(0, 1, 0));
    // Sitting right on a rim corner, with room to spare on both tolerances: the
    // corner is only a step along the curve, so the curve is the answer.
    const rim = new THREE.Vector3(0, 5, 5);
    const feature = pick(topology, face, rim, {
      axes: ['x', 'z'],
      at: rim,
      vertexTolerance: 2,
      edgeTolerance: 2,
    });
    expect(feature.kind).toBe('circle');
    if (feature.kind === 'circle') expect(feature.radius).toBeCloseTo(5, 4);
  });

  it('reads a flat face, and its area, from the triangles that share its plane', () => {
    const topology = box();
    const face = faceFacing(topology, new THREE.Vector3(0, 0, 1));
    const feature = pick(topology, face, centroid(topology, face));
    expect(feature.kind).toBe('plane');
    if (feature.kind === 'plane') {
      expect(feature.faces).toHaveLength(2);
      expect(feature.area).toBeCloseTo(200, 4);
      expect(Math.abs(feature.normal.z)).toBeCloseTo(1, 6);
      expect(feature.circle).toBeUndefined();
    }
  });
});

describe('picking a circle apart', () => {
  const cylinder = () => soup(new THREE.CylinderGeometry(5, 5, 10, 32));

  it('gives the centre when the middle of a round face is pointed at', () => {
    const topology = cylinder();
    const face = faceFacing(topology, new THREE.Vector3(0, 1, 0));
    const feature = pick(topology, face, new THREE.Vector3(2, 5, 2), {
      axes: ['x', 'z'],
      at: new THREE.Vector3(0, 5, 0),
      vertexTolerance: 1,
    });
    expect(feature.kind).toBe('point');
    if (feature.kind === 'point') {
      expect(feature.circle?.radius).toBeCloseTo(5, 4);
      expect(feature.point.y).toBeCloseTo(5, 6);
      expect(feature.point.x).toBeCloseTo(0, 6);
    }
  });

  it('gives the circle itself out towards the rim', () => {
    const topology = cylinder();
    const face = faceFacing(topology, new THREE.Vector3(0, 1, 0));
    const rim = new THREE.Vector3(0, 5, 5);
    const feature = pick(topology, face, rim, {
      axes: ['x', 'z'],
      at: rim,
      vertexTolerance: 1,
      edgeTolerance: 1,
    });
    expect(feature.kind).toBe('circle');
  });

  it('finds every rim in the model up front', () => {
    const topology = cylinder();
    const rings = findRings(topology);
    expect(rings).toHaveLength(2);
    for (const ring of rings) expect(ring.radius).toBeCloseTo(5, 4);
    expect(rings.map((r) => r.center.y).sort((a, b) => a - b)).toEqual([-5, 5]);
  });

  it('gives a hole its centre even when the ray goes straight through it', () => {
    // Looking down the bore of a tube: there is nothing along that ray to hit,
    // and the middle of the opening is exactly where a centre is meant.
    const topology = cylinder();
    const project = (point: THREE.Vector3) => new THREE.Vector2(point.x, point.z);
    const feature = snapThroughGap({
      topology,
      project,
      viewPoint: new THREE.Vector3(0, 1000, 0),
      rings: findRings(topology),
      pointer: new THREE.Vector2(0, 0),
      vertexTolerance: 1,
      edgeTolerance: 0,
    });
    expect(feature?.kind).toBe('point');
    if (feature?.kind === 'point') {
      expect(feature.circle?.radius).toBeCloseTo(5, 4);
      // The near rim, not the one at the far end of the bore.
      expect(feature.point.y).toBeCloseTo(5, 6);
    }
  });

  it('offers the near end of a hole rather than the far one', () => {
    // Both rims of a cylinder share an axis, so their centres sit on the same
    // spot on screen; the one meant is the one nearest the viewer.
    const topology = cylinder();
    const face = faceFacing(topology, new THREE.Vector3(0, 1, 0));
    const feature = pick(topology, face, new THREE.Vector3(2, 5, 2), {
      axes: ['x', 'z'],
      at: new THREE.Vector3(0, 5, 0),
      vertexTolerance: 1,
      from: new THREE.Vector3(0, 1000, 0),
    });
    expect(feature.kind).toBe('point');
    if (feature.kind === 'point') expect(feature.point.y).toBeCloseTo(5, 6);
  });
});

describe('snapping a cylinder', () => {
  // Radius 5, height 10, standing on Y — three's cylinders run up the Y axis.
  const cylinder = () => soup(new THREE.CylinderGeometry(5, 5, 10, 32));

  const sideFace = (topology: Topology) => {
    const normal = new THREE.Vector3();
    for (let f = 0; f < topology.faceCount; f++) {
      if (Math.abs(faceNormal(topology, f, normal).y) < 1e-6) return f;
    }
    throw new Error('no side face');
  };

  it('gives the radius straight away when the curved side is clicked', () => {
    const topology = cylinder();
    const face = sideFace(topology);
    const hit = centroid(topology, face);
    const feature = pick(topology, face, hit, { axes: ['x', 'z'] });
    expect(feature.kind).toBe('circle');
    if (feature.kind === 'circle') {
      expect(feature.from).toBe('cylinder');
      expect(feature.radius).toBeCloseTo(5, 4);
      expect(Math.abs(feature.axis.y)).toBeCloseTo(1, 6);
      // The circle reported runs through the point clicked, not the mid-height.
      expect(feature.center.y).toBeCloseTo(hit.y, 5);
    }
  });

  it('gives the radius when the rim is clicked', () => {
    const topology = cylinder();
    const face = sideFace(topology);
    const top = new THREE.Vector3();
    // The rim corner of that face, and a pointer sitting right on it.
    for (let c = 0; c < 3; c++) {
      const corner = vertexPosition(topology, faceCorner(topology, face, c), new THREE.Vector3());
      if (corner.y > top.y || top.lengthSq() === 0) top.copy(corner);
    }
    const feature = pick(topology, face, top, {
      axes: ['x', 'z'],
      at: top,
      vertexTolerance: 0,
      edgeTolerance: 0.5,
    });
    expect(feature.kind).toBe('circle');
    if (feature.kind === 'circle') {
      expect(feature.from).toBe('rim');
      expect(feature.radius).toBeCloseTo(5, 4);
      expect(feature.segments).toBe(32);
    }
  });

  it('carries the radius on a round flat face', () => {
    const topology = cylinder();
    const face = faceFacing(topology, new THREE.Vector3(0, 1, 0));
    const feature = pick(topology, face, centroid(topology, face), { axes: ['x', 'z'] });
    expect(feature.kind).toBe('plane');
    if (feature.kind === 'plane') {
      expect(feature.circle?.radius).toBeCloseTo(5, 4);
      // The area of the 32-sided polygon actually drawn, a whisker under πr².
      expect(feature.area).toBeCloseTo(0.5 * 32 * 25 * Math.sin((2 * Math.PI) / 32), 4);
    }
  });
});

describe('seeing what it picks', () => {
  /**
   * Snapping the way the viewer really does it: through a camera, in pixels.
   * Which of two things nearer the pointer is a question of perspective, and a
   * flat projection cannot ask it — a corner and the corner hidden underneath it
   * land on the same pixel, and either answer looks right.
   */
  function pickThrough(camera: THREE.PerspectiveCamera, topology: Topology, pointer: THREE.Vector2, mesh: THREE.Mesh) {
    camera.updateMatrixWorld();
    const project = (point: THREE.Vector3) => {
      const ndc = point.clone().project(camera);
      if (ndc.z > 1) return null;
      return new THREE.Vector2(((ndc.x + 1) / 2) * 800, ((1 - ndc.y) / 2) * 800);
    };
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2((pointer.x / 800) * 2 - 1, -(pointer.y / 800) * 2 + 1), camera);
    const hit = raycaster.intersectObject(mesh, false)[0];
    expect(hit?.faceIndex).toBeDefined();
    return snapFeature(
      {
        topology,
        project,
        viewPoint: camera.position,
        pointer,
        vertexTolerance: 9,
        edgeTolerance: 7,
        isVisible: (point) => isInView(camera, mesh, point),
      },
      hit.faceIndex!,
      hit.point,
    );
  }

  /** The viewer's own occlusion test: a ray stopped just short of the point. */
  function isInView(camera: THREE.Camera, mesh: THREE.Mesh, point: THREE.Vector3): boolean {
    const towards = point.clone().sub(camera.position);
    const distance = towards.length();
    const raycaster = new THREE.Raycaster(camera.position, towards.divideScalar(distance));
    raycaster.far = distance * 0.999;
    return raycaster.intersectObject(mesh, false).length === 0;
  }

  /**
   * A plate with a ramp standing on it: 14mm of run rising to a ridge 8mm up,
   * with the near side closed in. The ramp's far base edge — where its back meets
   * the plate — is hidden behind the ramp from anywhere in front of it, but it
   * belongs to the plate's top, which faces the viewer squarely.
   */
  function rampOnPlate(): THREE.BufferGeometry {
    const xs = [0, 10, 24, 40];
    const ys = [0, 6, 18, 24];
    const points: number[] = [];
    const quad = (a: number[], b: number[], c: number[], d: number[]) =>
      points.push(...a, ...b, ...c, ...a, ...c, ...d);

    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        // The middle cell is where the ramp stands.
        if (i === 1 && j === 1) continue;
        quad([xs[i], ys[j], 0], [xs[i + 1], ys[j], 0], [xs[i + 1], ys[j + 1], 0], [xs[i], ys[j + 1], 0]);
      }
    }
    quad([24, 6, 0], [24, 18, 0], [10, 18, 8], [10, 6, 8]);
    points.push(24, 6, 0, 10, 6, 8, 10, 6, 0);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    return geometry;
  }

  it('will not pick an edge hidden behind the solid', () => {
    const geometry = new THREE.BoxGeometry(20, 10, 4).toNonIndexed();
    const topology = buildTopology(geometry);
    const mesh = new THREE.Mesh(geometry);
    mesh.updateMatrixWorld();

    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 5000);
    camera.position.set(0, 30, 22);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();

    // The far bottom corner is round the back and underneath, in shadow of the
    // whole box — but it lands on a pixel that shows the top face, so nothing in
    // screen space alone tells the two apart.
    const behind = new THREE.Vector3(-10, -5, -2).project(camera);
    const pointer = new THREE.Vector2(((behind.x + 1) / 2) * 800, ((1 - behind.y) / 2) * 800);

    const feature = pickThrough(camera, topology, pointer, mesh);
    expect(feature.kind).toBe('plane');
  });

  it('will not pick an edge hidden behind something standing on the surface', () => {
    const geometry = rampOnPlate();
    const topology = buildTopology(geometry);
    const mesh = new THREE.Mesh(geometry);
    mesh.updateMatrixWorld();

    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 5000);
    camera.position.set(60, -30, 40);
    camera.lookAt(17, 12, 2);
    camera.updateMatrixWorld();

    const buried = new THREE.Vector3(17, 18, 0);
    expect(isInView(camera, mesh, buried)).toBe(false);

    const ndc = buried.clone().project(camera);
    const pointer = new THREE.Vector2(((ndc.x + 1) / 2) * 800, ((1 - ndc.y) / 2) * 800);
    // Pointing straight at where that edge appears on screen lands on the ramp,
    // which is the thing in the way — so the ramp's face is the answer.
    expect(pickThrough(camera, topology, pointer, mesh).kind).toBe('plane');
  });

  it('still picks the edge in front of it from the same angle', () => {
    const geometry = new THREE.BoxGeometry(20, 10, 4).toNonIndexed();
    const topology = buildTopology(geometry);
    const mesh = new THREE.Mesh(geometry);
    mesh.updateMatrixWorld();

    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 5000);
    camera.position.set(0, 30, 22);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();

    // The near top edge, plainly in view.
    const front = new THREE.Vector3(0, 5, 2).project(camera);
    const pointer = new THREE.Vector2(((front.x + 1) / 2) * 800, ((1 - front.y) / 2) * 800);

    const feature = pickThrough(camera, topology, pointer, mesh);
    expect(feature.kind).toBe('edge');
    if (feature.kind === 'edge') {
      expect(feature.a.z).toBeCloseTo(2, 6);
      expect(feature.a.distanceTo(feature.b)).toBeCloseTo(20, 5);
    }
  });
});

describe('measuring between features', () => {
  const point = (x: number, y: number, z: number): Feature => ({ kind: 'point', point: new THREE.Vector3(x, y, z) });

  it('gives distance and axis components between two points', () => {
    const result = measure(point(0, 0, 0), point(3, 4, 12));
    expect(result.primary.value).toBe('13.000 mm');
    expect(result.rows.map((row) => row.value)).toEqual(['3.000 mm', '4.000 mm', '12.000 mm']);
  });

  it('measures the height of a box as the gap between its two flat faces', () => {
    const topology = soup(new THREE.BoxGeometry(20, 10, 4));
    const top = pick(topology, faceFacing(topology, new THREE.Vector3(0, 0, 1)), new THREE.Vector3(0, 0, 2));
    const bottom = pick(topology, faceFacing(topology, new THREE.Vector3(0, 0, -1)), new THREE.Vector3(0, 0, -2));
    const result = measure(top, bottom);
    expect(result.primary.label).toBe('Distance between faces');
    expect(result.primary.value).toBe('4.000 mm');
  });

  it('measures two faces that meet at a corner as an angle', () => {
    const topology = soup(new THREE.BoxGeometry(20, 10, 4));
    const top = pick(topology, faceFacing(topology, new THREE.Vector3(0, 0, 1)), new THREE.Vector3(0, 0, 2));
    const side = pick(topology, faceFacing(topology, new THREE.Vector3(1, 0, 0)), new THREE.Vector3(10, 0, 0));
    const result = measure(top, side);
    expect(result.primary.label).toBe('Angle between faces');
    expect(result.primary.value).toBe('90.00°');
  });

  const ring = (x: number, radius = 1.5): Feature => ({
    kind: 'circle',
    from: 'rim',
    center: new THREE.Vector3(x, 0, 0),
    radius,
    axis: new THREE.Vector3(0, 0, 1),
    segments: 30,
  });

  it('measures between two rings from the nearest point on each', () => {
    const result = measure(ring(0), ring(25));
    // 25 between the centres, less a radius at each end.
    expect(result.primary.value).toBe('22.000 mm');
    expect(result.primary.label).toBe('Between circles');
    expect(result.rows).toContainEqual({ label: 'Between centres', value: '25.000 mm' });
    expect(result.from.x).toBeCloseTo(1.5, 6);
    expect(result.to.x).toBeCloseTo(23.5, 6);
    expect(describeFeature(ring(0)).rows[0]).toEqual({ label: 'Diameter', value: '3.000 mm' });
  });

  it('measures hole to hole between centres when the centres are picked', () => {
    const centre = (x: number): Feature => ({
      kind: 'point',
      point: new THREE.Vector3(x, 0, 0),
      circle: { center: new THREE.Vector3(x, 0, 0), radius: 1.5, axis: new THREE.Vector3(0, 0, 1) },
    });
    const result = measure(centre(0), centre(25));
    expect(result.primary.value).toBe('25.000 mm');
    expect(describeFeature(centre(0)).name).toBe('Centre');
  });

  it('measures a ring against a face from the edge of the hole', () => {
    const face: Feature = {
      kind: 'plane',
      point: new THREE.Vector3(10, 0, 0),
      normal: new THREE.Vector3(1, 0, 0),
      area: 100,
      faces: [],
    };
    // The ring lies in a plane square to the face, so its nearest point is one
    // radius nearer than its centre.
    const result = measure(ring(0, 2.5), face);
    expect(result.primary.label).toBe('Distance to face');
    expect(result.primary.value).toBe('7.500 mm');
    expect(result.rows).toContainEqual({ label: 'From the centre', value: '10.000 mm' });
  });

  it('measures a ring against an edge, which has no closed form', () => {
    const edge: Feature = {
      kind: 'edge',
      a: new THREE.Vector3(9, -5, 0),
      b: new THREE.Vector3(9, 5, 0),
    };
    // The edge runs parallel to the ring's plane, 9 out from its centre.
    const result = measure(ring(0, 2), edge);
    expect(result.primary.label).toBe('Distance to edge');
    expect(result.primary.value).toBe('7.000 mm');
  });

  it('measures to an edge itself, not to where its line would have gone', () => {
    const edge: Feature = {
      kind: 'edge',
      a: new THREE.Vector3(0, 0, 0),
      b: new THREE.Vector3(10, 0, 0),
    };
    // Alongside the edge, the perpendicular is the answer.
    expect(measure(point(4, 3, 0), edge).primary.value).toBe('3.000 mm');

    // Past its end, the answer runs to the end — 3 across and 4 beyond. Carrying
    // the line on would have said 3.000, which is a distance to something that is
    // not there.
    const beyond = measure(point(14, 3, 0), edge);
    expect(beyond.primary.value).toBe('5.000 mm');
    expect(beyond.to.x).toBeCloseTo(10, 6);
  });

  it('measures a ring to an edge that stops short of it', () => {
    const edge: Feature = {
      kind: 'edge',
      a: new THREE.Vector3(6, 8, 0),
      b: new THREE.Vector3(6, 18, 0),
    };
    // The nearest point of the edge is its end, 10 from the centre of a ring of
    // radius 5 — so 5 from the ring itself.
    const result = measure(ring(0, 5), edge);
    expect(result.primary.value).toBe('5.000 mm');
    expect(result.rows).toContainEqual({ label: 'From the centre', value: '10.000 mm' });
    expect(result.to.y).toBeCloseTo(8, 6);
  });

  it('measures two edges that pass each other from their nearest ends', () => {
    const along: Feature = { kind: 'edge', a: new THREE.Vector3(0, 0, 0), b: new THREE.Vector3(10, 0, 0) };
    const across: Feature = { kind: 'edge', a: new THREE.Vector3(16, 0, 0), b: new THREE.Vector3(16, 10, 0) };
    const result = measure(along, across);
    expect(result.primary.label).toBe('Angle between edges');
    expect(result.rows[0]).toEqual({ label: 'Closest approach', value: '6.000 mm' });
  });

  it('reports point coordinates in the space the design was written in', () => {
    const feature = point(1, 2, 3);
    const rows = describeFeature(feature, new THREE.Vector3(0, 0, 10)).rows;
    expect(rows.map((row) => row.value)).toEqual(['1.000 mm', '2.000 mm', '13.000 mm']);
  });
});
