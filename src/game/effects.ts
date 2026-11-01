import * as THREE from 'three';
import { bloodTexture, bulletHoleTexture, smokeTexture, softDotTexture } from '../world/textures';
import { rand } from '../core/math';

const FOG_DENSITY = 0.038;

class Particles {
  readonly points: THREE.Points;
  private pos: Float32Array;
  private col: Float32Array;
  private alpha: Float32Array;
  private size: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private grow: Float32Array;
  private grav: Float32Array;
  private drag: Float32Array;
  private a0: Float32Array;
  private cursor = 0;
  readonly material: THREE.ShaderMaterial;

  constructor(readonly max: number, tex: THREE.Texture, blending: THREE.Blending) {
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.alpha = new Float32Array(max);
    this.size = new Float32Array(max);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.grow = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.a0 = new Float32Array(max);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    this.material = new THREE.ShaderMaterial({
      uniforms: { uTex: { value: tex }, uScale: { value: 600 }, uFog: { value: FOG_DENSITY } },
      vertexShader: /* glsl */ `
        attribute float alpha; attribute float size; attribute vec3 color;
        uniform float uScale, uFog;
        varying float vA; varying vec3 vC;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          float d = -mv.z;
          gl_PointSize = size * uScale / max(d, 0.05);
          float fog = 1.0 - exp(-uFog * uFog * d * d);
          vA = alpha * (1.0 - fog);
          vC = color;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uTex; varying float vA; varying vec3 vC;
        void main() {
          vec4 t = texture2D(uTex, gl_PointCoord);
          gl_FragColor = vec4(vC * t.rgb, t.a * vA);
          if (gl_FragColor.a < 0.003) discard;
        }`,
      transparent: true,
      depthWrite: false,
      blending,
    });
    this.points = new THREE.Points(g, this.material);
    this.points.frustumCulled = false;
  }

  emit(p: THREE.Vector3, v: THREE.Vector3, color: THREE.Color, size: number, life: number, opts: { grow?: number; grav?: number; drag?: number; alpha?: number } = {}) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    this.pos.set([p.x, p.y, p.z], i * 3);
    this.vel.set([v.x, v.y, v.z], i * 3);
    this.col.set([color.r, color.g, color.b], i * 3);
    this.size[i] = size;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.grow[i] = opts.grow ?? 0;
    this.grav[i] = opts.grav ?? 0;
    this.drag[i] = opts.drag ?? 0;
    this.a0[i] = opts.alpha ?? 1;
    this.alpha[i] = this.a0[i];
  }

  update(dt: number) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) {
        this.alpha[i] = 0;
        continue;
      }
      this.life[i] -= dt;
      const k = i * 3;
      const drag = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[k] *= drag;
      this.vel[k + 1] = this.vel[k + 1] * drag - this.grav[i] * dt;
      this.vel[k + 2] *= drag;
      this.pos[k] += this.vel[k] * dt;
      this.pos[k + 1] += this.vel[k + 1] * dt;
      this.pos[k + 2] += this.vel[k + 2] * dt;
      if (this.pos[k + 1] < 0.02) {
        this.pos[k + 1] = 0.02;
        this.vel[k + 1] *= -0.2;
        this.vel[k] *= 0.5;
        this.vel[k + 2] *= 0.5;
      }
      this.size[i] += this.grow[i] * dt;
      const t = this.life[i] / this.maxLife[i];
      this.alpha[i] = this.a0[i] * Math.min(1, t * 2.5);
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.alpha.needsUpdate = true;
    g.attributes.size.needsUpdate = true;
    g.attributes.color.needsUpdate = true;
  }

  clear() {
    this.life.fill(0);
    this.alpha.fill(0);
  }
}

interface Decal {
  mesh: THREE.Mesh;
  age: number;
}

interface Flash {
  light: THREE.PointLight;
  t: number;
  dur: number;
  peak: number;
}

/**
 * Particles, decals, tracers and transient lights. Everything is pooled: no allocations once the
 * level is running.
 */
export class Effects {
  readonly group = new THREE.Group();
  private sparks: Particles;
  private blood: Particles;
  private smoke: Particles;
  private holes: Decal[] = [];
  private splats: Decal[] = [];
  private holeIdx = 0;
  private splatIdx = 0;
  private tracers: { mesh: THREE.Mesh; t: number }[] = [];
  private tracerIdx = 0;
  private flashes: Flash[] = [];
  private tmpV = new THREE.Vector3();
  private tmpC = new THREE.Color();

  constructor() {
    const dot = softDotTexture();
    this.sparks = new Particles(600, dot, THREE.AdditiveBlending);
    this.blood = new Particles(700, dot, THREE.NormalBlending);
    this.smoke = new Particles(500, smokeTexture(), THREE.NormalBlending);
    this.group.add(this.smoke.points, this.blood.points, this.sparks.points);

    const holeTex = bulletHoleTexture();
    const holeMat = new THREE.MeshStandardMaterial({ map: holeTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, roughness: 1 });
    const holeGeo = new THREE.PlaneGeometry(0.11, 0.11);
    for (let i = 0; i < 90; i++) {
      const m = new THREE.Mesh(holeGeo, holeMat);
      m.visible = false;
      m.receiveShadow = true;
      this.group.add(m);
      this.holes.push({ mesh: m, age: 0 });
    }
    const splatGeo = new THREE.PlaneGeometry(1, 1);
    const splatMats = [1, 2, 3, 4].map(
      (s) => new THREE.MeshStandardMaterial({ map: bloodTexture(s * 31), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, roughness: 0.25 }),
    );
    for (let i = 0; i < 60; i++) {
      const m = new THREE.Mesh(splatGeo, splatMats[i % splatMats.length]);
      m.visible = false;
      m.receiveShadow = true;
      this.group.add(m);
      this.splats.push({ mesh: m, age: 0 });
    }
    const tracerGeo = new THREE.CylinderGeometry(0.008, 0.008, 1, 4, 1, true);
    tracerGeo.rotateX(Math.PI / 2);
    tracerGeo.translate(0, 0, 0.5);
    const tracerMat = new THREE.MeshBasicMaterial({ color: '#ffd9a0', transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
    for (let i = 0; i < 16; i++) {
      const m = new THREE.Mesh(tracerGeo, tracerMat);
      m.visible = false;
      this.group.add(m);
      this.tracers.push({ mesh: m, t: 0 });
    }
    for (let i = 0; i < 2; i++) {
      const light = new THREE.PointLight('#ffb070', 0, 10, 2);
      this.group.add(light);
      this.flashes.push({ light, t: 0, dur: 0, peak: 0 });
    }
  }

  setViewScale(heightPx: number, fovDeg: number) {
    const s = heightPx / (2 * Math.tan((fovDeg * Math.PI) / 360));
    for (const p of [this.sparks, this.blood, this.smoke]) p.material.uniforms.uScale.value = s;
  }

  // ------------------------------------------------------------------ emitters

  impactSurface(p: THREE.Vector3, n: THREE.Vector3, metal: boolean) {
    const c = this.tmpC;
    for (let i = 0; i < (metal ? 9 : 4); i++) {
      this.tmpV.copy(n).multiplyScalar(rand(1.5, 4)).add(new THREE.Vector3(rand(-2, 2), rand(-1, 2.5), rand(-2, 2)));
      this.sparks.emit(p, this.tmpV, c.setRGB(1.4, 0.9, 0.5), rand(0.012, 0.025), rand(0.08, 0.25), { grav: 9, drag: 2 });
    }
    for (let i = 0; i < 4; i++) {
      this.tmpV.copy(n).multiplyScalar(rand(0.3, 1.2)).add(new THREE.Vector3(rand(-0.3, 0.3), rand(0, 0.4), rand(-0.3, 0.3)));
      this.smoke.emit(p, this.tmpV, c.setRGB(0.45, 0.47, 0.44), rand(0.08, 0.16), rand(0.5, 1.1), { grow: 0.4, drag: 2, alpha: 0.5 });
    }
  }

  bloodHit(p: THREE.Vector3, dir: THREE.Vector3, amount = 1) {
    const c = this.tmpC;
    const n = Math.round(10 * amount);
    for (let i = 0; i < n; i++) {
      this.tmpV.copy(dir).multiplyScalar(rand(0.5, 3.5)).add(new THREE.Vector3(rand(-1.2, 1.2), rand(-0.4, 1.8), rand(-1.2, 1.2)));
      const dark = rand(0.18, 0.32);
      this.blood.emit(p, this.tmpV, c.setRGB(dark, 0.015, 0.02), rand(0.015, 0.045), rand(0.4, 0.9), { grav: 9.8, drag: 0.6 });
    }
    for (let i = 0; i < 3 * amount; i++) {
      this.tmpV.copy(dir).multiplyScalar(rand(0.2, 0.8));
      this.blood.emit(p, this.tmpV, c.setRGB(0.25, 0.02, 0.03), rand(0.08, 0.16), rand(0.25, 0.45), { grow: 0.5, drag: 3, alpha: 0.7 });
    }
  }

  gore(p: THREE.Vector3) {
    this.bloodHit(p, new THREE.Vector3(0, 1, 0), 3);
    const c = this.tmpC;
    for (let i = 0; i < 12; i++) {
      this.tmpV.set(rand(-2, 2), rand(1, 4), rand(-2, 2));
      this.blood.emit(p, this.tmpV, c.setRGB(0.2, 0.05, 0.06), rand(0.04, 0.07), rand(0.6, 1.1), { grav: 9.8 });
    }
  }

  muzzleSmoke(p: THREE.Vector3, dir: THREE.Vector3) {
    for (let i = 0; i < 2; i++) {
      this.tmpV.copy(dir).multiplyScalar(rand(0.4, 1.2)).add(new THREE.Vector3(0, rand(0.1, 0.4), 0));
      this.smoke.emit(p, this.tmpV, this.tmpC.setRGB(0.6, 0.6, 0.58), rand(0.06, 0.12), rand(0.4, 0.8), { grow: 0.5, drag: 2.5, alpha: 0.25 });
    }
  }

  explosion(p: THREE.Vector3) {
    const c = this.tmpC;
    for (let i = 0; i < 60; i++) {
      this.tmpV.set(rand(-1, 1), rand(-0.2, 1), rand(-1, 1)).normalize().multiplyScalar(rand(4, 14));
      this.sparks.emit(p, this.tmpV, c.setRGB(2, 1.1, 0.4), rand(0.02, 0.05), rand(0.2, 0.7), { grav: 9, drag: 1.5 });
    }
    for (let i = 0; i < 18; i++) {
      this.tmpV.set(rand(-1, 1), rand(0, 1), rand(-1, 1)).normalize().multiplyScalar(rand(1, 4));
      this.sparks.emit(p, this.tmpV, c.setRGB(1.6, 0.6, 0.15), rand(0.35, 0.7), rand(0.15, 0.35), { grow: 2, drag: 4 });
    }
    for (let i = 0; i < 26; i++) {
      this.tmpV.set(rand(-1, 1), rand(0, 1), rand(-1, 1)).normalize().multiplyScalar(rand(1, 3.5));
      this.smoke.emit(p.clone().add(new THREE.Vector3(0, 0.3, 0)), this.tmpV, c.setRGB(0.18, 0.18, 0.17), rand(0.5, 0.9), rand(1.8, 3.2), { grow: 0.9, drag: 1.6, alpha: 0.75 });
    }
    this.flash(p.clone().setY(p.y + 0.8), '#ffae5a', 140, 0.35);
  }

  gasPuff(p: THREE.Vector3, radius: number) {
    const c = this.tmpC;
    for (let i = 0; i < 3; i++) {
      const o = new THREE.Vector3(rand(-1, 1), 0, rand(-1, 1)).multiplyScalar(radius * 0.8);
      o.y = rand(0.2, 1.6);
      this.tmpV.set(rand(-0.3, 0.3), rand(0, 0.25), rand(-0.3, 0.3));
      this.smoke.emit(p.clone().add(o), this.tmpV, c.setRGB(0.42, 0.36, 0.6), rand(0.8, 1.4), rand(1.4, 2.4), { grow: 0.35, drag: 1, alpha: 0.32 });
    }
  }

  flareSparks(p: THREE.Vector3) {
    const c = this.tmpC;
    for (let i = 0; i < 2; i++) {
      this.tmpV.set(rand(-0.8, 0.8), rand(0.8, 2), rand(-0.8, 0.8));
      this.sparks.emit(p, this.tmpV, c.setRGB(2, 0.4, 0.25), rand(0.02, 0.04), rand(0.2, 0.5), { grav: 6 });
    }
    this.tmpV.set(rand(-0.1, 0.1), rand(0.3, 0.6), rand(-0.1, 0.1));
    this.smoke.emit(p, this.tmpV, c.setRGB(0.5, 0.25, 0.25), rand(0.15, 0.3), rand(1, 2), { grow: 0.4, drag: 0.5, alpha: 0.25 });
  }

  // ------------------------------------------------------------------ decals

  bulletHole(p: THREE.Vector3, n: THREE.Vector3) {
    const d = this.holes[this.holeIdx];
    this.holeIdx = (this.holeIdx + 1) % this.holes.length;
    d.mesh.visible = true;
    d.mesh.position.copy(p).addScaledVector(n, 0.004);
    d.mesh.lookAt(this.tmpV.copy(p).add(n));
    d.mesh.rotateZ(rand(0, Math.PI * 2));
    d.mesh.scale.setScalar(rand(0.8, 1.3));
  }

  bloodSplat(p: THREE.Vector3, n: THREE.Vector3, size: number) {
    const d = this.splats[this.splatIdx];
    this.splatIdx = (this.splatIdx + 1) % this.splats.length;
    d.mesh.visible = true;
    d.mesh.position.copy(p).addScaledVector(n, 0.006 + this.splatIdx * 0.00005);
    d.mesh.lookAt(this.tmpV.copy(p).add(n));
    d.mesh.rotateZ(rand(0, Math.PI * 2));
    d.mesh.scale.setScalar(size);
  }

  tracer(from: THREE.Vector3, to: THREE.Vector3) {
    const t = this.tracers[this.tracerIdx];
    this.tracerIdx = (this.tracerIdx + 1) % this.tracers.length;
    const len = from.distanceTo(to);
    if (len < 2) return;
    // start a little ahead of the muzzle so it reads as a streak
    t.mesh.position.copy(from);
    t.mesh.lookAt(to);
    t.mesh.scale.set(1, 1, len);
    t.mesh.visible = true;
    t.t = 0.05;
  }

  flash(p: THREE.Vector3, color: THREE.ColorRepresentation, peak: number, dur: number) {
    const f = this.flashes.reduce((a, b) => (a.t <= b.t ? a : b));
    f.light.position.copy(p);
    f.light.color.set(color);
    f.t = dur;
    f.dur = dur;
    f.peak = peak;
    f.light.intensity = peak;
  }

  update(dt: number) {
    this.sparks.update(dt);
    this.blood.update(dt);
    this.smoke.update(dt);
    for (const t of this.tracers) {
      if (!t.mesh.visible) continue;
      t.t -= dt;
      if (t.t <= 0) t.mesh.visible = false;
    }
    for (const f of this.flashes) {
      if (f.t <= 0) {
        f.light.intensity = 0;
        continue;
      }
      f.t -= dt;
      f.light.intensity = f.peak * Math.max(0, f.t / f.dur);
    }
  }

  clear() {
    this.sparks.clear();
    this.blood.clear();
    this.smoke.clear();
    for (const d of [...this.holes, ...this.splats]) d.mesh.visible = false;
    for (const t of this.tracers) t.mesh.visible = false;
    for (const f of this.flashes) {
      f.t = 0;
      f.light.intensity = 0;
    }
  }
}
