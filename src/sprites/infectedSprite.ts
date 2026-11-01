import * as THREE from 'three';
import { sprites, type AnimName, type SpriteAnim } from './library';
import type { InfectedKind } from '../data/infected';
import { applyRig, enablePuppet, puppetUniforms, type PuppetUniforms } from './puppet';

// subdivided so the puppet deformer has vertices to bend
const quad = new THREE.PlaneGeometry(1, 1, 14, 36).translate(0, 0.5, 0);

/**
 * Camera-facing (Y-axis) billboard that plays a sprite sheet. The infected's skeleton keeps
 * running hidden underneath, so hit zones (head/body/limbs) and every gameplay system stay the
 * same whether the game renders sprites or models.
 */
export class InfectedSprite {
  readonly mesh: THREE.Mesh;
  private material: THREE.MeshStandardMaterial;
  private depth: THREE.MeshDepthMaterial;
  private anim: SpriteAnim | null = null;
  private name: AnimName | null = null;
  private t = 0;
  private map: THREE.Texture | null = null;
  private emap: THREE.Texture | null = null;
  private hurt = 0;
  /** single-image art has no baked emissive; it gets a dim self-light so it reads in the dark */
  private selfLit = false;
  private pu: PuppetUniforms = puppetUniforms();
  private gait = Math.random() * 10;
  private headT = Math.random() * 10;
  private attackK = 0;
  private screamK = 0;
  private walkK = 0;

  constructor(private kind: InfectedKind | 'patientZero') {
    this.material = new THREE.MeshStandardMaterial({
      alphaTest: 0.5,
      side: THREE.DoubleSide,
      roughness: 1,
      metalness: 0,
      emissive: '#ffffff',
      emissiveIntensity: 1,
    });
    this.depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, alphaTest: 0.5 });
    enablePuppet(this.material, this.pu);
    enablePuppet(this.depth, this.pu);
    this.mesh = new THREE.Mesh(quad, this.material);
    this.mesh.castShadow = true;
    this.mesh.customDepthMaterial = this.depth;
  }

  flashHurt() {
    this.hurt = 1;
  }

  private setAnim(name: AnimName) {
    if (name === this.name) return;
    this.name = name;
    this.t = 0;
    const a = sprites.anim(this.kind, name);
    if (a === this.anim) return;
    this.anim = a;
    this.map?.dispose();
    this.emap?.dispose();
    this.map = a.texture.clone();
    this.map.needsUpdate = true;
    this.material.map = this.map;
    this.depth.map = this.map;
    if (a.emissive) {
      this.emap = a.emissive.clone();
      this.emap.needsUpdate = true;
      this.material.emissiveMap = this.emap;
      this.material.emissive.set('#ffffff');
    } else {
      this.emap = this.map;
      this.material.emissiveMap = this.map;
      this.material.emissive.set('#161616');
    }
    this.selfLit = !a.emissive;
    applyRig(this.pu, a.rig ?? null);
    this.material.needsUpdate = true;
    this.depth.needsUpdate = true;
  }

  /**
   * @param speed playback multiplier (walk cycles follow movement speed)
   * @param flip mirror horizontally (moving right-to-left across the view)
   */
  update(dt: number, name: AnimName, pos: THREE.Vector3, scale: number, camera: THREE.Vector3, speed: number, flip: boolean, glow: number) {
    this.setAnim(name);
    const a = this.anim!;
    this.t += dt * speed;
    const raw = Math.floor(this.t * a.fps);
    const frame = a.loop ? raw % a.frames : Math.min(a.frames - 1, raw);
    const w = 1 / a.frames;
    for (const tx of [this.map, this.emap]) {
      if (!tx) continue;
      tx.repeat.set(flip ? -w : w, 1);
      tx.offset.set(flip ? (frame + 1) * w : frame * w, 0);
    }
    this.mesh.position.copy(pos);
    this.mesh.rotation.order = 'YXZ';
    this.mesh.rotation.y = Math.atan2(camera.x - pos.x, camera.z - pos.z);
    this.mesh.rotation.x = 0;
    this.mesh.rotation.z = 0;
    this.mesh.scale.set(a.width * scale, a.height * scale, 1);
    if (a.frames === 1) {
      this.drivePuppet(dt, name, speed, flip, a);
      this.procedural(name, a, scale, flip);
    }
    this.hurt = Math.max(0, this.hurt - dt * 6);
    // painted art already carries its own lighting; keep it from clipping under the flashlight
    const near = Math.hypot(camera.x - pos.x, camera.z - pos.z);
    const base = this.selfLit ? 0.62 * Math.min(1, Math.max(0.45, (near - 0.6) / 2.6)) : 1;
    this.material.color.setRGB(base, base * (1 - this.hurt * 0.6), base * (1 - this.hurt * 0.6));
    this.material.emissiveIntensity = this.selfLit ? 1 + this.hurt : glow;
  }

  /** Feed the deformer: gait phase, limb weights, head motion. Eased so states blend. */
  private drivePuppet(dt: number, name: AnimName, speed: number, flip: boolean, a: SpriteAnim) {
    const u = this.pu;
    const moving = name === 'walk' || name === 'run';
    const ease = (cur: number, target: number, rate: number) => cur + (target - cur) * Math.min(1, dt * rate);
    this.walkK = ease(this.walkK, moving ? (name === 'run' ? 1.35 : 1) : 0, 8);
    this.attackK = ease(this.attackK, name === 'attack' ? Math.sin(Math.min(1, this.t * 2.2) * Math.PI) * 1.1 : 0, 18);
    this.screamK = ease(this.screamK, name === 'scream' ? 1 : 0, 10);
    this.gait += dt * (name === 'run' ? 10 : 5.6) * Math.max(0.5, speed) * (moving ? 1 : 0.25);
    this.headT += dt;
    u.uPhase.value = this.gait;
    u.uWalk.value = this.walkK;
    u.uArms.value = this.walkK * (name === 'run' ? 1.4 : 0.8);
    u.uAttack.value = this.attackK;
    u.uScream.value = this.screamK;
    u.uBreath.value = Math.sin(this.headT * 2.1);
    // slow look-around with an occasional twitch
    const twitch = Math.sin(this.headT * 13) * Math.max(0, Math.sin(this.headT * 0.7) - 0.85) * 2;
    u.uHead.value = (Math.sin(this.headT * 0.6) * 0.06 + twitch * 0.15) * (name === 'death' ? 0 : 1) + (name === 'pain' ? 0.15 : 0);
    // the texture may be mirrored; joints are stored in image space
    const r = a.rig;
    if (r) {
      const mx = (x: number) => (flip ? 1 - x : x);
      u.uLegX.value = mx(r.legX);
      u.uBodyX.value = mx(r.bodyX);
      u.uHeadX.value = mx(r.headX);
    }
  }

  /**
   * Motion for single-pose artwork (concept paintings): bob and sway while moving, a lunge for
   * attacks, a shudder for screams, a recoil on pain, and a backwards fall that leaves the body
   * lying on the floor.
   */
  private procedural(name: AnimName, a: SpriteAnim, scale: number, flip: boolean) {
    const m = this.mesh;
    const t = this.t;
    const h = a.height * scale;
    const side = flip ? -1 : 1;
    switch (name) {
      case 'idle':
        m.scale.y *= 1 + Math.sin(t * 2.2) * 0.012;
        m.rotation.z = Math.sin(t * 0.9) * 0.015;
        break;
      case 'walk':
        // steps come from the puppet deformer; the body rises on each footfall
        m.position.y += Math.abs(Math.cos(this.gait)) * 0.022 * h;
        m.rotation.z = Math.sin(this.gait) * 0.02 * side;
        break;
      case 'run':
        m.position.y += Math.abs(Math.cos(this.gait)) * 0.04 * h;
        m.rotation.z = Math.sin(this.gait) * 0.03 * side;
        m.rotation.x = -0.1;
        break;
      case 'attack': {
        const k = Math.sin(Math.min(1, t * 2.2) * Math.PI);
        m.rotation.x = -0.2 * k;
        m.scale.multiplyScalar(1 + 0.06 * k);
        break;
      }
      case 'scream':
        m.rotation.x = 0.06;
        break;
      case 'pain':
        m.rotation.x = 0.18 * Math.max(0, 1 - t * 3);
        break;
      case 'death': {
        // topple away from the camera and settle on the floor
        const f = Math.min(1, t * 1.6);
        const e = f * f;
        m.rotation.x = e * (Math.PI / 2 - 0.04);
        m.rotation.z = e * 0.25 * side;
        m.position.y += 0.02;
        if (f >= 1) m.rotation.x -= Math.sin(Math.min(1, t * 1.6 - 1) * Math.PI * 3) * 0.03 * Math.max(0, 1 - (t * 1.6 - 1));
        break;
      }
    }
  }

  /** true once a non-looping animation has shown its last frame */
  get finished() {
    const a = this.anim;
    return !!a && !a.loop && this.t * a.fps >= a.frames;
  }

  dispose() {
    this.mesh.removeFromParent();
    this.map?.dispose();
    this.emap?.dispose();
    this.material.dispose();
    this.depth.dispose();
  }
}
