import * as THREE from 'three';
import { INFECTED, type InfectedDef, type InfectedKind, type WaveScaling } from '../data/infected';
import type { ItemId } from '../data/items';
import { fabric, infectedSkin } from '../world/textures';
import type { Level } from '../world/level';
import { audio } from '../core/audio';
import { Spring, chance, clamp, damp, pick, rand, randInt, wrapAngle } from '../core/math';
import type { Effects } from './effects';
import { InfectedSprite } from '../sprites/infectedSprite';
import type { AnimName } from '../sprites/library';

export type Zone = 'head' | 'body' | 'limb';
type State = 'idle' | 'wander' | 'investigate' | 'chase' | 'attack' | 'stagger' | 'scream' | 'charge' | 'stunned' | 'bash' | 'dead';

export interface InfectedContext {
  level: Level;
  effects: Effects;
  playerPos: THREE.Vector3;
  playerEye: THREE.Vector3;
  playerYaw: number;
  playerCrouch: boolean;
  playerFlashlight: boolean;
  playerAlive: boolean;
  all: Infected[];
  time: number;
  scaling: WaveScaling;
  hpMul: number;
  dmgMul: number;
  lure: THREE.Vector3 | null;
  cameraPos: THREE.Vector3;
  spriteMode: boolean;
  hitPlayer(inf: Infected, damage: number, exposure: number, knockback: number): void;
  scream(inf: Infected): void;
}

// ------------------------------------------------------------------ shared assets

interface RigMaterials {
  skins: THREE.MeshStandardMaterial[];
  clothes: THREE.MeshStandardMaterial[];
  pants: THREE.MeshStandardMaterial[];
  eye: THREE.MeshStandardMaterial;
  pustule: THREE.MeshStandardMaterial;
  armor: THREE.MeshStandardMaterial;
  gore: THREE.MeshStandardMaterial;
  teeth: THREE.MeshStandardMaterial;
  hair: THREE.MeshStandardMaterial;
}

let mats: RigMaterials | null = null;
let mutationLevel = 0.15;
const geos = {
  capsule: new THREE.CapsuleGeometry(1, 1, 6, 12),
  sphere: new THREE.SphereGeometry(1, 18, 14),
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 12),
};

function rigMaterials(): RigMaterials {
  if (mats) return mats;
  const skin = (seed: number, base: string) => {
    const t = infectedSkin(seed, base);
    const m = new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normal, roughness: 0.72, emissive: '#a98bff', emissiveMap: t.veins, emissiveIntensity: 0.2 });
    return m;
  };
  const cloth = (seed: number, base: string, p: 'gown' | 'scrubs' | 'uniform' | 'plain') => {
    const t = fabric(seed, base, p);
    return new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normal, roughness: 0.92 });
  };
  mats = {
    skins: [skin(301, '#5d6459'), skin(302, '#6a6356'), skin(303, '#535d4e')],
    clothes: [
      cloth(311, '#6c8796', 'gown'),
      cloth(312, '#3f6f78', 'scrubs'),
      cloth(313, '#2b3340', 'uniform'),
      cloth(314, '#6b5a48', 'plain'),
      cloth(315, '#9a9e98', 'plain'),
    ],
    pants: [cloth(321, '#2c3236', 'plain'), cloth(322, '#3f6f78', 'scrubs'), cloth(323, '#1f2328', 'uniform')],
    eye: new THREE.MeshStandardMaterial({ color: '#cbb8ff', emissive: '#a98bff', emissiveIntensity: 3 }),
    pustule: new THREE.MeshStandardMaterial({ color: '#5a4872', emissive: '#a98bff', emissiveIntensity: 0.35, roughness: 0.2 }),
    hair: new THREE.MeshStandardMaterial({ color: '#1c1a17', roughness: 0.95 }),
    armor: new THREE.MeshStandardMaterial({ color: '#1d2224', roughness: 0.5, metalness: 0.4 }),
    gore: new THREE.MeshStandardMaterial({ color: '#4a0a0c', roughness: 0.3 }),
    teeth: new THREE.MeshStandardMaterial({ color: '#b8b098', roughness: 0.5 }),
  };
  return mats;
}

/** Called each wave so veins and eyes glow brighter as the strain mutates. */
export function setMutation(level: number) {
  mutationLevel = level;
  const m = rigMaterials();
  for (const s of m.skins) s.emissiveIntensity = 0.08 + level * 0.5;
  m.eye.emissiveIntensity = 2 + level * 3;
  m.pustule.emissiveIntensity = 0.4 + level * 1.2;
}

interface Rig {
  root: THREE.Group;
  body: THREE.Group;
  pelvis: THREE.Group;
  spine: THREE.Group;
  chest: THREE.Group;
  neck: THREE.Group;
  head: THREE.Group;
  jaw: THREE.Group;
  shoulderL: THREE.Group;
  shoulderR: THREE.Group;
  elbowL: THREE.Group;
  elbowR: THREE.Group;
  hipL: THREE.Group;
  hipR: THREE.Group;
  kneeL: THREE.Group;
  kneeR: THREE.Group;
  hitMeshes: THREE.Mesh[];
}

function part(parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, zone: Zone, sx: number, sy: number, sz: number, x = 0, y = 0, z = 0, hit: THREE.Mesh[]) {
  const m = new THREE.Mesh(geo, mat);
  m.scale.set(sx, sy, sz);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.userData.zone = zone;
  parent.add(m);
  hit.push(m);
  return m;
}

function joint(parent: THREE.Object3D, x: number, y: number, z = 0) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}

function buildRig(kind: InfectedKind, boss: boolean): Rig {
  const M = rigMaterials();
  const hit: THREE.Mesh[] = [];
  const skin = pick(M.skins);
  const cloth = kind === 'brute' ? M.clothes[2] : pick(M.clothes);
  const pants = kind === 'brute' ? M.pants[2] : pick(M.pants);
  const thin = kind === 'screamer' ? 0.78 : kind === 'runner' ? 0.9 : 1;
  const heavy = kind === 'brute' ? 1.45 : 1;
  const C = geos.capsule;

  const root = new THREE.Group();
  const body = joint(root, 0, 0);
  const pelvis = joint(body, 0, 0.95);
  part(pelvis, C, pants, 'body', 0.16 * heavy, 0.06, 0.11 * heavy, 0, 0, 0, hit);

  const spine = joint(pelvis, 0, 0.06);
  if (kind === 'bloater') {
    part(spine, geos.sphere, skin, 'body', 0.38, 0.42, 0.36, 0, 0.26, 0.06, hit);
    part(spine, geos.cyl, cloth, 'body', 0.39, 0.16, 0.37, 0, 0.42, 0.04, hit);
    for (let i = 0; i < 9; i++) {
      const a = rand(-1.6, 1.6);
      const y = rand(0.05, 0.5);
      const r = rand(0.05, 0.11);
      const p = part(spine, geos.sphere, M.pustule, 'body', r, r * 0.8, r, Math.sin(a) * 0.36, y, Math.cos(a) * 0.33 + 0.06, hit);
      p.castShadow = false;
    }
  } else {
    part(spine, C, cloth, 'body', 0.15 * thin * heavy, 0.12, 0.1 * heavy, 0, 0.17, 0, hit);
  }
  const chest = joint(spine, 0, 0.36);
  if (kind !== 'bloater') part(chest, C, cloth, 'body', 0.19 * thin * heavy, 0.06, 0.12 * heavy, 0, 0.02, 0, hit);
  if (kind === 'brute') {
    part(chest, geos.box, M.armor, 'body', 0.5, 0.42, 0.08, 0, -0.08, 0.14, hit);
    part(chest, geos.box, M.armor, 'body', 0.46, 0.38, 0.06, 0, -0.08, -0.14, hit);
  }

  const neck = joint(chest, 0, 0.1);
  part(neck, geos.cyl, skin, 'head', 0.05 * heavy, kind === 'screamer' ? 0.16 : 0.11, 0.05 * heavy, 0, 0.05, 0, hit);
  const head = joint(neck, 0, kind === 'screamer' ? 0.17 : 0.12);
  const hs = boss ? 1.05 : 1;
  part(head, geos.sphere, skin, 'head', 0.1 * hs, (kind === 'screamer' ? 0.135 : 0.12) * hs, 0.11 * hs, 0, 0.06, 0, hit);
  for (const sx of [-0.038, 0.038]) {
    const e = part(head, geos.sphere, M.eye, 'head', 0.014, 0.011, 0.01, sx, 0.075, 0.097, hit);
    e.castShadow = false;
  }
  const jaw = joint(head, 0, 0.0, 0.03);
  part(jaw, geos.box, skin, 'head', 0.12, 0.04, 0.1, 0, -0.03, 0.03, hit);
  part(jaw, geos.box, M.teeth, 'head', 0.09, 0.012, 0.02, 0, -0.008, 0.075, hit);
  if (kind === 'brute') part(head, geos.sphere, M.armor, 'head', 0.115, 0.08, 0.12, 0, 0.12, -0.005, hit);
  else if (Math.random() < 0.55) part(head, geos.sphere, M.hair, 'head', 0.104 * hs, 0.07 * hs, 0.112 * hs, 0, 0.1, -0.012, hit);

  const armLen = kind === 'screamer' ? 1.12 : 1;
  const armW = heavy * (kind === 'screamer' ? 0.8 : 1);
  const mkArm = (s: number) => {
    const sh = joint(chest, s * 0.21 * thin * heavy, 0.04);
    part(sh, C, kind === 'brute' ? cloth : skin, 'limb', 0.05 * armW, 0.12 * armLen, 0.05 * armW, 0, -0.15 * armLen, 0, hit);
    const el = joint(sh, 0, -0.3 * armLen);
    part(el, C, skin, 'limb', 0.043 * armW, 0.11 * armLen, 0.043 * armW, 0, -0.14 * armLen, 0, hit);
    part(el, geos.box, skin, 'limb', 0.07 * armW, 0.12, 0.035 * armW, 0, -0.33 * armLen, 0.01, hit);
    return [sh, el] as const;
  };
  const [shoulderL, elbowL] = mkArm(-1);
  const [shoulderR, elbowR] = mkArm(1);

  const mkLeg = (s: number) => {
    const hp = joint(pelvis, s * 0.095 * heavy, -0.04);
    part(hp, C, pants, 'limb', 0.07 * heavy, 0.16, 0.07 * heavy, 0, -0.22, 0, hit);
    const kn = joint(hp, 0, -0.45);
    part(kn, C, pants, 'limb', 0.055 * heavy, 0.17, 0.055 * heavy, 0, -0.22, 0, hit);
    part(kn, geos.box, M.pants[0], 'limb', 0.1 * heavy, 0.06, 0.24, 0, -0.45, 0.05, hit);
    return [hp, kn] as const;
  };
  const [hipL, kneeL] = mkLeg(-1);
  const [hipR, kneeR] = mkLeg(1);

  return { root, body, pelvis, spine, chest, neck, head, jaw, shoulderL, shoulderR, elbowL, elbowR, hipL, hipR, kneeL, kneeR, hitMeshes: hit };
}

// ------------------------------------------------------------------ entity

let nextId = 1;
const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();

export class Infected {
  readonly id = nextId++;
  readonly def: InfectedDef;
  readonly rig: Rig;
  readonly sprite: InfectedSprite;
  private spriteMode: boolean | null = null;
  private spriteFlip = false;
  readonly pos: THREE.Vector3;
  readonly vel = new THREE.Vector3();
  yaw = rand(0, Math.PI * 2);
  hp: number;
  maxHp: number;
  state: State = 'idle';
  readonly boss: boolean;
  name: string;
  scale: number;

  // perception
  alerted = false;
  lastSeen = -100;
  lastKnown = new THREE.Vector3();
  private senseTimer = rand(0, 0.25);
  private investigateAt = new THREE.Vector3();
  private stateTime = 0;
  private wanderTimer = rand(2, 6);
  private voiceTimer = rand(2, 8);
  private attackHit = false;
  private screamCooldown = rand(2, 4);
  private chargeCooldown = rand(2, 5);
  private chargeDir = new THREE.Vector3();
  private dormant: boolean;
  private bashTarget: import('../world/level').Door | null = null;

  // animation
  private gait = rand(0, 10);
  private moveSpeed = 0;
  private limp = rand(0.5, 1);
  private twitch = 0;
  private hitSpringX = new Spring(90, 9);
  private hitSpringZ = new Spring(90, 9);
  private headTilt = rand(-0.3, 0.3);
  private armReach = rand(0.7, 1.2);
  deathTime = 0;
  private fallDir = 1;
  private fallRoll = 0;
  headless = false;

  // looting
  loot: { item: ItemId; qty: number }[] = [];
  harvested = false;
  lastHitTime = -10;

  constructor(kind: InfectedKind, pos: THREE.Vector3, ctx: InfectedContext, opts: { boss?: boolean; alerted?: boolean } = {}) {
    this.def = INFECTED[kind];
    this.boss = !!opts.boss;
    this.rig = buildRig(kind, this.boss);
    this.pos = pos.clone();
    this.scale = this.def.scale * rand(0.95, 1.06) * (this.boss ? 1.12 : 1);
    this.rig.root.scale.setScalar(this.scale);
    this.maxHp = this.def.hp * ctx.scaling.hp * ctx.hpMul * (this.boss ? 1.8 : 1);
    this.hp = this.maxHp;
    this.name = this.boss ? 'Patient Zero' : this.def.name;
    this.dormant = this.boss;
    for (const m of this.rig.hitMeshes) m.userData.owner = this;
    this.rig.root.position.copy(this.pos);
    this.sprite = new InfectedSprite(this.boss ? 'patientZero' : kind);
    this.setRenderMode(ctx.spriteMode);
    if (opts.alerted) this.alert(ctx, true);
  }

  get alive() {
    return this.state !== 'dead';
  }
  get kind() {
    return this.def.kind;
  }
  get radius() {
    return this.def.radius;
  }
  get headPos() {
    return this.rig.head.getWorldPosition(tmp2);
  }
  get height() {
    return 1.75 * this.scale;
  }

  // ------------------------------------------------------------------ senses

  hear(at: THREE.Vector3, loudness: number, ctx: InfectedContext) {
    if (!this.alive || this.dormant) return;
    const d = this.pos.distanceTo(at);
    const range = loudness * this.def.hearing * ctx.scaling.aggression;
    if (d > range) return;
    if (this.state === 'chase' || this.state === 'attack' || this.state === 'charge' || this.state === 'scream') {
      this.lastKnown.copy(at);
      return;
    }
    // close or very loud: home straight in, otherwise go and look
    if (d < range * 0.45) this.alert(ctx);
    else this.investigate(at);
  }

  investigate(at: THREE.Vector3) {
    this.investigateAt.copy(at);
    this.setState('investigate');
  }

  alert(ctx: InfectedContext, silent = false) {
    if (!this.alive) return;
    this.dormant = false;
    const wasAlert = this.state === 'chase' || this.state === 'attack';
    this.alerted = true;
    this.lastSeen = ctx.time;
    this.lastKnown.copy(ctx.playerPos);
    if (wasAlert) return;
    if (this.kind === 'screamer' && this.screamCooldown <= 0) {
      this.setState('scream');
      return;
    }
    this.setState('chase');
    if (!silent) audio.voice(this.kind, this.pos, 'alert');
  }

  private setState(s: State) {
    if (this.state === 'dead') return;
    this.state = s;
    this.stateTime = 0;
    this.attackHit = false;
  }

  private perceive(ctx: InfectedContext) {
    if (!ctx.playerAlive) {
      if (this.state === 'chase') this.setState('idle');
      return;
    }
    const dx = ctx.playerPos.x - this.pos.x;
    const dz = ctx.playerPos.z - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (this.dormant) {
      if (d < 9 && ctx.level.lineOfSight(this.pos.x, this.pos.z, ctx.playerPos.x, ctx.playerPos.z)) this.alert(ctx);
      return;
    }
    let range = this.def.sight * ctx.scaling.sight;
    if (ctx.playerCrouch) range *= 0.55;
    // a flashlight in the face is hard to miss
    if (ctx.playerFlashlight) {
      const toMe = Math.atan2(-dx, -dz);
      const facing = Math.abs(wrapAngle(toMe - (ctx.playerYaw + Math.PI))) < 0.5;
      if (facing) range *= 1.35;
    }
    if (d > range) return;
    const ang = Math.abs(wrapAngle(Math.atan2(dx, dz) - this.yaw));
    const inCone = ang < 1.15 || d < 3.2 || this.state === 'chase';
    if (!inCone) return;
    if (!ctx.level.lineOfSight(this.pos.x, this.pos.z, ctx.playerPos.x, ctx.playerPos.z)) return;
    this.lastSeen = ctx.time;
    this.lastKnown.copy(ctx.playerPos);
    if (!this.alerted || (this.state !== 'chase' && this.state !== 'attack' && this.state !== 'charge' && this.state !== 'scream' && this.state !== 'stagger' && this.state !== 'stunned')) {
      this.alert(ctx);
    }
  }

  // ------------------------------------------------------------------ damage

  damage(amount: number, zone: Zone, dir: THREE.Vector3, stagger: number, ctx: InfectedContext, opts: { headMul?: number; limbMul?: number } = {}) {
    if (!this.alive) return { killed: false, dealt: 0 };
    let mul = 1;
    if (zone === 'head') mul = (opts.headMul ?? 2) * this.def.headMul;
    else if (zone === 'limb') mul = opts.limbMul ?? 0.7;
    else mul = this.def.bodyArmor;
    if (this.state === 'stunned') mul *= 1.5;
    const dealt = amount * mul;
    this.hp -= dealt;
    this.lastHitTime = ctx.time;
    this.sprite.flashHurt();
    this.dormant = false;

    // reaction
    const local = Math.atan2(dir.x, dir.z) - this.yaw;
    this.hitSpringX.impulse(Math.cos(local) * (3 + stagger * 6));
    this.hitSpringZ.impulse(Math.sin(local) * (2 + stagger * 4));

    if (this.hp <= 0) {
      this.die(dir, zone === 'head' && dealt >= 55, ctx);
      return { killed: true, dealt };
    }
    if (chance(0.5)) audio.voice(this.kind, this.pos, 'pain');
    if (this.state !== 'chase' && this.state !== 'attack' && this.state !== 'charge') this.alert(ctx);
    const resist = this.def.staggerResist;
    if (stagger * (zone === 'head' ? 1.4 : 1) > resist + rand(0.2, 0.7) && this.state !== 'charge' && this.state !== 'stunned') {
      this.setState('stagger');
    }
    return { killed: false, dealt };
  }

  private die(dir: THREE.Vector3, headshot: boolean, ctx: InfectedContext) {
    this.state = 'dead';
    this.deathTime = 0;
    this.hp = 0;
    const local = Math.atan2(dir.x, dir.z) - this.yaw;
    // fall away from the shot
    this.fallDir = Math.cos(local) > 0 ? 1 : -1;
    this.fallRoll = rand(-0.4, 0.4) + Math.sin(local) * 0.5;
    audio.voice(this.kind, this.pos, 'death');
    if (headshot && this.kind !== 'brute') {
      this.headless = true;
      this.rig.head.visible = false;
      ctx.effects.gore(this.headPos);
    }
    // decide loot
    for (const d of this.def.drops) {
      if (chance(d.chance)) this.loot.push({ item: d.item, qty: randInt(d.min, d.max) });
    }
    if (this.boss) this.loot.push({ item: 'adrenal', qty: 1 });
    for (const m of this.rig.hitMeshes) m.userData.dead = true;
  }

  // ------------------------------------------------------------------ update

  update(dt: number, ctx: InfectedContext) {
    this.stateTime += dt;
    if (!this.alive) {
      this.animateDeath(dt);
      this.updateSprite(dt, ctx);
      return;
    }
    this.screamCooldown -= dt;
    this.chargeCooldown -= dt;
    this.senseTimer -= dt;
    if (this.senseTimer <= 0) {
      this.senseTimer = 0.2;
      this.perceive(ctx);
    }

    const toPlayer = tmp.set(ctx.playerPos.x - this.pos.x, 0, ctx.playerPos.z - this.pos.z);
    const dist = toPlayer.length();
    const sc = ctx.scaling;
    let desired = 0;
    const dir = new THREE.Vector3();
    let faceYaw: number | null = null;

    // lures override wandering and searching
    if (ctx.lure && this.state !== 'chase' && this.state !== 'attack' && this.state !== 'charge' && !this.dormant) {
      if (this.pos.distanceTo(ctx.lure) < 28 && this.state !== 'investigate') this.investigate(ctx.lure);
      else if (this.state === 'investigate') this.investigateAt.copy(ctx.lure);
    }

    switch (this.state) {
      case 'idle': {
        this.wanderTimer -= dt;
        if (this.wanderTimer <= 0 && !this.dormant) {
          this.wanderTimer = rand(4, 10);
          if (chance(0.55)) {
            this.investigateAt.set(this.pos.x + rand(-6, 6), 0, this.pos.z + rand(-6, 6));
            this.setState('wander');
          }
        }
        break;
      }
      case 'wander':
      case 'investigate': {
        const target = this.investigateAt;
        const d = Math.hypot(target.x - this.pos.x, target.z - this.pos.z);
        if (d < 1.2 || this.stateTime > (this.state === 'wander' ? 6 : 20)) {
          this.setState('idle');
          this.wanderTimer = rand(2, 5);
          break;
        }
        if (!ctx.level.pathDir(this.pos.x, this.pos.z, target.x, target.z, dir)) {
          this.setState('idle');
          break;
        }
        if (dir.lengthSq() === 0) dir.set(target.x - this.pos.x, 0, target.z - this.pos.z).normalize();
        desired = this.state === 'wander' ? this.def.walkSpeed * 0.7 : this.def.walkSpeed * 1.5;
        break;
      }
      case 'chase': {
        if (!ctx.playerAlive) {
          this.setState('idle');
          break;
        }
        const seen = ctx.time - this.lastSeen;
        if (seen > 9) {
          this.investigate(this.lastKnown);
          break;
        }
        const los = seen < 0.5;
        // special behaviours
        if (this.kind === 'screamer') {
          if (this.screamCooldown <= 0 && los && dist < 26) {
            this.setState('scream');
            break;
          }
          if (dist > 1.6 && dist < 6 && los) {
            // keep its distance
            dir.copy(toPlayer).multiplyScalar(-1 / Math.max(dist, 0.01));
            desired = this.def.runSpeed * 0.9;
            faceYaw = Math.atan2(toPlayer.x, toPlayer.z);
            break;
          }
        }
        if (this.kind === 'brute' && los && dist > 5 && dist < 15 && this.chargeCooldown <= 0) {
          this.setState('charge');
          this.chargeDir.copy(toPlayer).normalize();
          audio.voice('brute', this.pos, 'alert');
          break;
        }
        if (dist < this.def.attackRange * this.scale && los) {
          this.setState('attack');
          break;
        }
        if (los && dist < 9) dir.copy(toPlayer).normalize();
        else if (!ctx.level.flowDir(this.pos.x, this.pos.z, dir) || dir.lengthSq() === 0) dir.copy(toPlayer).normalize();
        desired = this.def.runSpeed;
        // runners lunge in the last few metres
        if (this.kind === 'runner' && dist < 5 && los) desired *= 1.25;
        break;
      }
      case 'attack': {
        faceYaw = Math.atan2(toPlayer.x, toPlayer.z);
        const windup = this.def.attackWindup / sc.aggression;
        if (!this.attackHit && this.stateTime > windup) {
          this.attackHit = true;
          audio.voice(this.kind, this.pos, 'attack');
          const ang = Math.abs(wrapAngle(Math.atan2(toPlayer.x, toPlayer.z) - this.yaw));
          if (dist < this.def.attackRange * this.scale + 0.4 && ang < 0.9 && ctx.playerAlive) {
            ctx.hitPlayer(this, this.def.damage * sc.damage * ctx.dmgMul, this.def.exposure, this.kind === 'brute' ? 7 : 2);
          }
        }
        if (this.stateTime > windup + this.def.attackCooldown / sc.aggression) this.setState('chase');
        else if (this.stateTime < windup * 0.6 && dist > this.def.attackRange * this.scale) {
          // keep closing while winding up
          dir.copy(toPlayer).normalize();
          desired = this.def.walkSpeed;
        }
        break;
      }
      case 'stagger': {
        if (this.stateTime > 0.55) this.setState('chase');
        break;
      }
      case 'scream': {
        faceYaw = Math.atan2(toPlayer.x, toPlayer.z);
        if (this.stateTime < dt * 1.5) {
          audio.voice('screamer', this.pos, 'scream');
          ctx.scream(this);
        }
        if (this.stateTime > 1.7) {
          this.screamCooldown = 15 / sc.aggression;
          this.setState('chase');
        }
        break;
      }
      case 'charge': {
        if (this.stateTime < 0.75) {
          faceYaw = Math.atan2(toPlayer.x, toPlayer.z);
          this.chargeDir.copy(toPlayer).normalize();
          break;
        }
        dir.copy(this.chargeDir);
        faceYaw = Math.atan2(dir.x, dir.z);
        desired = 8.5 * sc.speed;
        if (!this.attackHit && dist < 1.6 * this.scale) {
          this.attackHit = true;
          ctx.hitPlayer(this, this.def.damage * 1.3 * sc.damage * ctx.dmgMul, this.def.exposure, 12);
        }
        if (this.stateTime > 2.2) {
          this.chargeCooldown = rand(5, 8);
          this.setState('chase');
        }
        break;
      }
      case 'stunned': {
        if (this.stateTime > 2.4) this.setState('chase');
        break;
      }
      case 'bash': {
        const door = this.bashTarget;
        if (!door || !door.blocking) {
          this.setState('chase');
          break;
        }
        faceYaw = Math.atan2(door.center.x - this.pos.x, door.center.z - this.pos.z);
        door.health -= dt * (this.kind === 'brute' ? 4 : 1);
        if (Math.floor(this.stateTime * 1.6) !== Math.floor((this.stateTime - dt) * 1.6)) audio.impactSurface(door.center.clone().setY(1.2), true);
        if (door.health <= 0) {
          door.target = 1;
          audio.impactSurface(door.center.clone().setY(1.2), true);
          audio.impactFlesh(door.center, true);
          this.setState('chase');
        }
        break;
      }
    }

    // movement
    desired *= sc.speed;
    if (desired > 0 && dir.lengthSq() > 0) {
      const door = ctx.level.closedDoorAhead(this.pos.x, this.pos.z, dir);
      if (door && this.state !== 'charge') {
        this.bashTarget = door;
        this.setState('bash');
        desired = 0;
      }
    }
    const tv = tmp2.copy(dir).multiplyScalar(desired);
    const accel = this.state === 'charge' ? 20 : 8;
    this.vel.x = damp(this.vel.x, tv.x, accel, dt);
    this.vel.z = damp(this.vel.z, tv.z, accel, dt);

    // separation
    for (const o of ctx.all) {
      if (o === this || !o.alive) continue;
      const sx = this.pos.x - o.pos.x;
      const sz = this.pos.z - o.pos.z;
      const min = this.radius + o.radius;
      const d2 = sx * sx + sz * sz;
      if (d2 < min * min && d2 > 1e-6) {
        const d = Math.sqrt(d2);
        const push = (min - d) * 0.5;
        this.pos.x += (sx / d) * push;
        this.pos.z += (sz / d) * push;
      }
    }
    // stay out of the player's capsule
    if (ctx.playerAlive) {
      const min = this.radius + 0.35;
      if (dist < min && dist > 1e-4) {
        this.pos.x -= (toPlayer.x / dist) * (min - dist);
        this.pos.z -= (toPlayer.z / dist) * (min - dist);
      }
    }

    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    const bumped = ctx.level.resolveCircle(this.pos, this.radius);
    if (this.state === 'charge' && this.stateTime > 0.9 && bumped && this.vel.length() > 3) {
      // slammed into a wall: dazed and open to headshots
      audio.impactSurface(this.pos.clone().setY(1.5), true);
      audio.impactFlesh(this.pos, true);
      this.vel.set(0, 0, 0);
      this.setState('stunned');
    }

    this.moveSpeed = Math.hypot(this.vel.x, this.vel.z);
    const targetYaw = faceYaw ?? (this.moveSpeed > 0.2 ? Math.atan2(this.vel.x, this.vel.z) : this.yaw);
    this.yaw += wrapAngle(targetYaw - this.yaw) * Math.min(1, dt * (this.state === 'charge' ? 3 : 7));

    // idle vocalisation
    this.voiceTimer -= dt;
    if (this.voiceTimer <= 0) {
      this.voiceTimer = this.state === 'chase' ? rand(2, 4.5) : rand(5, 12);
      const ld = this.pos.distanceTo(ctx.playerPos);
      if (ld < 30) audio.voice(this.kind, this.pos, this.state === 'chase' ? 'attack' : 'idle');
    }

    this.animate(dt, ctx, toPlayer, dist);
    this.updateSprite(dt, ctx);
  }

  // ------------------------------------------------------------------ animation

  private animate(dt: number, ctx: InfectedContext, toPlayer: THREE.Vector3, dist: number) {
    const r = this.rig;
    r.root.position.copy(this.pos);
    r.root.rotation.y = this.yaw;

    const speed = this.moveSpeed / this.scale;
    const running = speed > 2.2;
    const freq = running ? 1.7 + speed * 0.55 : 1.2 + speed * 1.2;
    this.gait += dt * freq * Math.PI;
    const g = this.gait;
    const amp = clamp(speed / (running ? 5 : 1.6), 0, 1);
    const swing = (running ? 0.85 : 0.45) * amp;
    const limp = this.kind === 'shambler' ? this.limp : 1;

    // legs
    r.hipL.rotation.x = -Math.sin(g) * swing * limp;
    r.hipR.rotation.x = Math.sin(g) * swing;
    r.kneeL.rotation.x = Math.max(0, Math.sin(g - 1.3)) * (running ? 1.4 : 0.7) * amp + 0.08;
    r.kneeR.rotation.x = Math.max(0, Math.sin(g + Math.PI - 1.3)) * (running ? 1.4 : 0.7) * amp + 0.08;
    const bob = Math.abs(Math.sin(g)) * (running ? 0.07 : 0.03) * amp;
    r.pelvis.position.y = 0.95 - bob - (running ? 0.04 : 0);
    r.pelvis.rotation.z = Math.sin(g) * 0.06 * amp + (this.kind === 'shambler' ? (1 - limp) * 0.15 : 0);
    r.pelvis.rotation.y = Math.sin(g) * 0.12 * amp;

    // posture
    let lean = running ? 0.32 : 0.12;
    if (this.kind === 'shambler') lean = 0.18;
    if (this.kind === 'bloater') lean = 0.05;
    if (this.kind === 'brute') lean = 0.22;
    const hx = this.hitSpringX.update(dt);
    const hz = this.hitSpringZ.update(dt);
    r.spine.rotation.x = lean - hx * 0.12;
    r.spine.rotation.z = -hz * 0.1;
    r.spine.rotation.y = -Math.sin(g) * 0.1 * amp;
    r.chest.rotation.x = 0.05;

    // arms
    let la = 0;
    let ra = 0;
    let le = -0.25;
    let re = -0.25;
    if (this.kind === 'shambler' || (this.kind === 'bloater' && !running)) {
      const reach = this.state === 'chase' || this.state === 'investigate' ? this.armReach : 0.4;
      la = -1.25 * reach + Math.sin(g * 0.5 + 1) * 0.15;
      ra = -1.1 * reach + Math.sin(g * 0.5) * 0.15;
      le = -0.35;
      re = -0.5;
    } else if (running) {
      la = Math.sin(g) * 0.9 * amp - 0.2;
      ra = -Math.sin(g) * 0.9 * amp - 0.2;
      le = -1.3;
      re = -1.3;
    } else {
      la = Math.sin(g) * 0.35 * amp;
      ra = -Math.sin(g) * 0.35 * amp;
    }
    r.shoulderL.rotation.z = -0.12;
    r.shoulderR.rotation.z = 0.12;

    // state overlays
    let jaw = 0.1 + Math.max(0, Math.sin(ctx.time * 3 + this.id)) * 0.1;
    if (this.state === 'attack') {
      const wind = this.def.attackWindup / ctx.scaling.aggression;
      const t = this.stateTime / wind;
      if (t < 1) {
        la = ra = -2.6 * t;
        le = re = -0.8 * t;
        r.spine.rotation.x = lean - 0.2 * t;
      } else {
        const s = clamp((this.stateTime - wind) / 0.18, 0, 1);
        la = ra = -2.6 + 2.2 * s;
        le = re = -0.8 + 0.6 * s;
        r.spine.rotation.x = lean + 0.45 * s;
      }
      jaw = 0.5;
    } else if (this.state === 'scream') {
      la = ra = 0.3;
      le = re = -0.2;
      r.spine.rotation.x = -0.35;
      r.shoulderL.rotation.z = -0.6;
      r.shoulderR.rotation.z = 0.6;
      jaw = 0.9;
    } else if (this.state === 'charge' && this.stateTime < 0.75) {
      r.spine.rotation.x = 0.55;
      la = ra = 0.6;
      jaw = 0.8;
    } else if (this.state === 'stunned') {
      r.spine.rotation.x = 0.6 + Math.sin(ctx.time * 3) * 0.1;
      la = ra = 0.2;
      r.pelvis.position.y = 0.88;
    } else if (this.state === 'stagger') {
      r.spine.rotation.x = lean - 0.4 * (1 - this.stateTime / 0.55);
    } else if (this.state === 'bash') {
      const b = Math.sin(this.stateTime * 10);
      la = -1.6 - b * 0.8;
      ra = -1.6 + b * 0.8;
      le = re = -0.6;
      r.spine.rotation.x = 0.3;
    }
    r.shoulderL.rotation.x = la;
    r.shoulderR.rotation.x = ra;
    r.elbowL.rotation.x = le;
    r.elbowR.rotation.x = re;
    r.jaw.rotation.x = jaw;

    // head tracks the player when aware, twitches otherwise
    this.twitch -= dt;
    if (this.twitch <= 0) {
      this.twitch = rand(0.4, 3);
      this.headTilt = rand(-0.45, 0.45);
    }
    let lookY = 0;
    if (this.alerted && dist < 25) lookY = clamp(wrapAngle(Math.atan2(toPlayer.x, toPlayer.z) - this.yaw), -0.9, 0.9);
    r.neck.rotation.y = damp(r.neck.rotation.y, lookY * 0.5, 8, dt);
    r.head.rotation.y = damp(r.head.rotation.y, lookY * 0.5, 8, dt);
    r.head.rotation.z = damp(r.head.rotation.z, this.kind === 'runner' ? this.headTilt * 0.4 : this.headTilt, 6, dt);
    r.head.rotation.x = damp(r.head.rotation.x, -lean * 0.6 + (this.state === 'scream' ? -0.5 : 0), 6, dt);
    // keep hit boxes in sync for this frame's raycasts
    r.root.updateMatrixWorld(true);
  }

  private animateDeath(dt: number) {
    this.deathTime += dt;
    const r = this.rig;
    const t = this.deathTime;
    // knees buckle, then the body topples and settles
    const buckle = clamp(t / 0.3, 0, 1);
    const fall = clamp((t - 0.15) / 0.55, 0, 1);
    const f = fall * fall;
    const bounce = fall >= 1 ? Math.max(0, Math.sin((t - 0.7) * 14) * Math.exp(-(t - 0.7) * 8) * 0.08) : 0;
    r.kneeL.rotation.x = buckle * 0.9 * (1 - f * 0.7);
    r.kneeR.rotation.x = buckle * 1.1 * (1 - f * 0.7);
    r.hipL.rotation.x = -buckle * 0.4 * (1 - f);
    r.hipR.rotation.x = -buckle * 0.2 * (1 - f);
    r.body.rotation.x = this.fallDir * (f * (Math.PI / 2 - 0.08) - bounce);
    r.body.rotation.z = this.fallRoll * f;
    r.body.position.y = f * 0.12 - buckle * (1 - f) * 0.25;
    r.spine.rotation.x = damp(r.spine.rotation.x, this.fallDir * 0.15, 6, dt);
    r.shoulderL.rotation.x = damp(r.shoulderL.rotation.x, this.fallDir > 0 ? -2.6 : 0.4, 4, dt);
    r.shoulderR.rotation.x = damp(r.shoulderR.rotation.x, this.fallDir > 0 ? -2.2 : 0.6, 4, dt);
    r.shoulderL.rotation.z = damp(r.shoulderL.rotation.z, -0.9, 4, dt);
    r.shoulderR.rotation.z = damp(r.shoulderR.rotation.z, 0.7, 4, dt);
    r.elbowL.rotation.x = damp(r.elbowL.rotation.x, -0.2, 4, dt);
    r.elbowR.rotation.x = damp(r.elbowR.rotation.x, -0.5, 4, dt);
    r.jaw.rotation.x = damp(r.jaw.rotation.x, 0.6, 4, dt);
    r.head.rotation.z = damp(r.head.rotation.z, this.fallRoll > 0 ? 0.8 : -0.8, 3, dt);
    r.root.updateMatrixWorld(true);
  }

  /** World-space point near the torso for loot prompts. */
  corpsePoint(out: THREE.Vector3) {
    return this.rig.spine.getWorldPosition(out);
  }

  /** Sprites: hide the skeleton from the camera (layer 1) but keep it for hit detection. */
  setRenderMode(sprites: boolean) {
    if (this.spriteMode === sprites) return;
    this.spriteMode = sprites;
    this.rig.root.traverse((o) => o.layers.set(sprites ? 1 : 0));
    this.sprite.mesh.visible = sprites;
  }

  private updateSprite(dt: number, ctx: InfectedContext) {
    if (ctx.spriteMode !== this.spriteMode) this.setRenderMode(ctx.spriteMode);
    if (!this.spriteMode) return;
    let anim: AnimName = 'idle';
    let speed = 1;
    const v = this.moveSpeed;
    switch (this.state) {
      case 'dead': anim = 'death'; break;
      case 'attack': case 'bash': anim = 'attack'; break;
      case 'scream': anim = 'scream'; break;
      case 'stagger': case 'stunned': anim = 'pain'; break;
      case 'charge': anim = this.stateTime < 0.75 ? 'scream' : 'run'; speed = 1.6; break;
      default:
        if (v > 2.2) { anim = 'run'; speed = v / 4.5; }
        else if (v > 0.15) { anim = 'walk'; speed = Math.max(0.6, v / 1.1); }
    }
    // mirror the sheet when crossing the view right-to-left
    const vx = ctx.cameraPos.x - this.pos.x;
    const vz = ctx.cameraPos.z - this.pos.z;
    const lateral = this.vel.x * vz - this.vel.z * vx;
    if (Math.abs(lateral) > 0.3 * Math.hypot(vx, vz)) this.spriteFlip = lateral < 0;
    this.sprite.update(dt, anim, this.pos, this.scale, ctx.cameraPos, speed, this.spriteFlip, 0.6 + mutationLevel * 1.4);
  }

  dispose() {
    this.rig.root.removeFromParent();
    this.sprite.dispose();
  }
}
