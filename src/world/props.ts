import * as THREE from 'three';
import { materials } from './materials';
import { Rng } from '../core/math';
import { signTexture } from './textures';

/**
 * Procedural prop kit. Every builder returns a group in local space: origin on the floor at the
 * tile centre, front facing +Z (back against -Z). Footprint is reported for collision.
 */
export interface PropBuild {
  group: THREE.Group;
  /** collision footprint (x, z) in local space, metres */
  size: [number, number];
  height: number;
  /** interactive or animated props are not merged into the static batch */
  dynamic?: boolean;
  /** props like crates may rotate freely instead of snapping to the wall */
  freeRotate?: boolean;
  /** extra state for animated props */
  parts?: Record<string, THREE.Object3D>;
}

const geoCache = new Map<string, THREE.BufferGeometry>();
function boxGeo(w: number, h: number, d: number) {
  const k = `b${w.toFixed(3)}|${h.toFixed(3)}|${d.toFixed(3)}`;
  let g = geoCache.get(k);
  if (!g) geoCache.set(k, (g = new THREE.BoxGeometry(w, h, d)));
  return g;
}
function cylGeo(rt: number, rb: number, h: number, seg = 16) {
  const k = `c${rt}|${rb}|${h}|${seg}`;
  let g = geoCache.get(k);
  if (!g) geoCache.set(k, (g = new THREE.CylinderGeometry(rt, rb, h, seg)));
  return g;
}

function box(g: THREE.Object3D, w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number, ry = 0) {
  const m = new THREE.Mesh(boxGeo(w, h, d), mat);
  m.position.set(x, y, z);
  m.rotation.y = ry;
  m.castShadow = true;
  m.receiveShadow = true;
  g.add(m);
  return m;
}

function cyl(g: THREE.Object3D, r: number, h: number, mat: THREE.Material, x: number, y: number, z: number, axis: 'x' | 'y' | 'z' = 'y', seg = 16, r2 = r) {
  const m = new THREE.Mesh(cylGeo(r, r2, h, seg), mat);
  m.position.set(x, y, z);
  if (axis === 'x') m.rotation.z = Math.PI / 2;
  if (axis === 'z') m.rotation.x = Math.PI / 2;
  m.castShadow = true;
  m.receiveShadow = true;
  g.add(m);
  return m;
}

export function buildProp(ch: string, rng: Rng): PropBuild | null {
  const M = materials();
  const g = new THREE.Group();
  switch (ch) {
    case 'g': {
      // gurney, sometimes with a body bag
      const top = 0.86;
      box(g, 0.68, 0.05, 1.9, M.steel, 0, top, 0);
      box(g, 0.62, 0.1, 1.8, M.mattress, 0, top + 0.07, 0);
      for (const sx of [-0.3, 0.3]) for (const sz of [-0.85, 0.85]) {
        box(g, 0.04, top, 0.04, M.metal, sx, top / 2, sz);
        cyl(g, 0.06, 0.04, M.rubber, sx, 0.06, sz, 'x', 10);
      }
      box(g, 0.04, 0.04, 1.8, M.metal, -0.3, 0.25, 0);
      box(g, 0.04, 0.04, 1.8, M.metal, 0.3, 0.25, 0);
      if (rng.chance(0.6)) {
        const bag = new THREE.Mesh(new THREE.CapsuleGeometry(0.24, 1.2, 6, 12), M.rubber);
        bag.rotation.x = Math.PI / 2;
        bag.scale.set(1, 1, 0.6);
        bag.position.set(0, top + 0.24, 0);
        bag.castShadow = true;
        g.add(bag);
      } else {
        box(g, 0.66, 0.02, 1.2, M.sheet, 0, top + 0.13, 0.2);
      }
      return { group: g, size: [0.75, 1.95], height: 1.1, freeRotate: true };
    }
    case 'b': {
      // hospital bed, head against the wall
      box(g, 0.98, 0.12, 2.05, M.metal, 0, 0.55, 0.05);
      box(g, 0.92, 0.16, 1.95, M.mattress, 0, 0.68, 0.05);
      box(g, 0.94, 0.03, 1.4, M.sheet, 0, 0.77, 0.35);
      box(g, 0.6, 0.1, 0.35, M.sheet, 0, 0.8, -0.65);
      box(g, 1.0, 0.95, 0.06, M.paintedWhite, 0, 0.5, -0.98);
      box(g, 1.0, 0.6, 0.06, M.paintedWhite, 0, 0.35, 1.08);
      for (const sx of [-0.5, 0.5]) {
        box(g, 0.03, 0.22, 0.9, M.metal, sx, 0.82, -0.2);
        for (const sz of [-0.85, 0.95]) cyl(g, 0.06, 0.05, M.rubber, sx * 0.85, 0.06, sz, 'x', 10);
        box(g, 0.05, 0.45, 0.05, M.metal, sx * 0.85, 0.3, 0);
      }
      // IV stand
      cyl(g, 0.012, 1.9, M.metal, 0.62, 0.95, -0.7);
      box(g, 0.12, 0.2, 0.03, M.plastic, 0.62, 1.78, -0.7);
      return { group: g, size: [1.1, 2.1], height: 1 };
    }
    case 'c': {
      box(g, 0.9, 1.9, 0.5, M.paintedGreen, 0, 0.95, 0);
      box(g, 0.01, 1.8, 0.01, M.rubber, 0, 0.95, 0.255);
      box(g, 0.03, 0.18, 0.03, M.metal, -0.06, 1.0, 0.27);
      box(g, 0.03, 0.18, 0.03, M.metal, 0.06, 1.0, 0.27);
      if (rng.chance(0.5)) box(g, 0.5, 0.25, 0.35, M.cardboard, 0.1, 2.02, 0);
      g.position.z = -0.7;
      const outer = new THREE.Group();
      outer.add(g);
      return { group: outer, size: [0.9, 0.5], height: 1.9 };
    }
    case 't': {
      box(g, 1.5, 0.05, 0.75, M.paintedWhite, 0, 0.74, 0);
      box(g, 0.05, 0.72, 0.7, M.darkMetal, -0.7, 0.36, 0);
      box(g, 0.05, 0.72, 0.7, M.darkMetal, 0.7, 0.36, 0);
      box(g, 0.4, 0.6, 0.65, M.darkMetal, 0.48, 0.38, 0);
      const on = rng.chance(0.4);
      box(g, 0.52, 0.34, 0.04, M.rubber, -0.2, 1.0, -0.15);
      box(g, 0.48, 0.3, 0.01, on ? M.screen : M.rubber, -0.2, 1.0, -0.125);
      box(g, 0.05, 0.12, 0.05, M.rubber, -0.2, 0.8, -0.15);
      box(g, 0.42, 0.02, 0.14, M.plastic, -0.2, 0.775, 0.12);
      for (let i = 0; i < 4; i++) box(g, 0.21, 0.004, 0.3, M.sheet, rng.range(0.1, 0.5), 0.77 + i * 0.004, rng.range(-0.1, 0.2), rng.range(-0.5, 0.5));
      return { group: g, size: [1.5, 0.78], height: 1.1 };
    }
    case 'k': {
      const n = rng.int(2, 4);
      let y = 0;
      for (let i = 0; i < n; i++) {
        const w = rng.range(0.5, 0.9);
        const h = rng.range(0.35, 0.6);
        const d = rng.range(0.45, 0.8);
        const b = box(g, w, h, d, i === 0 && rng.chance(0.3) ? M.wood : M.cardboard, rng.range(-0.15, 0.15), y + h / 2, rng.range(-0.15, 0.15), rng.range(-0.3, 0.3));
        b.userData.tape = true;
        y += h;
        if (y > 1.4) break;
      }
      if (rng.chance(0.5)) box(g, 0.6, rng.range(0.3, 0.5), 0.5, M.cardboard, 0.55, 0.22, 0.4, rng.range(0, 1));
      return { group: g, size: [1.3, 1.3], height: y, freeRotate: true };
    }
    case 's': {
      for (const sx of [-0.88, 0.88]) for (const sz of [-0.22, 0.22]) box(g, 0.04, 2.0, 0.04, M.metal, sx, 1.0, sz);
      for (let i = 0; i < 4; i++) {
        const y = 0.12 + i * 0.6;
        box(g, 1.8, 0.03, 0.48, M.metal, 0, y, 0);
        let x = -0.8;
        while (x < 0.7) {
          const w = rng.range(0.2, 0.45);
          if (rng.chance(0.75)) box(g, w * 0.9, rng.range(0.15, 0.4), 0.38, rng.chance(0.7) ? M.cardboard : M.plastic, x + w / 2, y + 0.12, 0);
          x += w;
        }
      }
      g.position.z = -0.65;
      const outer = new THREE.Group();
      outer.add(g);
      return { group: outer, size: [1.9, 0.55], height: 2 };
    }
    case 'm': {
      // morgue cold chamber bank
      box(g, 2.0, 2.3, 0.85, M.steel, 0, 1.15, 0);
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 2; c++) {
          const x = -0.48 + c * 0.96;
          const y = 0.45 + r * 0.72;
          box(g, 0.86, 0.62, 0.04, M.metal, x, y, 0.44);
          box(g, 0.18, 0.04, 0.05, M.darkMetal, x + 0.25, y, 0.48);
          box(g, 0.12, 0.08, 0.01, M.sheet, x - 0.25, y + 0.18, 0.465);
        }
      }
      g.position.z = -0.55;
      const outer = new THREE.Group();
      outer.add(g);
      return { group: outer, size: [2.0, 0.9], height: 2.3 };
    }
    case 'o': {
      const mat = rng.chance(0.5) ? M.rust : M.paintedGreen;
      cyl(g, 0.3, 0.9, mat, -0.2, 0.45, 0, 'y', 18);
      if (rng.chance(0.6)) cyl(g, 0.3, 0.9, mat, 0.42, 0.45, 0.2, 'y', 18);
      else {
        const d = cyl(g, 0.3, 0.9, mat, 0.45, 0.3, 0.2, 'x', 18);
        d.rotation.y = 0.4;
      }
      return { group: g, size: [1.3, 0.9], height: 0.9, freeRotate: true };
    }
    case 'p': {
      // boiler: horizontal tank on saddles with riser to ceiling
      cyl(g, 0.75, 1.8, M.paintedGreen, 0, 1.0, 0, 'z', 24);
      cyl(g, 0.76, 0.06, M.darkMetal, 0, 1.0, 0.6, 'z', 24);
      cyl(g, 0.76, 0.06, M.darkMetal, 0, 1.0, -0.6, 'z', 24);
      box(g, 1.2, 0.3, 0.2, M.darkMetal, 0, 0.15, 0.6);
      box(g, 1.2, 0.3, 0.2, M.darkMetal, 0, 0.15, -0.6);
      cyl(g, 0.12, 1.6, M.rust, 0.3, 2.4, 0.2, 'y', 12);
      cyl(g, 0.09, 1.9, M.rust, -0.5, 2.9, 0, 'z', 12);
      cyl(g, 0.1, 0.06, M.paintedWhite, 0.55, 1.4, 0.75, 'z', 16);
      return { group: g, size: [1.6, 1.9], height: 1.8 };
    }
    case 'l': {
      box(g, 1.9, 0.86, 0.8, M.paintedWhite, 0, 0.43, 0);
      box(g, 1.95, 0.04, 0.85, M.rubber, 0, 0.88, 0);
      box(g, 1.9, 0.6, 0.25, M.paintedWhite, 0, 1.4, -0.3);
      box(g, 1.9, 0.03, 0.3, M.paintedWhite, 0, 1.25, -0.27);
      for (let i = 0; i < 6; i++) {
        const glass = cyl(g, rng.range(0.03, 0.06), rng.range(0.1, 0.25), M.glass, rng.range(-0.8, 0.8), 0.98, rng.range(-0.1, 0.25), 'y', 10);
        glass.castShadow = false;
      }
      box(g, 0.25, 0.35, 0.3, M.plastic, -0.6, 1.07, 0.05);
      box(g, 0.35, 0.22, 0.32, M.paintedWhite, 0.55, 1.0, 0.05);
      return { group: g, size: [1.95, 0.85], height: 1.7 };
    }
    case 'f': {
      box(g, 1.6, 0.9, 0.8, M.paintedWhite, 0, 0.45, 0);
      box(g, 1.6, 0.12, 0.8, M.paintedWhite, 0, 2.2, 0);
      box(g, 0.08, 1.3, 0.8, M.paintedWhite, -0.76, 1.55, 0);
      box(g, 0.08, 1.3, 0.8, M.paintedWhite, 0.76, 1.55, 0);
      box(g, 1.44, 1.3, 0.04, M.darkMetal, 0, 1.55, -0.38);
      const sash = box(g, 1.44, 0.7, 0.02, M.glass, 0, 1.75, 0.38);
      sash.castShadow = false;
      box(g, 1.3, 0.04, 0.1, M.fixture, 0, 2.1, -0.1);
      g.position.z = -0.55;
      const outer = new THREE.Group();
      outer.add(g);
      return { group: outer, size: [1.6, 0.85], height: 2.3 };
    }
    case 'v': {
      box(g, 0.95, 1.9, 0.8, M.darkMetal, 0, 0.95, 0);
      const lit = rng.chance(0.6);
      const front = new THREE.MeshStandardMaterial({ color: '#1a2422', emissive: lit ? '#8fd0c0' : '#000', emissiveIntensity: lit ? 0.45 : 0, roughness: 0.2 });
      box(g, 0.62, 1.3, 0.02, front, -0.1, 1.15, 0.41);
      box(g, 0.2, 0.5, 0.02, M.rubber, 0.33, 1.3, 0.41);
      box(g, 0.6, 0.15, 0.04, M.rubber, -0.1, 0.3, 0.41);
      g.position.z = -0.5;
      const outer = new THREE.Group();
      outer.add(g);
      return { group: outer, size: [0.95, 0.8], height: 1.9 };
    }
    case 'r': {
      box(g, 1.9, 0.06, 0.06, M.darkMetal, 0, 0.38, 0);
      for (let i = 0; i < 3; i++) {
        const x = -0.62 + i * 0.62;
        const knocked = rng.chance(0.15);
        const seat = new THREE.Group();
        box(seat, 0.5, 0.05, 0.46, M.paintedGreen, 0, 0.45, 0);
        box(seat, 0.5, 0.45, 0.05, M.paintedGreen, 0, 0.7, -0.22);
        seat.position.x = x;
        if (knocked) seat.rotation.z = 0.08;
        g.add(seat);
      }
      for (const x of [-0.85, 0.85]) box(g, 0.05, 0.4, 0.4, M.darkMetal, x, 0.2, 0);
      return { group: g, size: [1.9, 0.6], height: 0.95 };
    }
    case 'q': {
      box(g, 1.2, 1.5, 1.0, M.paintedWhite, 0, 0.75, 0);
      cyl(g, 0.38, 0.08, M.steel, 0, 0.85, 0.52, 'z', 24);
      const glass = cyl(g, 0.3, 0.02, M.glass, 0, 0.85, 0.57, 'z', 24);
      glass.castShadow = false;
      box(g, 1.0, 0.18, 0.04, M.darkMetal, 0, 1.38, 0.5);
      box(g, 0.08, 0.04, 0.02, M.amberLamp, 0.35, 1.38, 0.53);
      g.position.z = -0.35;
      const outer = new THREE.Group();
      outer.add(g);
      return { group: outer, size: [1.2, 1.0], height: 1.5 };
    }
    case 'w': {
      box(g, 1.9, 0.08, 0.85, M.wood, 0, 0.9, 0);
      for (const sx of [-0.88, 0.88]) for (const sz of [-0.35, 0.35]) box(g, 0.07, 0.88, 0.07, M.darkMetal, sx, 0.44, sz);
      box(g, 1.8, 0.04, 0.75, M.darkMetal, 0, 0.25, 0);
      box(g, 1.9, 1.1, 0.04, M.darkMetal, 0, 1.5, -0.4);
      box(g, 0.18, 0.12, 0.25, M.paintedGreen, 0.7, 1.0, 0.1);
      for (let i = 0; i < 5; i++) box(g, 0.03, rng.range(0.15, 0.3), 0.03, M.metal, -0.7 + i * 0.12, 1.5, -0.37);
      box(g, 0.4, 0.06, 0.2, M.rust, -0.2, 0.97, 0.1, rng.range(-0.4, 0.4));
      return { group: g, size: [1.95, 0.9], height: 1.8 };
    }
    case 'x': {
      // lab station: bench, centrifuge, analyser screen
      box(g, 1.9, 0.9, 0.8, M.paintedWhite, 0, 0.45, 0);
      box(g, 1.95, 0.04, 0.85, M.rubber, 0, 0.92, 0);
      const cent = cyl(g, 0.24, 0.3, M.plastic, -0.5, 1.09, 0.05, 'y', 20);
      cyl(g, 0.2, 0.02, M.glass, -0.5, 1.25, 0.05, 'y', 20);
      box(g, 0.62, 0.42, 0.06, M.rubber, 0.35, 1.25, -0.25);
      const scr = box(g, 0.56, 0.36, 0.01, M.screenViolet, 0.35, 1.25, -0.215);
      box(g, 0.1, 0.06, 0.02, M.violetGlow, -0.5, 0.95, 0.42);
      for (let i = 0; i < 5; i++) cyl(g, 0.016, 0.12, M.violetGlow, 0.05 + i * 0.05, 1.0, 0.18, 'y', 6);
      return { group: g, size: [1.95, 0.85], height: 1.5, dynamic: true, parts: { screen: scr, centrifuge: cent } };
    }
    case 'y': {
      // the synthesiser: reactor column in a frame
      box(g, 1.8, 0.5, 1.8, M.darkMetal, 0, 0.25, 0);
      box(g, 1.8, 0.4, 1.8, M.darkMetal, 0, 2.3, 0);
      for (const sx of [-0.8, 0.8]) for (const sz of [-0.8, 0.8]) box(g, 0.12, 1.6, 0.12, M.steel, sx, 1.3, sz);
      const col = cyl(g, 0.48, 1.55, M.glass, 0, 1.3, 0, 'y', 28);
      col.castShadow = false;
      const liquidMat = new THREE.MeshStandardMaterial({ color: '#5a3cc0', emissive: '#a98bff', emissiveIntensity: 1.2, roughness: 0.2, transparent: true, opacity: 0.85 });
      const liquid = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 1, 24), liquidMat);
      liquid.position.y = 0.55;
      liquid.scale.y = 0.05;
      g.add(liquid);
      box(g, 0.9, 0.6, 0.08, M.rubber, 0, 1.15, 0.92);
      const scr = box(g, 0.8, 0.5, 0.01, M.screenViolet, 0, 1.15, 0.965);
      const lampMat = M.amberLamp.clone();
      const lamp = box(g, 0.16, 0.08, 0.08, lampMat, 0.5, 2.0, 0.9);
      for (let i = 0; i < 4; i++) cyl(g, 0.04, 1.2, M.rubber, -0.7 + i * 0.12, 2.9, -0.6, 'y', 8);
      return { group: g, size: [1.9, 1.9], height: 2.5, dynamic: true, parts: { liquid, screen: scr, lamp } };
    }
    default:
      return null;
  }
}

export function buildTerminal(prop: 'generator' | 'console' | 'airlock'): PropBuild {
  const M = materials();
  const g = new THREE.Group();
  const lampMat = new THREE.MeshStandardMaterial({ color: '#e2442e', emissive: '#e2442e', emissiveIntensity: 2.5 });
  if (prop === 'generator') {
    box(g, 2.0, 0.2, 1.1, M.darkMetal, 0, 0.1, 0);
    box(g, 1.9, 1.3, 1.0, M.paintedGreen, 0, 0.85, 0);
    for (let i = 0; i < 8; i++) box(g, 0.02, 0.8, 0.9, M.darkMetal, -0.5 + i * 0.06, 0.95, 0);
    cyl(g, 0.11, 1.8, M.rust, 0.7, 2.3, -0.3);
    box(g, 0.6, 0.5, 0.06, M.darkMetal, 0.45, 1.05, 0.53);
    const lamp = box(g, 0.08, 0.08, 0.04, lampMat, 0.3, 1.2, 0.57);
    box(g, 0.22, 0.1, 0.05, M.metal, 0.55, 0.95, 0.57);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.22), new THREE.MeshStandardMaterial({ map: signTexture('GEN-2', { bg: '#c9a227', fg: '#111', size: 70, w: 512, h: 128 }), roughness: 0.6 }));
    sign.position.set(-0.4, 1.3, 0.505);
    g.add(sign);
    return { group: g, size: [2.0, 1.1], height: 1.5, dynamic: true, parts: { lamp } };
  }
  if (prop === 'console') {
    box(g, 1.9, 0.95, 0.8, M.paintedWhite, 0, 0.47, 0);
    box(g, 1.95, 0.04, 0.85, M.rubber, 0, 0.96, 0);
    box(g, 0.7, 0.45, 0.05, M.rubber, -0.4, 1.3, -0.2);
    box(g, 0.64, 0.38, 0.01, M.screen, -0.4, 1.3, -0.17);
    box(g, 0.5, 0.35, 0.05, M.rubber, 0.45, 1.25, -0.2);
    const scr = box(g, 0.44, 0.3, 0.01, M.screenViolet, 0.45, 1.25, -0.17);
    const lamp = box(g, 0.12, 0.04, 0.12, lampMat, 0.8, 1.0, 0.2);
    return { group: g, size: [1.95, 0.85], height: 1.5, dynamic: true, parts: { lamp, screen: scr } };
  }
  // airlock panel mounted on the wall
  box(g, 0.8, 1.2, 0.15, M.darkMetal, 0, 1.4, -0.9);
  box(g, 0.6, 0.4, 0.02, M.screen, 0, 1.6, -0.82);
  const lamp = box(g, 0.5, 0.06, 0.04, lampMat, 0, 1.92, -0.82);
  box(g, 0.06, 0.3, 0.06, M.steel, 0.25, 1.1, -0.78);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.28), new THREE.MeshStandardMaterial({ map: signTexture('BSL-3', { bg: '#e8e2d0', fg: '#8c1c10', size: 70, w: 512, h: 128, sub: 'Biohazard containment' }), roughness: 0.6 }));
  sign.position.set(0, 2.35, -0.83);
  g.add(sign);
  return { group: g, size: [0.8, 0.3], height: 2, dynamic: true, parts: { lamp } };
}

/** Elevator / stair doors with a sign, mounted on the wall face. Local +Z faces the room. */
export function buildExit(label: string, sub: string): { group: THREE.Group; lamp: THREE.Mesh } {
  const M = materials();
  const g = new THREE.Group();
  box(g, 2.0, 2.6, 0.12, M.darkMetal, 0, 1.3, 0);
  box(g, 0.86, 2.3, 0.06, M.steel, -0.44, 1.15, 0.07);
  box(g, 0.86, 2.3, 0.06, M.steel, 0.44, 1.15, 0.07);
  box(g, 0.01, 2.3, 0.07, M.rubber, 0, 1.15, 0.08);
  const lampMat = new THREE.MeshStandardMaterial({ color: '#e2442e', emissive: '#e2442e', emissiveIntensity: 2.5 });
  const lamp = box(g, 0.3, 0.07, 0.05, lampMat, 0, 2.48, 0.08);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.38), new THREE.MeshStandardMaterial({ map: signTexture(label, { bg: '#1b2422', fg: '#e7e9e2', size: 58, w: 640, h: 152, sub }), roughness: 0.6, emissive: '#ffffff', emissiveIntensity: 0.05 }));
  sign.position.set(0, 2.85, 0.08);
  g.add(sign);
  return { group: g, lamp };
}

/** Swing door leaf (hinge at local origin, leaf extends along +X). */
export function buildDoorLeaf(width: number, locked: boolean) {
  const M = materials();
  const g = new THREE.Group();
  const mat = locked ? M.doorLocked : M.door;
  box(g, width, 2.3, 0.06, mat, width / 2, 1.15, 0);
  // vision panel and kick plate
  const glass = box(g, 0.32, 0.6, 0.07, M.glass, width * 0.68, 1.55, 0);
  glass.castShadow = false;
  box(g, width * 0.9, 0.25, 0.07, M.steel, width / 2, 0.15, 0);
  box(g, 0.05, 0.05, 0.25, M.metal, width - 0.15, 1.05, 0);
  return g;
}

/** Roll-up security shutter (slides on Y). */
export function buildShutter(width: number) {
  const M = materials();
  const g = new THREE.Group();
  for (let i = 0; i < 14; i++) box(g, width, 0.16, 0.06, M.doorLocked, 0, 0.08 + i * 0.165, 0);
  const stripe = new THREE.MeshStandardMaterial({ color: '#f3b03b', roughness: 0.6 });
  box(g, width, 0.08, 0.07, stripe, 0, 0.05, 0);
  return g;
}
