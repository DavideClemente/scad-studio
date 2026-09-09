import * as THREE from 'three';
import type { Circle, Feature } from './measureFeatures';
import { faceCorner, vertexPosition } from './meshTopology';
import type { Topology } from './meshTopology';

/**
 * The marks the measure tool draws over the model: what the pointer is on, what
 * has been picked, and the dimension between the two.
 *
 * Everything except a highlighted face ignores the depth buffer. A ring around
 * the far side of a hole and a dimension line crossing through the part are the
 * whole point of drawing them, and a marker hidden inside the solid it belongs to
 * would leave the user wondering whether the click registered at all.
 */

const HOVER_COLOR = '#7cc7ff';
const PICK_COLOR = '#4ade9b';
const DIMENSION_COLOR = '#ffffff';

export class MeasureOverlay {
  readonly group = new THREE.Group();

  private readonly topology: Topology;
  private readonly hoverMaterial: THREE.MeshBasicMaterial;
  private readonly pickMaterial: THREE.MeshBasicMaterial;
  private readonly dimensionMaterial: THREE.MeshBasicMaterial;
  private readonly hoverFaceMaterial: THREE.MeshBasicMaterial;
  private readonly pickFaceMaterial: THREE.MeshBasicMaterial;

  /** Marker size, tied to the model so it reads the same on a coin or a crate. */
  private readonly markerRadius: number;
  private readonly lineRadius: number;

  private hover: THREE.Object3D | null = null;
  private picks: (THREE.Object3D | null)[] = [null, null];
  private dimension: THREE.Object3D | null = null;

  constructor(topology: Topology) {
    this.topology = topology;
    this.markerRadius = topology.scale * 0.006;
    this.lineRadius = topology.scale * 0.0022;
    this.group.renderOrder = 10;

    const marker = (color: string) =>
      new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.95 });
    this.hoverMaterial = marker(HOVER_COLOR);
    this.pickMaterial = marker(PICK_COLOR);
    this.dimensionMaterial = marker(DIMENSION_COLOR);

    // A highlighted face is the exception: it lies on the surface, so it keeps
    // depth testing and is nudged towards the camera just enough not to fight
    // with the triangles underneath it.
    const face = (color: string, opacity: number) =>
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity,
        side: THREE.DoubleSide,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      });
    this.hoverFaceMaterial = face(HOVER_COLOR, 0.28);
    this.pickFaceMaterial = face(PICK_COLOR, 0.32);
  }

  setHover(feature: Feature | null) {
    this.hover = this.replace(this.hover, feature && this.build(feature, false));
  }

  setPick(slot: number, feature: Feature | null) {
    this.picks[slot] = this.replace(this.picks[slot], feature && this.build(feature, true));
  }

  setDimension(from: THREE.Vector3 | null, to: THREE.Vector3 | null) {
    let next: THREE.Object3D | null = null;
    if (from && to && from.distanceToSquared(to) > 0) {
      next = new THREE.Group();
      next.add(this.rod(from, to, this.lineRadius, this.dimensionMaterial));
      // Ends the line in something visible even when it stops on open air, as a
      // perpendicular dropped past the end of an edge does.
      for (const end of [from, to]) {
        const cap = new THREE.Mesh(
          new THREE.SphereGeometry(this.lineRadius * 1.8, 12, 8),
          this.dimensionMaterial,
        );
        cap.position.copy(end);
        next.add(cap);
      }
    }
    this.dimension = this.replace(this.dimension, next);
  }

  clear() {
    this.setHover(null);
    this.setPick(0, null);
    this.setPick(1, null);
    this.setDimension(null, null);
  }

  dispose() {
    this.clear();
    for (const material of [
      this.hoverMaterial,
      this.pickMaterial,
      this.dimensionMaterial,
      this.hoverFaceMaterial,
      this.pickFaceMaterial,
    ]) {
      material.dispose();
    }
    this.group.removeFromParent();
  }

  private replace(current: THREE.Object3D | null, next: THREE.Object3D | null): THREE.Object3D | null {
    if (current) {
      this.group.remove(current);
      current.traverse((child) => {
        if (child instanceof THREE.Mesh) child.geometry.dispose();
      });
    }
    if (next) this.group.add(next);
    return next;
  }

  /** A cylinder standing in for a line, since GPU line width is not settable. */
  private rod(from: THREE.Vector3, to: THREE.Vector3, radius: number, material: THREE.Material): THREE.Mesh {
    const direction = to.clone().sub(from);
    const length = direction.length();
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 8), material);
    mesh.position.copy(from).addScaledVector(direction, 0.5);
    if (length > 0) mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.divideScalar(length));
    return mesh;
  }

  /** A circle, drawn as a torus lying in the circle's own plane. */
  private ring(circle: Circle, radius: number, material: THREE.Material): THREE.Mesh {
    const mesh = new THREE.Mesh(new THREE.TorusGeometry(circle.radius, radius, 8, 128), material);
    mesh.position.copy(circle.center);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), circle.axis.clone().normalize());
    return mesh;
  }

  private build(feature: Feature, picked: boolean): THREE.Object3D {
    const material = picked ? this.pickMaterial : this.hoverMaterial;
    switch (feature.kind) {
      case 'point': {
        const mesh = new THREE.Mesh(new THREE.SphereGeometry(this.markerRadius, 16, 12), material);
        mesh.position.copy(feature.point);
        if (!feature.circle) return mesh;
        // The centre of a circle is a place with nothing at it, so the circle it
        // belongs to is drawn behind it, thin enough not to be mistaken for a
        // pick of the ring itself.
        const group = new THREE.Group();
        group.add(mesh);
        group.add(this.ring(feature.circle, this.lineRadius * 0.55, material));
        return group;
      }
      case 'edge':
        return this.rod(feature.a, feature.b, this.lineRadius * 1.4, material);
      case 'circle':
        return this.ring(feature, this.lineRadius * 1.4, material);
      case 'plane':
        return this.faceHighlight(feature.faces, picked ? this.pickFaceMaterial : this.hoverFaceMaterial);
    }
  }

  /** A copy of the triangles making up a flat face, laid over the original. */
  private faceHighlight(faces: number[], material: THREE.Material): THREE.Mesh {
    const positions = new Float32Array(faces.length * 9);
    const corner = new THREE.Vector3();
    let offset = 0;
    for (const face of faces) {
      for (let c = 0; c < 3; c++) {
        vertexPosition(this.topology, faceCorner(this.topology, face, c), corner);
        positions[offset++] = corner.x;
        positions[offset++] = corner.y;
        positions[offset++] = corner.z;
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    return new THREE.Mesh(geometry, material);
  }
}
