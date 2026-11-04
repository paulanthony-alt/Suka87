import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import type { InfectedKind } from '../data/infected';
import type { WeaponId } from '../data/weapons';
import { pick, rand } from '../core/math';
import { BUMP, NOISE } from './shaderChunks';
import { buildInfectedHead, type HeadUniforms } from './infectedHead';

/**
 * Real 3D assets: one rigged humanoid (Quaternius Universal Animation Library, CC0) shared by every
 * infected and by the first-person arms, plus CC0 gun models. Everything here is optional: if a
 * file fails to load the game keeps its built-in primitive models.
 */

const GUN_FILES: Record<WeaponId, string> = {
  axe: 'models/guns/axe.gltf',
  pistol: 'models/guns/pistol.glb',
  smg: 'models/guns/smg.glb',
  rifle: 'models/guns/rifle.glb',
  shotgun: 'models/guns/shotgun.glb',
  dmr: 'models/guns/dmr.glb',
};

class Models {
  humanoid: GLTF | null = null;
  clips = new Map<string, THREE.AnimationClip>();
  guns = new Map<WeaponId, THREE.Object3D>();

  get ready() {
    return !!this.humanoid;
  }

  async load(base = 'models/') {
    const loader = new GLTFLoader();
    const human = loader.loadAsync(base + 'humanoid.glb').then(
      (g) => {
        this.humanoid = g;
        for (const c of g.animations) this.clips.set(c.name, prepareClip(c));
      },
      (e) => console.warn('3D humanoid unavailable, using built-in models', e),
    );
    const guns = (Object.keys(GUN_FILES) as WeaponId[]).map((id) =>
      loader.loadAsync(GUN_FILES[id].replace('models/', base)).then(
        (g) => void this.guns.set(id, g.scene),
        (e) => console.warn(`3D ${id} unavailable`, e),
      ),
    );
    await Promise.all([human, ...guns]);
  }
}

export const models = new Models();

/** Keep loops in place: drop root motion and remove the forward drift from the pelvis track. */
function prepareClip(c: THREE.AnimationClip) {
  c.tracks = c.tracks.filter((t) => !t.name.startsWith('root.'));
  const loop = c.name !== 'death' && !/^(hit|scream|scratch|punch|hook|knockback)/.test(c.name);
  for (const t of c.tracks) {
    if (t.name !== 'pelvis.position' || !loop) continue;
    const v = t.values;
    const n = t.times.length;
    if (n < 2) continue;
    const T = t.times[n - 1] - t.times[0];
    for (const axis of [0, 2]) {
      const d = v[(n - 1) * 3 + axis] - v[axis];
      for (let i = 0; i < n; i++) v[i * 3 + axis] -= (d * (t.times[i] - t.times[0])) / T;
    }
  }
  return c;
}

// ------------------------------------------------------------------ infected look

/** Body region of each bone: 0 skin, 1 top, 2 trousers, 3 shoes, 4 forearm (sleeve or skin), 5 thigh (gown or trousers). */
function boneRegion(name: string) {
  if (/^(Head|neck_01)$/.test(name)) return 0;
  if (/^(hand|index|middle|pinky|ring|thumb)/.test(name)) return 0;
  if (/^lowerarm/.test(name)) return 4;
  if (/^(spine|clavicle|upperarm)/.test(name)) return 1;
  if (/^(pelvis|root)$/.test(name)) return 2;
  if (/^thigh/.test(name)) return 5;
  if (/^calf/.test(name)) return 2;
  if (/^(foot|ball)/.test(name)) return 3;
  return 1;
}

/** Shared so one call re-tints every infected as the strain mutates. */
const mutation = { value: 0.3 };
export function setModelMutation(level: number) {
  mutation.value = 0.15 + level * 0.9;
}

interface Look {
  skin: string;
  top: string;
  bottom: string;
  shoes: string;
  sleeve: boolean;
  gown: boolean;
  hair: number;
  hairCol: string;
  blood: number;
}

const SKINS = ['#7d8270', '#857a68', '#6f7766', '#8a7f70', '#767c6c'];
const HAIR = ['#1c1a17', '#2b2219', '#4a3a2a', '#151414', '#6b6156'];

function lookFor(kind: InfectedKind, boss: boolean): Look {
  const skin = pick(SKINS);
  const base = { skin, hair: rand() < 0.75 ? 1 : 0, hairCol: pick(HAIR), blood: rand(0.6, 1) };
  const gown = { ...base, top: pick(['#6c8796', '#7f98a3', '#8a9a9c']), bottom: '', shoes: '#5a5548', sleeve: false, gown: true };
  gown.bottom = gown.top;
  const scrubs = { ...base, top: pick(['#3f6f78', '#4b6a8a', '#5b7d6a']), bottom: '', shoes: '#c8c8c0', sleeve: false, gown: false };
  scrubs.bottom = scrubs.top;
  const civ = { ...base, top: pick(['#6b5a48', '#9a9e98', '#5a3a36', '#34404a', '#7a6a3a']), bottom: pick(['#2c3236', '#3a3a44', '#4a4234']), shoes: '#2a2420', sleeve: rand() < 0.5, gown: false };
  const guard = { ...base, top: '#2b3340', bottom: '#1f2328', shoes: '#151515', sleeve: true, gown: false, hair: 0.4 };
  if (boss) return { ...gown, blood: 1, hair: 0 };
  switch (kind) {
    case 'brute':
      return guard;
    case 'screamer':
      return { ...gown, hair: 1, hairCol: pick(['#1c1a17', '#4a3a2a', '#8a8070']) };
    case 'runner':
      return pick([scrubs, civ]);
    case 'bloater':
      return pick([gown, civ]);
    default:
      return pick([gown, scrubs, civ, civ]);
  }
}

function infectedMaterial(bones: THREE.Bone[], look: Look, seed: number, boss: boolean) {
  const regions = new Array<number>(80).fill(1);
  bones.forEach((b, i) => (regions[i] = boneRegion(b.name)));
  const m = new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0 });
  const U = {
    uRegion: { value: regions },
    uSkin: { value: new THREE.Color(look.skin) },
    uShirt: { value: new THREE.Color(look.top) },
    uPants: { value: new THREE.Color(look.bottom) },
    uShoes: { value: new THREE.Color(look.shoes) },
    uHairCol: { value: new THREE.Color(look.hairCol) },
    uSleeve: { value: look.sleeve ? 1 : 0 },
    uGown: { value: look.gown ? 1 : 0 },
    uSeed: { value: seed },
    uBlood: { value: look.blood },
    uHair: { value: look.hair },
    uGlow: { value: boss ? 2 : 1 },
    uMut: mutation,
    uTear: { value: rand(0.4, 1) },
    uHeadJ: { value: bones.findIndex((b) => b.name === 'Head') },
  };
  m.userData.u = U;
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, U);
    s.vertexShader = s.vertexShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
uniform float uRegion[80]; uniform float uSleeve; uniform float uGown; uniform float uHeadJ;
varying vec4 vReg; varying vec3 vObj; varying float vHeadW;
vec4 regOf(float j){ float r = uRegion[int(j)];
  if (r > 3.5 && r < 4.5) r = uSleeve > 0.5 ? 1.0 : 0.0;
  if (r > 4.5) r = uGown > 0.5 ? 1.0 : 2.0;
  return vec4(r < .5 ? 1. : 0., abs(r-1.) < .5 ? 1. : 0., abs(r-2.) < .5 ? 1. : 0., abs(r-3.) < .5 ? 1. : 0.); }`,
      )
      .replace(
        '#include <skinbase_vertex>',
        /* glsl */ `#include <skinbase_vertex>
vReg = regOf(skinIndex.x)*skinWeight.x + regOf(skinIndex.y)*skinWeight.y + regOf(skinIndex.z)*skinWeight.z + regOf(skinIndex.w)*skinWeight.w;
vObj = position;
vHeadW = dot(vec4(equal(skinIndex, vec4(uHeadJ))), skinWeight);`,
      );
    s.fragmentShader = s.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
uniform vec3 uSkin, uShirt, uPants, uShoes, uHairCol; uniform float uSeed, uBlood, uHair, uGlow, uMut, uTear;
varying vec4 vReg; varying vec3 vObj; varying float vHeadW;
${NOISE}
${BUMP}`,
      )
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
// the mannequin head is replaced by the sculpted one (infectedHead.ts)
if (vHeadW > 0.5) discard;
vec4 rw = pow(max(vReg, 0.0), vec4(2.0)); rw /= max(1e-3, rw.x+rw.y+rw.z+rw.w);
vec3 P = vObj * 6.0 + uSeed;
float fab = fbm(P * 7.0);
vec3 skin = uSkin * (0.75 + 0.5 * fbm(P * 3.0));
skin = mix(skin, skin * vec3(0.55, 0.5, 0.7), smoothstep(0.55, 0.75, fbm(P * 1.7 + 3.0)));
vec3 col = skin * rw.x + uShirt * (0.8 + 0.35 * fab) * rw.y + uPants * (0.8 + 0.35 * fab) * rw.z + uShoes * (0.85 + 0.2 * fab) * rw.w;
float grime = smoothstep(0.7, 0.0, vObj.y) * (0.4 + 0.6 * fbm(P * 2.5));
col *= 1.0 - grime * 0.55;
float streak = smoothstep(0.03 + 0.03 * fbm(P * 3.0), 0.0, abs(vObj.x + 0.025 * sin(vObj.y * 30.0 + uSeed))) * smoothstep(1.66, 1.6, vObj.y) * smoothstep(1.05, 1.45, vObj.y) * smoothstep(0.0, 0.06, vObj.z + 0.02);
float splat = smoothstep(0.66, 0.78, fbm(P * 1.1 + 7.0));
float hands = rw.x * smoothstep(1.05, 1.3, abs(vObj.x)) * 0.8;
float wet = clamp(streak * 1.2 + splat + hands, 0.0, 1.0) * uBlood;
wet *= smoothstep(0.42, 0.55, fbm(P * 5.0 + 11.0) + 0.15);
col = mix(col, vec3(0.16, 0.012, 0.015), wet * 0.9);
// torn clothing: ragged holes show skin with raw, bloody wounds and frayed dark edges
float tearN = fbm(P * 2.2 + 13.0) + 0.08 * n3(vObj * 120.0);
float tear = (1.0 - rw.x) * smoothstep(0.66, 0.68, tearN) * uTear;
float fray = (1.0 - rw.x) * smoothstep(0.62, 0.66, tearN) * (1.0 - tear) * uTear;
float wound = tear * smoothstep(0.7, 0.76, tearN);
vec3 under = mix(skin, vec3(0.2, 0.02, 0.025), smoothstep(0.0, 1.0, wound) * 0.85);
col = mix(col, col * 0.45, fray);
col = mix(col, under, tear);
diffuseColor.rgb = col;
float clothW = (1.0 - rw.x) * (1.0 - tear);
float folds = fbm(vec3(vObj.x * 14.0, vObj.y * 5.0, vObj.z * 14.0));
float bumpH = clothW * (0.35 * n3(vObj * 160.0) + 0.25 * fbm(vObj * 45.0) + 0.5 * folds) * (1.0 - wet) + (1.0 - clothW) * fbm(P * 5.0) * 0.6 - fray * 0.6 + wound * 0.8;`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        /* glsl */ `#include <roughnessmap_fragment>
roughnessFactor = mix(0.85, 0.32, max(wet, wound)) - (1.0 - clothW) * 0.2;`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        /* glsl */ `#include <normal_fragment_maps>
normal = sukaBump(-vViewPosition, normal, bumpH, 0.006);`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        /* glsl */ `#include <emissivemap_fragment>
float vn = (1.0 - smoothstep(0.0, 0.012, abs(fbm(P * 2.2) - 0.5))) * smoothstep(0.45, 0.65, fbm(P * 0.9 + 5.0));
totalEmissiveRadiance += vec3(0.5, 0.35, 0.9) * vn * (1.0 - clothW) * uMut * 0.3 * uGlow;`,
      );
  };
  return m;
}

// ------------------------------------------------------------------ infected model

export type ModelAnim = 'idle' | 'walk' | 'run' | 'attack' | 'bash' | 'scream' | 'pain' | 'painHead' | 'stunned' | 'death';

/** Clip + the speed (m/s) it was authored at, so playback matches movement. */
const CLIPS: Record<InfectedKind, Partial<Record<ModelAnim, [string, number]>>> = {
  shambler: { walk: ['walk', 0.8], run: ['jog', 3], attack: ['scratch', 0] },
  runner: { walk: ['walk', 0.8], run: ['run', 5.5], attack: ['punch', 0] },
  bloater: { walk: ['walk', 0.7], run: ['jog', 2.6], attack: ['scratch', 0] },
  screamer: { walk: ['walk', 0.8], run: ['jog', 3], attack: ['scratch', 0] },
  brute: { idle: ['idle', 0], walk: ['walkHeavy', 1.4], run: ['run', 5.5], attack: ['hook', 0] },
};
const COMMON: Record<ModelAnim, [string, number]> = {
  idle: ['idle', 0],
  walk: ['walk', 0.8],
  run: ['jog', 3],
  attack: ['scratch', 0],
  bash: ['punch', 0],
  scream: ['scream', 0],
  pain: ['hitChest', 0],
  painHead: ['hitHead', 0],
  stunned: ['knockback', 0],
  death: ['death', 0],
};

let blobMat: THREE.MeshBasicMaterial | null = null;
const blobGeo = new THREE.PlaneGeometry(1, 1);
/** Soft contact shadow under each body, so they sit on the floor even away from shadow-casting lights. */
function contactShadowMaterial() {
  if (blobMat) return blobMat;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(0,0,0,0.75)');
  grad.addColorStop(0.45, 'rgba(0,0,0,0.45)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  blobMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  return blobMat;
}

const pustuleMat = new THREE.MeshStandardMaterial({ color: '#4a3a40', emissive: '#8a6bd0', emissiveIntensity: 0.35, roughness: 0.3 });
const pustuleGeo = new THREE.SphereGeometry(1, 12, 10);
const _tmpV = new THREE.Vector3();

export class InfectedModel {
  readonly root: THREE.Object3D;
  private mixer: THREE.AnimationMixer;
  private actions = new Map<string, THREE.AnimationAction>();
  private current: THREE.AnimationAction | null = null;
  private currentAnim: ModelAnim | null = null;
  private bones = new Map<string, THREE.Bone>();
  private kind: InfectedKind;
  private blob: THREE.Mesh;

  constructor(kind: InfectedKind, boss: boolean) {
    this.kind = kind;
    const src = models.humanoid!;
    this.root = cloneSkinned(src.scene);
    this.root.traverse((o) => {
      if ((o as THREE.Bone).isBone) this.bones.set(o.name, o as THREE.Bone);
    });
    const skinned: THREE.SkinnedMesh[] = [];
    this.root.traverse((o) => {
      if ((o as THREE.SkinnedMesh).isSkinnedMesh) skinned.push(o as THREE.SkinnedMesh);
    });
    const mat = infectedMaterial(skinned[0].skeleton.bones, lookFor(kind, boss), rand(0, 100), boss);
    for (const m of skinned) {
      m.material = mat;
      m.castShadow = true;
      m.receiveShadow = false;
      // animated poses reach past the bind-pose bounds
      m.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.9, 0), 1.4);
    }
    const headBone = this.bones.get('Head');
    const hi = skinned[0].skeleton.bones.findIndex((b) => b.name === 'Head');
    if (headBone && hi >= 0) buildInfectedHead(headBone, skinned[0].skeleton.boneInverses[hi], mat.userData.u as HeadUniforms);
    this.shape(kind, boss);
    this.blob = new THREE.Mesh(blobGeo, contactShadowMaterial());
    this.blob.rotation.x = -Math.PI / 2;
    this.blob.position.y = 0.012;
    this.blob.scale.set(kind === 'bloater' || kind === 'brute' ? 1.15 : 0.85, 0.75, 1);
    this.blob.renderOrder = -1;
    this.root.add(this.blob);
    this.mixer = new THREE.AnimationMixer(this.root);
    this.play('idle', 0, 0);
    this.mixer.update(rand(0, 3));
  }

  /** Body shape per strain, by scaling bones (no scale tracks in the clips, so this sticks). */
  private shape(kind: InfectedKind, boss: boolean) {
    const b = (n: string) => this.bones.get(n);
    const set = (n: string, x: number, y: number, z: number) => b(n)?.scale.set(x, y, z);
    const counter = (n: string, parentScale: THREE.Vector3) => b(n)?.scale.set(1 / parentScale.x, 1 / parentScale.y, 1 / parentScale.z);
    if (kind === 'bloater') {
      const s = new THREE.Vector3(1.55, 1.08, 1.65);
      set('spine_02', s.x, s.y, s.z);
      const s3 = new THREE.Vector3(1.15 / s.x, 1 / s.y, 1.1 / s.z);
      set('spine_03', s3.x, s3.y, s3.z);
      for (const [bone, x, y, z, r] of [
        ['spine_02', 0.08, 0.06, 0.12, 0.05],
        ['spine_02', -0.1, 0.1, 0.1, 0.04],
        ['spine_01', 0.06, 0.04, 0.11, 0.035],
        ['spine_03', -0.06, 0.1, 0.1, 0.03],
        ['neck_01', 0.04, 0.03, 0.05, 0.025],
      ] as const) {
        const parent = b(bone);
        if (!parent) continue;
        const p = new THREE.Mesh(pustuleGeo, pustuleMat);
        // bone frames are arbitrary: offset in mannequin space, then convert
        this.root.updateMatrixWorld(true);
        const world = parent.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(x, y, z));
        p.position.copy(parent.worldToLocal(world));
        // bones are scaled for the swollen body: undo that so sores keep their size
        const ws = parent.getWorldScale(new THREE.Vector3());
        p.scale.set((r * 0.6) / ws.x, (r * 0.6) / ws.y, (r * 0.45) / ws.z);
        parent.add(p);
      }
    } else if (kind === 'brute' || boss) {
      const s = new THREE.Vector3(1.3, 1.08, 1.25);
      set('spine_03', s.x, s.y, s.z);
      counter('neck_01', s);
      set('upperarm_l', 1.1, 1.15, 1.15);
      set('upperarm_r', 1.1, 1.15, 1.15);
    } else if (kind === 'screamer' || kind === 'runner') {
      const t = kind === 'screamer' ? 0.86 : 0.92;
      set('spine_02', t, 1, t);
    }
  }

  private action(name: string) {
    let a = this.actions.get(name);
    if (!a) {
      const clip = models.clips.get(name);
      if (!clip) return null;
      a = this.mixer.clipAction(clip);
      this.actions.set(name, a);
    }
    return a;
  }

  private play(anim: ModelAnim, fade: number, speedMs: number, scale = 1) {
    const [name, natural] = CLIPS[this.kind][anim] ?? COMMON[anim];
    const a = this.action(name);
    if (!a) return;
    if (natural > 0 && speedMs > 0) a.timeScale = THREE.MathUtils.clamp(speedMs / (natural * scale), 0.55, 2.2);
    else a.timeScale = anim === 'attack' || anim === 'bash' ? 1.25 : 1;
    if (this.currentAnim === anim) return;
    const once = anim !== 'idle' && anim !== 'walk' && anim !== 'run';
    a.reset();
    a.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    a.clampWhenFinished = once;
    if (!once) a.time = rand(0, a.getClip().duration);
    a.enabled = true;
    a.setEffectiveWeight(1);
    a.play();
    if (this.current && this.current !== a) this.current.crossFadeTo(a, fade, false);
    this.current = a;
    this.currentAnim = anim;
  }

  update(dt: number, anim: ModelAnim, pos: THREE.Vector3, yaw: number, scale: number, speedMs: number, flinchX: number, flinchZ: number) {
    const fade = anim === 'death' ? 0.15 : anim === 'pain' || anim === 'painHead' ? 0.08 : 0.25;
    this.play(anim, fade, speedMs, scale);
    this.mixer.update(dt);
    this.root.position.copy(pos);
    this.root.rotation.y = yaw;
    this.root.scale.setScalar(scale);
    // keep the contact shadow under the hips (a falling body moves away from its root)
    const pelvis = this.bones.get('pelvis');
    if (pelvis) {
      this.root.updateMatrixWorld(true);
      const p = this.root.worldToLocal(pelvis.getWorldPosition(_tmpV));
      this.blob.position.x = p.x;
      this.blob.position.z = p.z;
      this.blob.scale.y = anim === 'death' ? 1.3 : 0.75;
    }
    // bullet impacts rock the torso on top of the clip
    const spine = this.bones.get('spine_02');
    if (spine && (flinchX || flinchZ)) {
      spine.rotateX(-flinchX * 0.12);
      spine.rotateZ(flinchZ * 0.1);
    }
  }

  setHeadless() {
    this.bones.get('Head')?.scale.setScalar(0.001);
  }

  dispose() {
    this.mixer.stopAllAction();
    this.root.removeFromParent();
    this.root.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (m.isSkinnedMesh) (m.material as THREE.Material).dispose();
    });
  }
}

// ------------------------------------------------------------------ first-person guns

/**
 * Where each gun model sits. Source models point down +X in their own units; `grip` is where the
 * right palm goes and `support` the left palm (null = one-handed), both in source units.
 * Hand rotations are Euler angles for a frame whose -Z is wrist→knuckles and +Y the thumb side.
 */
interface GunSpec {
  length: number;
  grip: [number, number];
  gripRot: [number, number, number];
  support: [number, number, number] | null;
  supportRot: [number, number, number];
  hip: [number, number, number];
  adsZ: number;
  /** finger curl: right hand [trigger finger, rest], left hand */
  curl: [number, number, number];
  /** axe: haft points up instead of a barrel forward */
  upright?: boolean;
}

const GUNS: Record<WeaponId, GunSpec> = {
  pistol: { length: 0.23, grip: [-0.06, -0.02], gripRot: [-0.4, 0, 0], support: [-0.12, -0.34, -0.3], supportRot: [-0.5, 0, -0.1], hip: [0.1, -0.1, -0.47], adsZ: -0.4, curl: [0.95, 1.35, 1.2] },
  smg: { length: 0.42, grip: [0.04, 0.05], gripRot: [-0.4, 0, 0], support: [0.73, -0.2, 0], supportRot: [-0.35, 0, 0], hip: [0.13, -0.14, -0.38], adsZ: -0.3, curl: [0.95, 1.35, 1.3] },
  rifle: { length: 0.84, grip: [0.1, 0.05], gripRot: [-0.4, 0, 0], support: [1.9, 0.6, 0], supportRot: [0.1, 0, 1.0], hip: [0.14, -0.17, -0.36], adsZ: -0.26, curl: [0.95, 1.35, 1.1] },
  shotgun: { length: 0.98, grip: [0.09, -0.08], gripRot: [-0.35, 0, 0], support: [2.2, -0.04, 0], supportRot: [0.1, 0, 1.0], hip: [0.15, -0.18, -0.4], adsZ: -0.28, curl: [0.95, 1.35, 1.1] },
  dmr: { length: 1.12, grip: [0.2, -0.07], gripRot: [-0.35, 0, 0], support: [2.4, 0.06, 0], supportRot: [0.1, 0, 1.0], hip: [0.15, -0.18, -0.4], adsZ: -0.28, curl: [0.95, 1.35, 1.1] },
  axe: { length: 0.75, grip: [-0.08, 0], gripRot: [-0.2, 0, 0], support: null, supportRot: [0, 0, 0], hip: [0.25, -0.24, -0.52], adsZ: -0.52, curl: [1.3, 1.35, 0], upright: true },
};

export interface GunModel {
  /** origin at the right wrist */
  gun: THREE.Group;
  muzzle: THREE.Vector3;
  sightY: number;
  rightTarget: THREE.Object3D;
  leftTarget: THREE.Object3D | null;
  pump: THREE.Object3D | null;
  hip: THREE.Vector3;
  adsZ: number;
  curl: [number, number, number];
}

type GunFinish = 'steel' | 'alloy' | 'polymer' | 'wood' | 'paint' | 'glass';

/** Which finish each source material gets, and its base colour (linear). */
function finishFor(name: string): { kind: GunFinish; color: string } {
  const n = name.toLowerCase();
  if (/wood/.test(n)) return { kind: 'wood', color: '#5a3520' };
  if (/glass/.test(n)) return { kind: 'glass', color: '#0c1a1c' };
  if (/green/.test(n)) return { kind: 'paint', color: '#252b1d' };
  if (/^main/.test(n)) return { kind: 'alloy', color: n === 'mainlight' ? '#3a3d3f' : n === 'maindark' ? '#1d2022' : '#2a2d2f' };
  if (/lightmetal/.test(n)) return { kind: 'steel', color: '#3a3e41' };
  if (/darkmetal/.test(n)) return { kind: 'steel', color: '#2e3134' };
  if (/metal/.test(n)) return { kind: 'steel', color: '#45494c' };
  if (/black2/.test(n)) return { kind: 'polymer', color: '#0e0f10' };
  if (/grey|gray/.test(n)) return { kind: 'polymer', color: '#2a2c2d' };
  return { kind: 'polymer', color: '#161718' };
}

const FINISH_ID: Record<GunFinish, number> = { steel: 0, alloy: 1, polymer: 2, wood: 3, paint: 4, glass: 5 };

/**
 * Procedural PBR finishes for the gun models (they have no UVs or textures): parkerized steel with
 * machining marks and holster wear, anodized alloy, stippled polymer, oiled wood grain and chipped
 * paint, plus a micro-bump so highlights break up like real surfaces.
 */
function gunMaterial(kind: GunFinish, color: string, metersPerUnit: number) {
  const metal = kind === 'steel' ? 0.85 : kind === 'alloy' ? 0.7 : kind === 'glass' ? 0.3 : 0;
  const m = new THREE.MeshStandardMaterial({ color, metalness: metal, roughness: kind === 'glass' ? 0.08 : 0.5 });
  if (kind === 'glass') return m;
  m.defines = { GUN_FINISH: FINISH_ID[kind] };
  const U = { uK: { value: metersPerUnit } };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGun;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGun = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uK; varying vec3 vGun;
${NOISE}
${BUMP}`)
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
vec3 P = vGun * uK;            // metres, barrel along +X
float rough = 0.5;
float h = 0.0;
float dust = smoothstep(0.55, 0.85, fbm(P * 25.0));
#if GUN_FINISH == 0
  // parkerized steel: fine grain, machining streaks along the barrel, bright holster wear
  float grain = n3(P * 220.0);
  float streak = n3(vec3(P.x * 20.0, P.y * 520.0, P.z * 520.0));
  float wear = smoothstep(0.7, 0.85, fbm(P * 40.0 + 3.0));
  diffuseColor.rgb *= 0.85 + 0.25 * fbm(P * 60.0) + 0.08 * streak;
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.38, 0.39, 0.4), wear * 0.3);
  rough = mix(0.46 + 0.12 * grain, 0.26, wear) + 0.05 * streak;
  h = grain * 0.3 + streak * 0.2;
#elif GUN_FINISH == 1
  // hard-anodized alloy: satin, slightly blotchy, worn to bare grey on edges of rails
  float an = fbm(P * 70.0);
  float wear = smoothstep(0.72, 0.86, fbm(P * 55.0 + 9.0));
  diffuseColor.rgb *= 0.85 + 0.3 * an;
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.2, 0.205, 0.21), wear * 0.5);
  rough = mix(0.48 + 0.12 * an, 0.3, wear);
  h = n3(P * 220.0) * 0.2;
#elif GUN_FINISH == 2
  // polymer: matte stipple texture with greasy hand polish
  float st = n3(P * 300.0);
  float polish = smoothstep(0.6, 0.8, fbm(P * 30.0 + 5.0));
  diffuseColor.rgb *= 0.9 + 0.2 * fbm(P * 80.0);
  rough = mix(0.72 + 0.08 * st, 0.48, polish);
  h = st * 0.35 * (1.0 - polish * 0.7);
#elif GUN_FINISH == 3
  // oiled walnut: warped growth rings along the stock, darker pores
  float warp = fbm(P * vec3(6.0, 40.0, 40.0)) * 5.0;
  float ring = 0.5 + 0.5 * sin(P.y * 420.0 + P.z * 160.0 + warp * 6.0);
  float pores = smoothstep(0.7, 0.9, n3(vec3(P.x * 40.0, P.y * 700.0, P.z * 700.0)));
  diffuseColor.rgb *= mix(0.65, 1.25, ring) * (1.0 - pores * 0.35);
  rough = 0.42 + 0.2 * ring;
  h = ring * 0.4 + pores * 0.5;
#elif GUN_FINISH == 4
  // painted stock: olive paint chipped through to black
  float chip = smoothstep(0.66, 0.7, fbm(P * 70.0 + 2.0));
  diffuseColor.rgb = mix(diffuseColor.rgb * (0.88 + 0.25 * fbm(P * 90.0)), vec3(0.02), chip);
  rough = mix(0.62, 0.45, chip);
  h = n3(P * 500.0) * 0.4 - chip * 0.8;
#endif
diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.8 + vec3(0.012, 0.011, 0.009), dust * 0.4);
float gunBump = h;`,
      )
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = clamp(rough + dust * 0.15, 0.08, 1.0);')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = sukaBump(-vViewPosition, normal, gunBump, 0.0015);');
  };
  return m;
}

function tuneMaterials(o: THREE.Object3D, metersPerUnit: number, smooth: boolean) {
  const cache = new Map<string, THREE.Material>();
  o.traverse((c) => {
    const mesh = c as THREE.Mesh;
    if (!mesh.isMesh) return;
    // soften the low-poly facets but keep hard edges crisp
    if (smooth && !mesh.userData.creased) {
      mesh.geometry = toCreasedNormals(mesh.geometry, THREE.MathUtils.degToRad(35));
      mesh.userData.creased = true;
    }
    const src = mesh.material as THREE.MeshStandardMaterial;
    if (src.map) {
      // the axe ships with a colour atlas: keep it, just make it physically plausible
      const mat = src.clone();
      mat.roughness = 0.55;
      mat.metalness = 0.2;
      mesh.material = mat;
      return;
    }
    const key = src.name;
    let mat = cache.get(key);
    if (!mat) {
      const f = finishFor(src.name || '');
      mat = gunMaterial(f.kind, f.color, metersPerUnit);
      cache.set(key, mat);
    }
    mesh.material = mat;
  });
}

export function buildGunModel(id: WeaponId): GunModel | null {
  const src = models.guns.get(id);
  if (!src) return null;
  const spec = GUNS[id];
  const model = src.clone(true);
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  // axe: its haft runs down +Z in the source; guns run down +X
  const len = spec.upright ? size.z : size.x;
  const k = spec.length / len;
  tuneMaterials(model, k, !spec.upright);

  const gun = new THREE.Group();
  const holder = new THREE.Group();
  holder.add(model);
  holder.scale.setScalar(k);
  if (spec.upright) {
    // source haft runs along +Z with the blade on +X: haft up, blade forward
    holder.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, -1), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 1, 0)));
    // carried leaning forward and out to the right
    gun.rotation.set(-0.55, 0, -0.3);
  } else {
    holder.rotation.y = Math.PI / 2;
  }
  gun.add(holder);
  // move so the grip point sits on the origin
  holder.updateMatrix();
  const grip = spec.upright ? new THREE.Vector3(spec.grip[1], 0, spec.grip[0]) : new THREE.Vector3(spec.grip[0], spec.grip[1], 0);
  const gripG = grip.clone().applyMatrix4(holder.matrix);
  holder.position.sub(gripG);
  holder.updateMatrix();
  gun.updateMatrixWorld(true);

  // muzzle: front of the barrel; sight: top of the gun
  const gbox = new THREE.Box3().setFromObject(holder);
  let muzzle: THREE.Vector3;
  if (spec.upright) {
    muzzle = new THREE.Vector3(0, gbox.max.y, (gbox.min.z + gbox.max.z) / 2);
  } else {
    // average height of vertices near the barrel tip
    const tip = new THREE.Vector3();
    let n = 0;
    const v = new THREE.Vector3();
    holder.traverse((c) => {
      const mesh = c as THREE.Mesh;
      if (!mesh.isMesh) return;
      const pos = mesh.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
        if (v.z < gbox.min.z + 0.015) {
          tip.add(v);
          n++;
        }
      }
    });
    muzzle = n ? tip.divideScalar(n) : new THREE.Vector3(0, 0, gbox.min.z);
    muzzle.z = gbox.min.z;
  }
  const sightY = gbox.max.y;

  const rightTarget = new THREE.Object3D();
  rightTarget.rotation.set(...spec.gripRot);
  gun.add(rightTarget);
  let leftTarget: THREE.Object3D | null = null;
  let pump: THREE.Object3D | null = null;
  if (spec.support) {
    const sp = new THREE.Vector3(spec.support[0], spec.support[1], spec.support[2]).applyMatrix4(holder.matrix);
    pump = new THREE.Object3D();
    gun.add(pump);
    leftTarget = new THREE.Object3D();
    leftTarget.position.copy(sp);
    leftTarget.rotation.set(...spec.supportRot);
    pump.add(leftTarget);
  }
  gun.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.frustumCulled = false;
      mesh.castShadow = true;
    }
  });
  return {
    gun,
    muzzle,
    sightY,
    rightTarget,
    leftTarget,
    pump: id === 'shotgun' ? pump : null,
    hip: new THREE.Vector3(...spec.hip),
    adsZ: spec.adsZ,
    curl: spec.curl,
  };
}

// ------------------------------------------------------------------ first-person arms

const ARM_SCALE = 1.0;
/** eye height and depth of the humanoid's face, used to put the camera in its head */
const EYE = new THREE.Vector3(0, 1.7, 0.09);

interface BoneRest {
  bone: THREE.Bone;
  aimL: THREE.Vector3;
  upL: THREE.Vector3;
}

const _m1 = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();

function basis(out: THREE.Matrix4, aim: THREE.Vector3, up: THREE.Vector3) {
  const x = _a.copy(aim).normalize();
  const z = _c.crossVectors(x, up).normalize();
  const y = _b.crossVectors(z, x);
  return out.makeBasis(x, y, z);
}

/** Rotate `bone` so its local `aimL` points along world `aimW` and `upL` toward world `upW`. */
function orient(r: BoneRest, aimW: THREE.Vector3, upW: THREE.Vector3) {
  basis(_m1, r.aimL, r.upL);
  basis(_m2, aimW, upW);
  _m2.multiply(_m1.transpose());
  _q.setFromRotationMatrix(_m2);
  r.bone.parent!.getWorldQuaternion(_q2);
  r.bone.quaternion.copy(_q2.invert().multiply(_q));
  r.bone.updateMatrixWorld(true);
}

/** Gloved first-person arms that reach for grip points on the gun with two-bone IK. */
export class ArmsRig {
  readonly root: THREE.Object3D;
  private bones = new Map<string, THREE.Bone>();
  private side: Record<'l' | 'r', { upper: BoneRest; lower: BoneRest; hand: BoneRest; a: number; b: number; pole: THREE.Vector3 }>;
  private fingerRest = new Map<THREE.Bone, { q: THREE.Quaternion; axis: THREE.Vector3 }>();
  private leftOn = true;

  constructor() {
    const src = models.humanoid!;
    this.root = cloneSkinned(src.scene);
    const skinned: THREE.SkinnedMesh[] = [];
    this.root.traverse((o) => {
      if ((o as THREE.Bone).isBone) this.bones.set(o.name, o as THREE.Bone);
      if ((o as THREE.SkinnedMesh).isSkinnedMesh) skinned.push(o as THREE.SkinnedMesh);
    });
    const mat = armsMaterial(skinned[0].skeleton.bones);
    for (const m of skinned) {
      m.material = mat;
      m.frustumCulled = false;
    }
    // face down -Z with the eyes on the camera
    this.root.rotation.y = Math.PI;
    this.root.scale.setScalar(ARM_SCALE);
    this.root.position.set(0, -EYE.y * ARM_SCALE - 0.05, -EYE.z * ARM_SCALE + 0.03);
    this.root.updateMatrixWorld(true);

    // rest data from the bind pose, in the humanoid's own space
    const sk = skinned[0].skeleton;
    const bindRot = (b: THREE.Bone) => {
      const i = sk.bones.indexOf(b);
      const m = sk.boneInverses[i].clone().invert();
      return new THREE.Quaternion().setFromRotationMatrix(m.extractRotation(m));
    };
    const toLocal = (b: THREE.Bone, v: THREE.Vector3) => v.clone().applyQuaternion(bindRot(b).invert()).normalize();
    const childPos = (child: string) => this.bones.get(child)!.position.clone().normalize();
    const mk = (s: 'l' | 'r') => {
      const upper = this.bones.get(`upperarm_${s}`)!;
      const lower = this.bones.get(`lowerarm_${s}`)!;
      const hand = this.bones.get(`hand_${s}`)!;
      // the elbow folds the forearm toward the front: that plane's normal, per side
      const bend = new THREE.Vector3(0, s === 'r' ? -1 : 1, 0);
      const front = new THREE.Vector3(0, 0, 1);
      return {
        upper: { bone: upper, aimL: childPos(`lowerarm_${s}`), upL: toLocal(upper, bend) },
        lower: { bone: lower, aimL: childPos(`hand_${s}`), upL: toLocal(lower, bend) },
        hand: { bone: hand, aimL: childPos(`middle_01_${s}`), upL: toLocal(hand, front) },
        a: lower.position.length(),
        b: this.bones.get(`hand_${s}`)!.position.length(),
        pole: new THREE.Vector3(s === 'r' ? 0.7 : -0.7, -1, 0.15).normalize(),
      };
    };
    this.side = { l: mk('l'), r: mk('r') };
    for (const s of ['l', 'r'] as const) {
      // fingers point out along ±X with the palm down; curling turns them toward -Y
      const axis = new THREE.Vector3(0, 0, s === 'r' ? 1 : -1);
      for (const f of ['index', 'middle', 'ring', 'pinky']) {
        for (const j of ['01', '02', '03']) {
          const b = this.bones.get(`${f}_${j}_${s}`);
          if (b) this.fingerRest.set(b, { q: b.quaternion.clone(), axis: toLocal(b, axis) });
        }
      }
      // the thumb wraps across the palm: it turns about the hand's long axis
      const thumbAxis = new THREE.Vector3(1, 0, 0);
      for (const j of ['01', '02', '03']) {
        const b = this.bones.get(`thumb_${j}_${s}`);
        if (b) this.fingerRest.set(b, { q: b.quaternion.clone(), axis: toLocal(b, thumbAxis) });
      }
    }
  }

  /** Close the hands around a grip: trigger finger, other fingers, left hand. */
  setCurl(trigger: number, rest: number, left: number) {
    for (const [b, r] of this.fingerRest) {
      const right = b.name.endsWith('_r');
      const thumb = b.name.startsWith('thumb');
      const idx = b.name.startsWith('index');
      const amt = right ? (idx ? trigger : rest) : left;
      const k = thumb ? (b.name.includes('_01_') ? 0.55 : 0.35) : b.name.includes('_01_') ? 0.8 : 1;
      b.quaternion.copy(r.q).multiply(_q.setFromAxisAngle(r.axis, amt * k));
    }
  }

  setLeftHand(on: boolean) {
    if (this.leftOn === on) return;
    this.leftOn = on;
    this.bones.get('clavicle_l')?.scale.setScalar(on ? 1 : 0.0001);
  }

  private solveArm(s: 'l' | 'r', target: THREE.Object3D) {
    const d = this.side[s];
    const k = ARM_SCALE;
    const S = d.upper.bone.getWorldPosition(new THREE.Vector3());
    const q = target.getWorldQuaternion(new THREE.Quaternion());
    const aim = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    // targets mark the palm; the wrist sits behind it and off the palm face
    const palm = new THREE.Vector3().crossVectors(aim, up).multiplyScalar(s === 'r' ? -1 : 1);
    const T = target.getWorldPosition(new THREE.Vector3()).addScaledVector(aim, -0.075 * k).addScaledVector(palm, -0.022 * k);
    const a = d.a * k;
    const b = d.b * k;
    const toT = T.clone().sub(S);
    const dist = THREE.MathUtils.clamp(toT.length(), Math.abs(a - b) + 1e-3, (a + b) * 0.999);
    const dir = toT.normalize();
    const x = (a * a - b * b + dist * dist) / (2 * dist);
    const h = Math.sqrt(Math.max(0, a * a - x * x));
    // pole is set in camera space; the rig lives under the camera
    const pole = d.pole.clone().transformDirection(this.root.parent!.matrixWorld);
    const pp = pole.sub(dir.clone().multiplyScalar(pole.dot(dir))).normalize();
    const E = S.clone().addScaledVector(dir, x).addScaledVector(pp, h);
    const Tc = S.clone().addScaledVector(dir, dist);
    const n = new THREE.Vector3().crossVectors(Tc.clone().sub(S), E.clone().sub(S)).normalize();
    orient(d.upper, E.clone().sub(S), n);
    orient(d.lower, Tc.clone().sub(E), n);
    orient(d.hand, aim, up);
  }

  solve(right: THREE.Object3D, left: THREE.Object3D | null) {
    this.root.updateMatrixWorld(true);
    right.updateWorldMatrix(true, false);
    this.solveArm('r', right);
    this.setLeftHand(!!left);
    if (left) {
      left.updateWorldMatrix(true, false);
      this.solveArm('l', left);
    }
  }
}

function armsMaterial(bones: THREE.Bone[]) {
  // 0 hidden, 1 sleeve, 2 glove
  const regions = new Array<number>(80).fill(0);
  bones.forEach((b, i) => {
    if (/^(clavicle|upperarm|lowerarm)/.test(b.name)) regions[i] = 1;
    else if (/^(hand|index|middle|pinky|ring|thumb)/.test(b.name)) regions[i] = 2;
  });
  const m = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.85 });
  const U = { uRegion: { value: regions } };
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, U);
    s.vertexShader = s.vertexShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
uniform float uRegion[80]; varying vec3 vArm; varying vec3 vObj;
vec3 regOf(float j){ float r = uRegion[int(j)]; return vec3(r < .5 ? 1. : 0., abs(r-1.) < .5 ? 1. : 0., abs(r-2.) < .5 ? 1. : 0.); }`,
      )
      .replace(
        '#include <skinbase_vertex>',
        /* glsl */ `#include <skinbase_vertex>
vArm = regOf(skinIndex.x)*skinWeight.x + regOf(skinIndex.y)*skinWeight.y + regOf(skinIndex.z)*skinWeight.z + regOf(skinIndex.w)*skinWeight.w;
vObj = position;`,
      );
    s.fragmentShader = s.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
varying vec3 vArm; varying vec3 vObj;
${NOISE}
${BUMP}`,
      )
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
if (vArm.x > 0.5) discard;
// bind pose: arms run along X at shoulder height, the hand starts at |x| = 0.74
float ax = abs(vObj.x);
float ang = atan(vObj.z + 0.065, vObj.y - 1.441);
float circ = ang * 0.045;                       // metres around the sleeve
vec3 P = vObj * 40.0;
float glove = max(smoothstep(0.728, 0.742, ax), smoothstep(0.55, 0.8, vArm.z));
float cuff = smoothstep(0.685, 0.692, ax) * (1.0 - glove);

// brown duck canvas work jacket: twill weave, sun-faded on top of the forearm, grimy toward the cuff
float twPh = (vObj.x * sign(vObj.x) + circ) * 1250.0;
float twAA = clamp(1.5 - length(vec2(dFdx(twPh), dFdy(twPh))) * 0.5, 0.0, 1.0);
float twill = 0.5 + 0.5 * sin(twPh) * twAA;
float slub = n3(vec3(vObj.x * 60.0, circ * 150.0, 0.0));
vec3 duck = vec3(0.1, 0.054, 0.025) * (0.92 + 0.04 * twill + 0.25 * fbm(P * 2.0));
float fade = smoothstep(0.45, 0.75, fbm(P * 0.6 + 4.0)) * (0.4 + 0.6 * smoothstep(0.2, 0.9, cos(ang)));
duck = mix(duck, vec3(0.2, 0.135, 0.075), fade * 0.4);
float grime = smoothstep(0.5, 0.75, fbm(P * 1.2 + 9.0)) + smoothstep(0.58, 0.66, ax) * 0.5;
duck *= 1.0 - clamp(grime, 0.0, 1.0) * 0.35;
// double-stitched seam down the underside of the sleeve
float dSeam = abs(ang - 2.5) * 0.045;
float seamRidge = smoothstep(0.004, 0.0, dSeam);
float stitch = (step(abs(dSeam - 0.0032), 0.0006)) * step(0.45, fract(vObj.x * 320.0));
duck = mix(duck, vec3(0.36, 0.22, 0.08), stitch * (1.0 - cuff));
// rib-knit cuff
float rib = 0.5 + 0.5 * sin(ang * 40.0);
vec3 knit = vec3(0.07, 0.04, 0.02) * (0.92 + 0.1 * rib);
vec3 sleeve = mix(duck, knit, cuff);

// worn leather work gloves: scuffed knuckles, dirt in the creases
float crease = fbm(vec3(vObj.x * 120.0, vObj.y * 30.0, vObj.z * 30.0));
vec3 leather = vec3(0.042, 0.03, 0.022) * (0.8 + 0.4 * fbm(P * 4.0));
leather = mix(leather, vec3(0.1, 0.075, 0.055), smoothstep(0.6, 0.8, fbm(P * 2.5 + 3.0)) * 0.6);
leather *= 1.0 - smoothstep(0.55, 0.7, crease) * 0.4;

diffuseColor.rgb = mix(sleeve, leather, glove);
float armRough = mix(mix(0.92, 0.97, cuff), 0.6 - 0.15 * smoothstep(0.6, 0.8, fbm(P * 2.5 + 3.0)), glove);
float armBump = mix(mix(slub * 0.5 + seamRidge * 1.5, rib * 0.3, cuff), crease * 0.8, glove);`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        /* glsl */ `#include <roughnessmap_fragment>
roughnessFactor = armRough;`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        /* glsl */ `#include <normal_fragment_maps>
normal = sukaBump(-vViewPosition, normal, armBump, 0.003);`,
      );
  };
  return m;
}
