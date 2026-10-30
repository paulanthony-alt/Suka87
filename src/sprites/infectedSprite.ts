import * as THREE from 'three';
import { sprites, type AnimName, type SpriteAnim } from './library';
import type { InfectedKind } from '../data/infected';

const quad = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);

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

  constructor(private kind: InfectedKind | 'patientZero') {
    this.material = new THREE.MeshStandardMaterial({
      alphaTest: 0.5,
      side: THREE.DoubleSide,
      roughness: 0.85,
      emissive: '#ffffff',
      emissiveIntensity: 1,
    });
    this.depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, alphaTest: 0.5 });
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
      this.emap = null;
      this.material.emissiveMap = null;
      this.material.emissive.set('#000000');
    }
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
    this.mesh.rotation.y = Math.atan2(camera.x - pos.x, camera.z - pos.z);
    this.mesh.scale.set(a.width * scale, a.height * scale, 1);
    this.hurt = Math.max(0, this.hurt - dt * 6);
    this.material.color.setRGB(1, 1 - this.hurt * 0.6, 1 - this.hurt * 0.6);
    this.material.emissiveIntensity = glow;
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
