import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { buildTopology } from './meshTopology';
import type { Topology } from './meshTopology';
import { findRings, snapFeature, snapThroughGap } from './measureFeatures';
import type { Circle, Feature } from './measureFeatures';
import { describeFeature, measure, summarizeFeature } from './measure';
import type { Measurement } from './measure';
import { MeasureOverlay } from './measureOverlay';

// Roughly an Ender-3 / Prusa MK3-sized bed, in millimeters.
const BED_SIZE_MM = 220;

/** How near the pointer must come, in pixels, to snap to a corner or an edge. */
const VERTEX_SNAP_PX = 9;
const EDGE_SNAP_PX = 7;

/** Further than this between press and release is an orbit drag, not a click. */
const CLICK_SLOP_PX = 4;

/**
 * Looking straight down at the bed, which is the view that shows what a flat
 * design actually is: an outline. Almost straight down, in fact — the camera's up
 * axis is +Z to match the print bed, and a camera placed exactly on that axis has
 * no defined orientation about it. The small lean south of vertical settles that,
 * puts the model's +Y at the top of the screen, and is far too slight to see.
 */
function topDown(distance: number, height = 0): [number, number, number] {
  return [0, -distance * 0.02, height + distance];
}

type Props = {
  stl: ArrayBuffer | null;
};

export function ModelViewer({ stl }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const meshRef = useRef<THREE.Mesh | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const gridRef = useRef<THREE.GridHelper | null>(null);
  const axesRef = useRef<THREE.AxesHelper | null>(null);
  const resetViewRef = useRef<() => void>(() => {});
  const [showGrid, setShowGrid] = useState(true);
  const [showAxes, setShowAxes] = useState(true);

  const [measuring, setMeasuring] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [picks, setPicks] = useState<(Feature | null)[]>([null, null]);
  const measurement = useMemo(
    () => (picks[0] && picks[1] ? measure(picks[0], picks[1]) : null),
    [picks],
  );

  // Read by the render loop, which runs outside React and must see what is true
  // now rather than what was true when it was last handed a callback.
  const measuringRef = useRef(false);
  const measurementRef = useRef<Measurement | null>(null);
  useEffect(() => {
    measuringRef.current = measuring;
    measurementRef.current = measurement;
  }, [measuring, measurement]);

  const topologyRef = useRef<Topology | null>(null);
  const ringsRef = useRef<Circle[]>([]);
  const overlayRef = useRef<MeasureOverlay | null>(null);
  const hoverRef = useRef<Feature | null>(null);
  // Surfaces already worked out, shared by every face belonging to one. Without
  // it, sliding the pointer across a large face would re-grow the same region on
  // every frame.
  const surfaceCacheRef = useRef<Map<number, Feature>>(new Map());
  // Where the design's own origin sits, once the model has been centred on the
  // bed, so a picked corner can be reported in the coordinates the code uses.
  const [origin, setOrigin] = useState(() => new THREE.Vector3());
  const hintRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLDivElement>(null);
  // Where the reading has been dragged to, in pixels off the middle of the line
  // it belongs to. Kept out of state: it changes with every pointer move of a
  // drag, and only the label itself has to know.
  const labelOffsetRef = useRef({ x: 0, y: -26 });

  const addPick = useCallback((feature: Feature) => {
    // Two picks make a measurement; a third starts the next one, which is
    // quicker than reaching for Clear between measurements.
    setPicks(([a, b]) => (a === null ? [feature, null] : b === null ? [a, feature] : [feature, null]));
  }, []);

  const clearPicks = useCallback(() => setPicks([null, null]), []);

  // Dragging the reading out of the way, the way a dimension moves in CAD: the
  // line it names is often exactly what it was covering up.
  const handleLabelPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const label = event.currentTarget;
    const start = { x: event.clientX, y: event.clientY };
    const from = { ...labelOffsetRef.current };
    label.setPointerCapture(event.pointerId);

    const handleMove = (move: PointerEvent) => {
      labelOffsetRef.current = { x: from.x + (move.clientX - start.x), y: from.y + (move.clientY - start.y) };
    };
    const handleUp = () => {
      label.removeEventListener('pointermove', handleMove);
      label.removeEventListener('pointerup', handleUp);
      label.removeEventListener('pointercancel', handleUp);
    };
    label.addEventListener('pointermove', handleMove);
    label.addEventListener('pointerup', handleUp);
    label.addEventListener('pointercancel', handleUp);
  }, []);

  const stopMeasuring = useCallback(() => {
    setMeasuring(false);
    setPicks([null, null]);
    hoverRef.current = null;
    // Emptied rather than thrown away. The overlay belongs to the mesh, like the
    // connectivity it draws from, and both stay valid for as long as the model
    // does — so coming back to the tool costs nothing and picks up immediately.
    overlayRef.current?.clear();
    if (hintRef.current) hintRef.current.style.visibility = 'hidden';
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#1c2128');
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(45, 1, 1, 5000);
    camera.up.set(0, 0, 1);
    camera.position.set(...topDown(BED_SIZE_MM * 1.6));
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0, 0);
    controls.enableDamping = true;
    controlsRef.current = controls;

    scene.add(new THREE.HemisphereLight('#ffffff', '#3a3f4a', 1.1));
    const keyLight = new THREE.DirectionalLight('#ffffff', 1.2);
    keyLight.position.set(BED_SIZE_MM, -BED_SIZE_MM, BED_SIZE_MM * 1.5);
    scene.add(keyLight);

    const grid = new THREE.GridHelper(BED_SIZE_MM, BED_SIZE_MM / 10, '#4a5568', '#2d3340');
    grid.rotation.x = Math.PI / 2;
    scene.add(grid);
    gridRef.current = grid;

    const axes = new THREE.AxesHelper(BED_SIZE_MM * 0.15);
    scene.add(axes);
    axesRef.current = axes;

    const resetView = () => {
      const mesh = meshRef.current;
      if (mesh) {
        const geometry = mesh.geometry;
        geometry.computeBoundingSphere();
        geometry.computeBoundingBox();
        const size = new THREE.Vector3();
        geometry.boundingBox?.getSize(size);
        const radius = Math.max(geometry.boundingSphere?.radius ?? BED_SIZE_MM / 2, 20);
        const distance = radius * 3;

        camera.position.set(...topDown(distance, size.z / 2));
        camera.near = Math.max(radius / 100, 0.1);
        camera.far = distance * 20;
        controls.target.set(0, 0, size.z / 2);
      } else {
        camera.position.set(...topDown(BED_SIZE_MM * 1.6));
        camera.near = 1;
        camera.far = 5000;
        controls.target.set(0, 0, 0);
      }
      camera.updateProjectionMatrix();
      controls.update();
    };
    resetViewRef.current = resetView;

    // --- Measuring ---------------------------------------------------------
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const pointerPx = new THREE.Vector2();
    const localHit = new THREE.Vector3();
    const localEye = new THREE.Vector3();
    const projected = new THREE.Vector3();
    const pointer = { x: 0, y: 0, inside: false, dirty: false };
    let pressedAt: { x: number; y: number } | null = null;

    const showHover = (feature: Feature | null) => {
      hoverRef.current = feature;
      overlayRef.current?.setHover(feature);
      const hint = hintRef.current;
      if (!hint) return;
      if (!feature) {
        hint.style.visibility = 'hidden';
        return;
      }
      // Written straight to the DOM rather than through state: this changes on
      // every frame the pointer moves, and re-rendering the panel that often
      // would cost more than the whole pick does.
      hint.textContent = summarizeFeature(feature);
      hint.style.transform = `translate(${pointer.x + 14}px, ${pointer.y + 14}px)`;
      hint.style.visibility = 'visible';
    };

    const updateHover = () => {
      const mesh = meshRef.current;
      const topology = topologyRef.current;
      const width = container.clientWidth;
      const height = container.clientHeight;
      if (!mesh || !topology || !pointer.inside || width === 0 || height === 0) {
        showHover(null);
        return;
      }

      ndc.set((pointer.x / width) * 2 - 1, -(pointer.y / height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      const hit = raycaster.intersectObject(mesh, false)[0];

      mesh.worldToLocal(localEye.copy(camera.position));
      const context = {
        topology,
        project: (point: THREE.Vector3) => {
          projected.copy(point).applyMatrix4(mesh.matrixWorld).project(camera);
          if (projected.z > 1) return null;
          return new THREE.Vector2(((projected.x + 1) / 2) * width, ((1 - projected.y) / 2) * height);
        },
        viewPoint: localEye,
        rings: ringsRef.current,
        isVisible,
        pointer: pointerPx.set(pointer.x, pointer.y),
        vertexTolerance: VERTEX_SNAP_PX,
        edgeTolerance: EDGE_SNAP_PX,
        surfaceCache: surfaceCacheRef.current,
      };

      // Nothing under the pointer does not mean nothing to pick: looking down a
      // hole, the ray leaves through the far side, and the centre of that hole is
      // exactly what is being pointed at.
      if (!hit || hit.faceIndex == null) {
        showHover(snapThroughGap(context));
        return;
      }

      mesh.worldToLocal(localHit.copy(hit.point));
      showHover(snapFeature(context, hit.faceIndex, localHit));
    };

    // Whether a point on the model is in view or hidden behind another part of
    // it. The ray is stopped just short of the point itself, so anything it does
    // hit is genuinely in the way. Sweeping every triangle for this would be
    // wasteful if it happened often — it does not: only the candidate about to be
    // chosen is ever asked about, usually one per pointer move.
    const visibilityRay = new THREE.Raycaster();
    const worldPoint = new THREE.Vector3();
    const towards = new THREE.Vector3();
    const blockers: THREE.Intersection[] = [];
    const isVisible = (localPoint: THREE.Vector3): boolean => {
      const mesh = meshRef.current;
      if (!mesh) return true;
      mesh.localToWorld(worldPoint.copy(localPoint));
      towards.subVectors(worldPoint, camera.position);
      const distance = towards.length();
      if (distance === 0) return true;
      visibilityRay.set(camera.position, towards.divideScalar(distance));
      // Short of the point by a whisker, so that the surface the point itself
      // sits on is not mistaken for something hiding it.
      visibilityRay.far = distance * 0.999;
      blockers.length = 0;
      visibilityRay.intersectObject(mesh, false, blockers);
      return blockers.length === 0;
    };

    const handlePointerMove = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = event.clientX - rect.left;
      pointer.y = event.clientY - rect.top;
      pointer.inside = true;
      pointer.dirty = true;
    };
    const handlePointerLeave = () => {
      pointer.inside = false;
      pointer.dirty = true;
    };
    const handlePointerDown = (event: PointerEvent) => {
      pressedAt = { x: event.clientX, y: event.clientY };
    };
    // Orbiting and picking share the left button, so a press that moved is left
    // to the controls and only a press that stayed put counts as a pick.
    const handlePointerUp = (event: PointerEvent) => {
      const pressed = pressedAt;
      pressedAt = null;
      if (!pressed || !measuringRef.current) return;
      if (Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y) > CLICK_SLOP_PX) return;
      const feature = hoverRef.current;
      if (feature) addPick(feature);
    };

    const canvas = renderer.domElement;
    canvas.addEventListener('pointermove', handlePointerMove);
    canvas.addEventListener('pointerleave', handlePointerLeave);
    canvas.addEventListener('pointerdown', handlePointerDown);
    canvas.addEventListener('pointerup', handlePointerUp);

    /**
     * Keeps the reading beside the middle of the line it names — offset clear of
     * it by default, and wherever it has been dragged to after that.
     */
    const positionLabel = () => {
      const label = labelRef.current;
      const mesh = meshRef.current;
      const current = measurementRef.current;
      if (!label || !current || !mesh) return;
      projected
        .copy(current.from)
        .add(current.to)
        .multiplyScalar(0.5)
        .add(mesh.position)
        .project(camera);
      if (projected.z > 1) {
        label.style.visibility = 'hidden';
        return;
      }
      const offset = labelOffsetRef.current;
      const x = ((projected.x + 1) / 2) * container.clientWidth + offset.x;
      const y = ((1 - projected.y) / 2) * container.clientHeight + offset.y;
      label.style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px)`;
      label.style.visibility = 'visible';
    };

    let frameId: number;
    const animate = () => {
      frameId = requestAnimationFrame(animate);
      controls.update();
      if (measuringRef.current && pointer.dirty) {
        pointer.dirty = false;
        updateHover();
      }
      positionLabel();
      renderer.render(scene, camera);
    };
    animate();

    const resizeObserver = new ResizeObserver(() => {
      const { clientWidth, clientHeight } = container;
      if (clientWidth === 0 || clientHeight === 0) return;
      camera.aspect = clientWidth / clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(clientWidth, clientHeight);
    });
    resizeObserver.observe(container);

    return () => {
      cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
      canvas.removeEventListener('pointermove', handlePointerMove);
      canvas.removeEventListener('pointerleave', handlePointerLeave);
      canvas.removeEventListener('pointerdown', handlePointerDown);
      canvas.removeEventListener('pointerup', handlePointerUp);
      overlayRef.current?.dispose();
      overlayRef.current = null;
      controls.dispose();
      renderer.dispose();
      container.removeChild(renderer.domElement);
    };
  }, [addPick]);

  useEffect(() => {
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!scene || !stl) return;

    // A new model makes everything read off the old one meaningless.
    overlayRef.current?.dispose();
    overlayRef.current = null;
    topologyRef.current = null;
    ringsRef.current = [];
    hoverRef.current = null;
    surfaceCacheRef.current = new Map();
    setPicks([null, null]);

    if (meshRef.current) {
      scene.remove(meshRef.current);
      meshRef.current.geometry.dispose();
      (meshRef.current.material as THREE.Material).dispose();
      meshRef.current = null;
    }

    const geometry = new STLLoader().parse(stl);
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();

    const size = new THREE.Vector3();
    geometry.boundingBox?.getSize(size);
    // Where the design's origin was before the model was moved onto the bed.
    const modelOrigin = new THREE.Vector3();
    geometry.boundingBox?.getCenter(modelOrigin);
    setOrigin(modelOrigin);
    geometry.center();

    const material = new THREE.MeshStandardMaterial({ color: '#f0a24a', roughness: 0.55, metalness: 0.05 });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.z = size.z / 2;

    scene.add(mesh);
    meshRef.current = mesh;

    if (camera && controls) resetViewRef.current();
  }, [stl]);

  // Reading the mesh's connectivity takes a moment on a large model, so it waits
  // until measuring is actually asked for, and until after the panel has painted
  // so the wait is visible rather than a stalled click.
  useEffect(() => {
    if (!measuring) return;
    const scene = sceneRef.current;
    const mesh = meshRef.current;
    // Both are set together and cleared together, when the model changes.
    if (!scene || !mesh || overlayRef.current) return;

    setPreparing(true);
    let cancelled = false;
    // A timer rather than an animation frame: two frames' grace is enough for
    // the panel to paint, and a timer still runs when the tab is in the
    // background, where animation frames stop and the wait would never end.
    const timer = setTimeout(() => {
      if (cancelled) return;
      const topology = buildTopology(mesh.geometry);
      topologyRef.current = topology;
      ringsRef.current = findRings(topology);
      surfaceCacheRef.current = new Map();
      const overlay = new MeasureOverlay(topology);
      overlay.group.position.copy(mesh.position);
      scene.add(overlay.group);
      overlayRef.current = overlay;
      setPreparing(false);
    }, 32);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [measuring, stl]);


  useEffect(() => {
    // A new measurement gets its label back beside the line, wherever the last
    // one was dragged to.
    labelOffsetRef.current = { x: 0, y: -26 };
    const overlay = overlayRef.current;
    if (!overlay) return;
    overlay.setPick(0, picks[0]);
    overlay.setPick(1, picks[1]);
    overlay.setDimension(measurement?.from ?? null, measurement?.to ?? null);
  }, [picks, measurement, preparing]);

  useEffect(() => {
    if (!measuring) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // One step back at a time: clear the picks, and only leave the tool once
      // there is nothing left to clear.
      if (picks[0]) clearPicks();
      else stopMeasuring();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [measuring, picks, clearPicks, stopMeasuring]);

  useEffect(() => {
    if (gridRef.current) gridRef.current.visible = showGrid;
  }, [showGrid]);

  useEffect(() => {
    if (axesRef.current) axesRef.current.visible = showAxes;
  }, [showAxes]);

  const details = measurement ?? (picks[0] && !picks[1] ? describeFeature(picks[0], origin) : null);

  return (
    <div ref={containerRef} className={`model-viewer ${measuring ? 'is-measuring' : ''}`}>
      <div className="viewer-options">
        <label>
          <input type="checkbox" checked={showGrid} onChange={(e) => setShowGrid(e.target.checked)} />
          Grid
        </label>
        <label>
          <input type="checkbox" checked={showAxes} onChange={(e) => setShowAxes(e.target.checked)} />
          Axes
        </label>
        <button
          className={`btn btn-small ${measuring ? 'btn-primary' : ''}`}
          onClick={() => (measuring ? stopMeasuring() : setMeasuring(true))}
          disabled={!stl}
          title="Measure between corners, edges, faces and holes"
        >
          Measure
        </button>
        <button className="btn btn-small" onClick={() => resetViewRef.current()}>
          Reset View
        </button>
      </div>

      <div ref={hintRef} className="measure-hint" />
      <div
        ref={labelRef}
        className="measure-label"
        hidden={!measurement}
        title="Drag to move"
        onPointerDown={handleLabelPointerDown}
      >
        {measurement?.primary.value}
      </div>

      {measuring && (
        <div className="measure-panel">
          <div className="measure-head">
            <strong>Measure</strong>
            <button className="btn btn-small" onClick={stopMeasuring}>
              Done
            </button>
          </div>

          {preparing ? (
            <p className="measure-note">Reading the model…</p>
          ) : (
            <>
              <ol className="measure-picks">
                {[0, 1].map((slot) => (
                  <li key={slot} className={picks[slot] ? 'is-set' : ''}>
                    <span className="measure-slot">{slot === 0 ? 'A' : 'B'}</span>
                    <span>{picks[slot] ? summarizeFeature(picks[slot]!) : 'nothing picked'}</span>
                  </li>
                ))}
              </ol>

              {details && (
                <dl className="measure-readout">
                  {'primary' in details && (
                    <div className="measure-primary">
                      <dt>{details.primary.label}</dt>
                      <dd>{details.primary.value}</dd>
                    </div>
                  )}
                  {details.rows.map((row) => (
                    <div key={row.label}>
                      <dt>{row.label}</dt>
                      <dd>{row.value}</dd>
                    </div>
                  ))}
                </dl>
              )}

              <p className="measure-note">
                {picks[0] === null
                  ? 'Click a corner, an edge, a face or a hole — its middle is the centre, its rim the circle. Drag to rotate as usual.'
                  : picks[1] === null
                    ? 'Pick the second feature to measure between them.'
                    : 'Click anywhere to start the next measurement.'}
              </p>

              {picks[0] && (
                <button className="btn btn-small" onClick={clearPicks}>
                  Clear
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
