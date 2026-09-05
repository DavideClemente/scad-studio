import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';

// Roughly an Ender-3 / Prusa MK3-sized bed, in millimeters.
const BED_SIZE_MM = 220;

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

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#1c2128');
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(45, 1, 1, 5000);
    camera.up.set(0, 0, 1);
    camera.position.set(BED_SIZE_MM * 0.8, -BED_SIZE_MM * 1.2, BED_SIZE_MM);
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

        camera.position.set(distance * 0.6, -distance * 0.9, distance * 0.7);
        camera.near = Math.max(radius / 100, 0.1);
        camera.far = distance * 20;
        controls.target.set(0, 0, size.z / 2);
      } else {
        camera.position.set(BED_SIZE_MM * 0.8, -BED_SIZE_MM * 1.2, BED_SIZE_MM);
        camera.near = 1;
        camera.far = 5000;
        controls.target.set(0, 0, 0);
      }
      camera.updateProjectionMatrix();
      controls.update();
    };
    resetViewRef.current = resetView;

    let frameId: number;
    const animate = () => {
      frameId = requestAnimationFrame(animate);
      controls.update();
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
      controls.dispose();
      renderer.dispose();
      container.removeChild(renderer.domElement);
    };
  }, []);

  useEffect(() => {
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!scene || !stl) return;

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
    geometry.center();

    const material = new THREE.MeshStandardMaterial({ color: '#f0a24a', roughness: 0.55, metalness: 0.05 });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.z = size.z / 2;

    scene.add(mesh);
    meshRef.current = mesh;

    if (camera && controls) resetViewRef.current();
  }, [stl]);

  useEffect(() => {
    if (gridRef.current) gridRef.current.visible = showGrid;
  }, [showGrid]);

  useEffect(() => {
    if (axesRef.current) axesRef.current.visible = showAxes;
  }, [showAxes]);

  return (
    <div ref={containerRef} className="model-viewer">
      <div className="viewer-options">
        <label>
          <input type="checkbox" checked={showGrid} onChange={(e) => setShowGrid(e.target.checked)} />
          Grid
        </label>
        <label>
          <input type="checkbox" checked={showAxes} onChange={(e) => setShowAxes(e.target.checked)} />
          Axes
        </label>
        <button className="btn btn-small" onClick={() => resetViewRef.current()}>
          Reset View
        </button>
      </div>
    </div>
  );
}
