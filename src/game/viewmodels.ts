import * as THREE from 'three';
import type { WeaponId } from '../data/weapons';
import { brushedMetal, muzzleFlashTexture } from '../world/textures';

/**
 * First-person weapon models built from primitives. Each model points down -Z with the sight line
 * on the local Y axis at `sightY`, so ADS alignment is a pure offset.
 */
export interface ViewModel {
  id: WeaponId;
  root: THREE.Group;
  /** sub-group that recoil/reload animations act on */
  gun: THREE.Group;
  muzzle: THREE.Object3D;
  flash: THREE.Mesh | null;
  mag: THREE.Object3D | null;
  slide: THREE.Object3D | null;
  pump: THREE.Object3D | null;
  leftHand: THREE.Object3D;
  hip: THREE.Vector3;
  ads: THREE.Vector3;
  /** dmr uses a full-screen scope overlay instead of the model when fully aimed */
  scoped?: boolean;
}

interface Mats {
  gunmetal: THREE.MeshStandardMaterial;
  polymer: THREE.MeshStandardMaterial;
  steel: THREE.MeshStandardMaterial;
  glove: THREE.MeshStandardMaterial;
  sleeve: THREE.MeshStandardMaterial;
  skin: THREE.MeshStandardMaterial;
  red: THREE.MeshStandardMaterial;
  yellow: THREE.MeshStandardMaterial;
  dot: THREE.MeshBasicMaterial;
  lens: THREE.MeshStandardMaterial;
  flash: THREE.MeshBasicMaterial;
  brass: THREE.MeshStandardMaterial;
  rubber: THREE.MeshStandardMaterial;
}

let M: Mats | null = null;
function mats(): Mats {
  if (M) return M;
  const gm = brushedMetal(401, '#2a2f31');
  M = {
    gunmetal: new THREE.MeshStandardMaterial({ map: gm.map, normalMap: gm.normal, color: '#c4ccce', roughness: 0.38, metalness: 0.6 }),
    polymer: new THREE.MeshStandardMaterial({ color: '#2a2e30', roughness: 0.62, metalness: 0.05 }),
    steel: new THREE.MeshStandardMaterial({ color: '#8f989a', roughness: 0.3, metalness: 0.9 }),
    glove: new THREE.MeshStandardMaterial({ color: '#23272a', roughness: 0.85 }),
    sleeve: new THREE.MeshStandardMaterial({ color: '#3a4238', roughness: 0.95 }),
    skin: new THREE.MeshStandardMaterial({ color: '#b08a72', roughness: 0.7 }),
    red: new THREE.MeshStandardMaterial({ color: '#9e1d14', roughness: 0.45, metalness: 0.3 }),
    yellow: new THREE.MeshStandardMaterial({ color: '#c9a227', roughness: 0.55 }),
    dot: new THREE.MeshBasicMaterial({ color: '#ff3020' }),
    lens: new THREE.MeshStandardMaterial({ color: '#3a6a60', roughness: 0.05, metalness: 0.6, transparent: true, opacity: 0.35 }),
    flash: new THREE.MeshBasicMaterial({ map: muzzleFlashTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, color: '#ffffff' }),
    brass: new THREE.MeshStandardMaterial({ color: '#b08d3a', roughness: 0.35, metalness: 0.9 }),
    rubber: new THREE.MeshStandardMaterial({ color: '#111314', roughness: 0.95 }),
  };
  return M;
}

function b(parent: THREE.Object3D, w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  parent.add(m);
  return m;
}
function c(parent: THREE.Object3D, r: number, len: number, mat: THREE.Material, x: number, y: number, z: number, seg = 14, r2 = r) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r2, len, seg), mat);
  m.rotation.x = Math.PI / 2;
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

/** Gloved hand with forearm/sleeve, pointing along -Z from the wrist. */
function hand(parent: THREE.Object3D, x: number, y: number, z: number, rx: number, ry: number, rz: number, left: boolean) {
  const m = mats();
  const g = new THREE.Group();
  g.userData.hand = true;
  g.position.set(x, y, z);
  g.rotation.set(rx, ry, rz);
  b(g, 0.085, 0.045, 0.1, m.glove, 0, 0, -0.04);
  // fingers wrap
  b(g, 0.08, 0.03, 0.05, m.glove, 0, -0.03, -0.085, 0.6, 0, 0);
  b(g, 0.025, 0.03, 0.06, m.glove, left ? 0.05 : -0.05, 0.01, -0.06, 0, left ? -0.5 : 0.5, 0);
  // wrist + forearm in sleeve
  const fore = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.36, 12), m.sleeve);
  fore.rotation.x = Math.PI / 2;
  fore.position.set(0, -0.005, 0.18);
  g.add(fore);
  const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.04, 12), m.skin);
  cuff.rotation.x = Math.PI / 2;
  cuff.position.set(0, -0.003, 0.01);
  g.add(cuff);
  parent.add(g);
  return g;
}

function flashQuad(parent: THREE.Object3D, z: number, size: number) {
  const f = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mats().flash);
  f.position.z = z;
  f.visible = false;
  parent.add(f);
  // a second crossed plane so the flash reads from the side
  const side = new THREE.Mesh(new THREE.PlaneGeometry(size * 1.6, size * 0.6), mats().flash);
  side.rotation.y = Math.PI / 2;
  side.position.z = -size * 0.4;
  f.add(side);
  return f;
}

export function buildViewModel(id: WeaponId): ViewModel {
  const m = mats();
  const root = new THREE.Group();
  const gun = new THREE.Group();
  root.add(gun);
  const muzzle = new THREE.Object3D();
  let flash: THREE.Mesh | null = null;
  let mag: THREE.Object3D | null = null;
  let slide: THREE.Object3D | null = null;
  let pump: THREE.Object3D | null = null;
  let leftHand: THREE.Object3D;
  let hip = new THREE.Vector3(0.15, -0.16, -0.36);
  let ads = new THREE.Vector3(0, -0.06, -0.26);
  let scoped = false;

  switch (id) {
    case 'axe': {
      // held low on the right, head up and away; the hand grips near the bottom of the haft
      const handle = new THREE.Group();
      gun.add(handle);
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.019, 0.8, 10), m.yellow);
      shaft.position.y = 0.32;
      handle.add(shaft);
      for (let i = 0; i < 4; i++) b(handle, 0.042, 0.012, 0.042, m.polymer, 0, -0.04 + i * 0.025, 0);
      const head = new THREE.Group();
      head.position.y = 0.7;
      handle.add(head);
      b(head, 0.034, 0.09, 0.15, m.red, 0, 0, -0.02);
      b(head, 0.01, 0.14, 0.09, m.steel, 0, 0, -0.13);
      b(head, 0.022, 0.045, 0.13, m.red, 0, 0.01, 0.11, 0.3, 0, 0);
      b(head, 0.01, 0.02, 0.03, m.steel, 0, 0.03, 0.17, 0.3, 0, 0);
      handle.rotation.set(-0.62, 0, 0.16);
      hand(gun, 0.0, 0.0, 0.01, -0.62 + Math.PI / 2 - 1.2, 0, 0.1, false);
      leftHand = new THREE.Object3D();
      hip = new THREE.Vector3(0.27, -0.4, -0.5);
      ads = hip.clone();
      muzzle.position.set(0, 0.6, -0.4);
      break;
    }
    case 'pistol': {
      slide = new THREE.Group();
      gun.add(slide);
      b(slide, 0.03, 0.034, 0.19, m.gunmetal, 0, 0.02, -0.08);
      b(slide, 0.006, 0.01, 0.01, m.steel, 0, 0.042, -0.165);
      b(slide, 0.02, 0.01, 0.01, m.steel, 0, 0.042, 0.005);
      for (let i = 0; i < 6; i++) b(slide, 0.031, 0.026, 0.003, m.polymer, 0, 0.02, -0.005 - i * 0.008);
      c(gun, 0.008, 0.02, m.steel, 0, 0.022, -0.18);
      b(gun, 0.028, 0.03, 0.16, m.polymer, 0, -0.008, -0.065);
      b(gun, 0.028, 0.11, 0.045, m.polymer, 0, -0.07, 0.0, -0.28);
      b(gun, 0.006, 0.02, 0.03, m.polymer, 0, -0.03, -0.04);
      mag = b(gun, 0.022, 0.03, 0.035, m.gunmetal, 0, -0.13, 0.016, -0.28);
      hand(gun, 0.0, -0.065, 0.02, -0.25, 0, 0, false);
      leftHand = hand(gun, -0.035, -0.07, 0.0, -0.2, 0.35, -0.5, true);
      muzzle.position.set(0, 0.022, -0.2);
      flash = flashQuad(muzzle, -0.03, 0.12);
      hip = new THREE.Vector3(0.15, -0.17, -0.44);
      ads = new THREE.Vector3(0, -0.042, -0.36);
      break;
    }
    case 'smg': {
      b(gun, 0.042, 0.06, 0.28, m.gunmetal, 0, 0, -0.08);
      c(gun, 0.012, 0.12, m.steel, 0, 0.005, -0.27);
      c(gun, 0.02, 0.06, m.polymer, 0, 0.005, -0.32);
      b(gun, 0.04, 0.045, 0.12, m.polymer, 0, -0.03, -0.17);
      b(gun, 0.032, 0.1, 0.04, m.polymer, 0, -0.07, 0.02, -0.25);
      b(gun, 0.02, 0.02, 0.2, m.steel, 0, 0.0, 0.16);
      b(gun, 0.03, 0.06, 0.02, m.polymer, 0, -0.01, 0.26);
      b(gun, 0.01, 0.02, 0.012, m.steel, 0, 0.04, -0.2);
      b(gun, 0.022, 0.022, 0.012, m.steel, 0, 0.04, 0.04);
      mag = b(gun, 0.025, 0.16, 0.035, m.gunmetal, 0, -0.1, -0.07, 0.08);
      hand(gun, 0.0, -0.06, 0.04, -0.2, 0, 0, false);
      leftHand = hand(gun, -0.01, -0.06, -0.17, 0.05, 0.25, -0.9, true);
      muzzle.position.set(0, 0.005, -0.35);
      flash = flashQuad(muzzle, -0.02, 0.14);
      hip = new THREE.Vector3(0.16, -0.18, -0.46);
      ads = new THREE.Vector3(0, -0.04, -0.3);
      break;
    }
    case 'rifle': {
      // Warden AR-4
      b(gun, 0.044, 0.05, 0.24, m.gunmetal, 0, 0, -0.04);
      b(gun, 0.04, 0.045, 0.2, m.gunmetal, 0, -0.04, -0.02);
      b(gun, 0.05, 0.055, 0.26, m.polymer, 0, -0.002, -0.29);
      for (let i = 0; i < 9; i++) b(gun, 0.016, 0.006, 0.012, m.gunmetal, 0, 0.03, -0.18 - i * 0.026);
      for (let i = 0; i < 9; i++) b(gun, 0.012, 0.006, 0.012, m.gunmetal, 0, 0.03, -0.1 + i * 0.022);
      c(gun, 0.011, 0.2, m.steel, 0, 0, -0.5);
      c(gun, 0.017, 0.06, m.gunmetal, 0, 0, -0.62);
      b(gun, 0.032, 0.1, 0.04, m.polymer, 0, -0.08, 0.06, -0.3);
      b(gun, 0.022, 0.03, 0.18, m.polymer, 0, -0.01, 0.2);
      b(gun, 0.042, 0.075, 0.14, m.polymer, 0, -0.015, 0.33);
      b(gun, 0.044, 0.09, 0.02, m.rubber, 0, -0.02, 0.405);
      mag = new THREE.Group();
      gun.add(mag);
      b(mag, 0.026, 0.16, 0.06, m.gunmetal, 0, -0.1, -0.06, 0.18);
      b(mag, 0.028, 0.02, 0.064, m.polymer, 0, -0.18, -0.045, 0.18);
      // red dot
      b(gun, 0.034, 0.012, 0.07, m.gunmetal, 0, 0.032, -0.05);
      const housing = c(gun, 0.022, 0.065, m.polymer, 0, 0.058, -0.05, 16);
      housing.scale.set(1, 1, 1);
      const lens = new THREE.Mesh(new THREE.CircleGeometry(0.018, 20), m.lens);
      lens.position.set(0, 0.058, -0.083);
      gun.add(lens);
      const dot = new THREE.Mesh(new THREE.CircleGeometry(0.0012, 8), m.dot);
      dot.position.set(0, 0.058, -0.09);
      gun.add(dot);
      b(gun, 0.008, 0.012, 0.01, m.steel, 0, 0.038, -0.4);
      hand(gun, 0.0, -0.07, 0.07, -0.3, 0, 0, false);
      leftHand = hand(gun, -0.012, -0.05, -0.3, 0.05, 0.2, -1.1, true);
      muzzle.position.set(0, 0, -0.66);
      flash = flashQuad(muzzle, -0.02, 0.18);
      hip = new THREE.Vector3(0.17, -0.19, -0.5);
      ads = new THREE.Vector3(0, -0.058, -0.32);
      break;
    }
    case 'shotgun': {
      b(gun, 0.046, 0.065, 0.22, m.gunmetal, 0, 0, -0.04);
      c(gun, 0.014, 0.52, m.gunmetal, 0, 0.018, -0.4);
      c(gun, 0.013, 0.44, m.gunmetal, 0, -0.016, -0.36);
      pump = new THREE.Group();
      gun.add(pump);
      const fore = c(pump, 0.025, 0.17, m.polymer, 0, -0.016, -0.3);
      for (let i = 0; i < 6; i++) c(pump, 0.026, 0.006, m.gunmetal, 0, -0.016, -0.24 - i * 0.025);
      fore.scale.set(1, 1, 1.05);
      b(gun, 0.032, 0.1, 0.04, m.polymer, 0, -0.07, 0.06, -0.35);
      b(gun, 0.042, 0.075, 0.24, m.polymer, 0, -0.03, 0.22, 0.1);
      b(gun, 0.008, 0.008, 0.01, m.steel, 0, 0.03, -0.65);
      b(gun, 0.006, 0.01, 0.012, m.steel, 0, 0.038, 0.02);
      hand(gun, 0.0, -0.07, 0.07, -0.3, 0, 0, false);
      leftHand = hand(pump, -0.01, -0.06, -0.3, 0.05, 0.2, -1.1, true);
      muzzle.position.set(0, 0.018, -0.67);
      flash = flashQuad(muzzle, -0.03, 0.26);
      hip = new THREE.Vector3(0.17, -0.19, -0.48);
      ads = new THREE.Vector3(0, -0.038, -0.32);
      break;
    }
    case 'dmr': {
      b(gun, 0.046, 0.06, 0.3, m.gunmetal, 0, 0, -0.06);
      b(gun, 0.05, 0.055, 0.3, m.polymer, 0, -0.002, -0.36);
      c(gun, 0.012, 0.28, m.steel, 0, 0, -0.65);
      c(gun, 0.02, 0.08, m.gunmetal, 0, 0, -0.8);
      b(gun, 0.032, 0.1, 0.04, m.polymer, 0, -0.08, 0.06, -0.3);
      b(gun, 0.045, 0.085, 0.3, m.polymer, 0, -0.025, 0.28);
      mag = b(gun, 0.03, 0.1, 0.06, m.gunmetal, 0, -0.08, -0.07, 0.1);
      // scope
      c(gun, 0.019, 0.28, m.polymer, 0, 0.07, -0.08);
      c(gun, 0.026, 0.07, m.polymer, 0, 0.07, -0.24, 16, 0.02);
      c(gun, 0.024, 0.05, m.polymer, 0, 0.07, 0.07, 16);
      b(gun, 0.02, 0.03, 0.02, m.gunmetal, 0, 0.045, -0.15);
      b(gun, 0.02, 0.03, 0.02, m.gunmetal, 0, 0.045, 0.0);
      const lensF = new THREE.Mesh(new THREE.CircleGeometry(0.024, 20), m.lens);
      lensF.position.set(0, 0.07, -0.276);
      gun.add(lensF);
      hand(gun, 0.0, -0.075, 0.07, -0.3, 0, 0, false);
      leftHand = hand(gun, -0.012, -0.05, -0.36, 0.05, 0.2, -1.1, true);
      muzzle.position.set(0, 0, -0.84);
      flash = flashQuad(muzzle, -0.03, 0.22);
      hip = new THREE.Vector3(0.17, -0.19, -0.52);
      ads = new THREE.Vector3(0, -0.07, -0.24);
      scoped = true;
      break;
    }
  }
  gun.add(muzzle);
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) mesh.frustumCulled = false;
  });
  return { id, root, gun, muzzle, flash, mag, slide, pump, leftHand: leftHand!, hip, ads, scoped };
}

/** World pickup version of a weapon: the viewmodel without arms. */
export function buildWorldWeapon(id: WeaponId) {
  const vm = buildViewModel(id);
  const hands: THREE.Object3D[] = [];
  vm.root.traverse((o) => {
    if (o.userData.hand) hands.push(o);
  });
  for (const h of hands) h.removeFromParent();
  vm.root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.frustumCulled = true;
      mesh.castShadow = true;
    }
  });
  return vm.root;
}
