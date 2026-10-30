import * as THREE from 'three';
import * as T from './textures';
import type { SurfaceStyle } from './mapbuilder';

/** Shared material library, created once after fonts load. */
export interface Materials {
  wall: Record<SurfaceStyle, THREE.MeshStandardMaterial>;
  floor: Record<SurfaceStyle, THREE.MeshStandardMaterial>;
  ceiling: THREE.MeshStandardMaterial;
  metal: THREE.MeshStandardMaterial;
  darkMetal: THREE.MeshStandardMaterial;
  steel: THREE.MeshStandardMaterial;
  rust: THREE.MeshStandardMaterial;
  paintedGreen: THREE.MeshStandardMaterial;
  paintedWhite: THREE.MeshStandardMaterial;
  cardboard: THREE.MeshStandardMaterial;
  wood: THREE.MeshStandardMaterial;
  mattress: THREE.MeshStandardMaterial;
  sheet: THREE.MeshStandardMaterial;
  rubber: THREE.MeshStandardMaterial;
  plastic: THREE.MeshStandardMaterial;
  glass: THREE.MeshPhysicalMaterial;
  screen: THREE.MeshStandardMaterial;
  screenViolet: THREE.MeshStandardMaterial;
  fixture: THREE.MeshStandardMaterial;
  fixtureOff: THREE.MeshStandardMaterial;
  emergency: THREE.MeshStandardMaterial;
  amberLamp: THREE.MeshStandardMaterial;
  greenLamp: THREE.MeshStandardMaterial;
  violetGlow: THREE.MeshStandardMaterial;
  door: THREE.MeshStandardMaterial;
  doorLocked: THREE.MeshStandardMaterial;
  blood: THREE.MeshStandardMaterial;
}

let lib: Materials | null = null;

function std(map: { map: THREE.Texture; normal: THREE.Texture }, rough: number, repeat = 1, metal = 0, normalScale = 1) {
  const m = new THREE.MeshStandardMaterial({
    map: map.map,
    normalMap: map.normal,
    roughness: rough,
    metalness: metal,
  });
  m.normalScale.set(normalScale, normalScale);
  if (repeat !== 1) {
    m.map!.repeat.set(repeat, repeat);
    m.normalMap!.repeat.set(repeat, repeat);
  }
  return m;
}

export function materials(): Materials {
  if (lib) return lib;
  const metalTex = T.brushedMetal(91, '#7b8582');
  const darkTex = T.brushedMetal(92, '#3a4140');
  const rustTex = T.brushedMetal(93, '#5a4636');
  const greenTex = T.brushedMetal(94, '#4b6a62');
  const whiteTex = T.brushedMetal(95, '#b8c0bc');

  lib = {
    wall: {
      concrete: std(T.concreteWall(), 0.95),
      ward: std(T.wardWall(), 0.8),
      tile: std(T.tileWall(), 0.45),
      lab: std(T.labWall(), 0.55),
    },
    floor: {
      concrete: std(T.concreteFloor(), 0.9),
      ward: std(T.vinylFloor(), 0.55),
      tile: std(T.vinylFloor(66), 0.5),
      lab: std(T.epoxyFloor(), 0.4),
    },
    ceiling: std(T.ceilingTiles(), 0.95),
    metal: std(metalTex, 0.45, 1, 0.75),
    darkMetal: std(darkTex, 0.6, 1, 0.6),
    steel: std(T.brushedMetal(96, '#a9b2af'), 0.3, 1, 0.9),
    rust: std(rustTex, 0.85, 1, 0.4),
    paintedGreen: std(greenTex, 0.65, 1, 0.2),
    paintedWhite: std(whiteTex, 0.5, 1, 0.1),
    cardboard: new THREE.MeshStandardMaterial({ color: '#7a6448', roughness: 0.95 }),
    wood: new THREE.MeshStandardMaterial({ color: '#5a4a3a', roughness: 0.8 }),
    mattress: std(T.fabric(201, '#7d8f97', 'plain'), 0.9),
    sheet: std(T.fabric(202, '#c9cfcb', 'plain'), 0.9),
    rubber: new THREE.MeshStandardMaterial({ color: '#141616', roughness: 0.9 }),
    plastic: new THREE.MeshStandardMaterial({ color: '#c4c9c4', roughness: 0.5 }),
    glass: new THREE.MeshPhysicalMaterial({ color: '#9fc3bd', roughness: 0.08, metalness: 0, transmission: 0, transparent: true, opacity: 0.22, depthWrite: false }),
    screen: new THREE.MeshStandardMaterial({ color: '#0a1412', emissive: '#4fd0a8', emissiveIntensity: 0.6, roughness: 0.3 }),
    screenViolet: new THREE.MeshStandardMaterial({ color: '#0e0a18', emissive: '#a98bff', emissiveIntensity: 1.1, roughness: 0.3 }),
    fixture: new THREE.MeshStandardMaterial({ color: '#d8e6de', emissive: '#d8e6de', emissiveIntensity: 2.2, roughness: 0.4 }),
    fixtureOff: new THREE.MeshStandardMaterial({ color: '#3a403e', roughness: 0.5 }),
    emergency: new THREE.MeshStandardMaterial({ color: '#e2442e', emissive: '#e2442e', emissiveIntensity: 3, roughness: 0.4 }),
    amberLamp: new THREE.MeshStandardMaterial({ color: '#f3b03b', emissive: '#f3b03b', emissiveIntensity: 2.5 }),
    greenLamp: new THREE.MeshStandardMaterial({ color: '#4fd08a', emissive: '#4fd08a', emissiveIntensity: 2.5 }),
    violetGlow: new THREE.MeshStandardMaterial({ color: '#a98bff', emissive: '#a98bff', emissiveIntensity: 2.4, roughness: 0.2 }),
    door: std(T.brushedMetal(97, '#56625e'), 0.55, 1, 0.5),
    doorLocked: std(T.brushedMetal(98, '#6a4a2a'), 0.6, 1, 0.5),
    blood: new THREE.MeshStandardMaterial({ color: '#4a0808', roughness: 0.3 }),
  };
  return lib;
}

/** Free GPU resources under `root`, leaving the shared material library intact. */
export function disposeTree(root: THREE.Object3D) {
  const shared = new Set<THREE.Material>();
  if (lib) {
    for (const v of Object.values(lib)) {
      if (v instanceof THREE.Material) shared.add(v);
      else for (const m of Object.values(v as Record<string, THREE.Material>)) shared.add(m);
    }
  }
  const sharedTex = new Set<THREE.Texture>();
  for (const m of shared) {
    const sm = m as THREE.MeshStandardMaterial;
    for (const t of [sm.map, sm.normalMap, sm.emissiveMap]) if (t) sharedTex.add(t);
  }
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh && !(o as THREE.Points).isPoints) return;
    mesh.geometry?.dispose();
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      if (!m || shared.has(m)) continue;
      const sm = m as THREE.MeshStandardMaterial;
      for (const t of [sm.map, sm.normalMap, sm.emissiveMap]) if (t && !sharedTex.has(t)) t.dispose();
      m.dispose();
    }
  });
}
