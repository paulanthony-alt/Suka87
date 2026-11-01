import * as THREE from 'three';
import type { InfectedKind } from '../data/infected';
import { detectRig, type PuppetRig } from './puppet';

/**
 * 2D sprite assets. Artwork is loaded from `public/sprites/sprites.json` (see
 * `public/sprites/README.md`); anything the manifest doesn't provide falls back to a generated
 * placeholder sheet so the game always runs.
 */

export type AnimName = 'idle' | 'walk' | 'run' | 'attack' | 'pain' | 'scream' | 'death';

export interface SpriteAnim {
  texture: THREE.Texture;
  emissive: THREE.Texture | null;
  frames: number;
  fps: number;
  loop: boolean;
  /** world size of one frame in metres (before the infected's own scale) */
  width: number;
  height: number;
  /** joints for puppet animation (single-image art only) */
  rig?: PuppetRig;
}

interface AnimSpec {
  file: string;
  frames: number;
  fps?: number;
  loop?: boolean;
  emissive?: string;
}

interface Manifest {
  infected?: Partial<Record<InfectedKind | 'patientZero', { height?: number; anims: Partial<Record<AnimName, AnimSpec>> }>>;
  weapons?: Partial<Record<string, { idle: string; fire?: string; reload?: string }>>;
  pickups?: Partial<Record<string, string>>;
}

const LOOPING: Record<AnimName, boolean> = { idle: true, walk: true, run: true, attack: false, pain: false, scream: true, death: false };

class SpriteLibrary {
  private infected = new Map<string, Map<AnimName, SpriteAnim>>();
  weaponImages = new Map<string, { idle: HTMLImageElement; fire?: HTMLImageElement; reload?: HTMLImageElement }>();
  pickupImages = new Map<string, HTMLImageElement>();
  loaded = false;
  /** list of files the manifest named that failed to load, for the console */
  missing: string[] = [];

  async load(base = 'sprites/') {
    let manifest: Manifest = {};
    try {
      const res = await fetch(base + 'sprites.json', { cache: 'no-cache' });
      if (res.ok) manifest = (await res.json()) as Manifest;
    } catch {
      /* no manifest: placeholders only */
    }

    const img = (file: string) =>
      new Promise<HTMLImageElement | null>((resolve) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = () => {
          this.missing.push(file);
          resolve(null);
        };
        i.src = base + file;
      });

    const jobs: Promise<void>[] = [];
    for (const [kind, spec] of Object.entries(manifest.infected ?? {})) {
      if (!spec) continue;
      const map = new Map<AnimName, SpriteAnim>();
      this.infected.set(kind, map);
      for (const [anim, a] of Object.entries(spec.anims) as [AnimName, AnimSpec][]) {
        jobs.push(
          (async () => {
            const [im, em] = await Promise.all([img(a.file), a.emissive ? img(a.emissive) : Promise.resolve(null)]);
            if (!im) return;
            const h = spec.height ?? 2;
            map.set(anim, {
              texture: tex(im),
              emissive: em ? tex(em) : null,
              frames: a.frames,
              fps: a.fps ?? 8,
              loop: a.loop ?? LOOPING[anim],
              height: h,
              width: (h * im.width) / a.frames / im.height,
              rig: a.frames === 1 ? detectRig(im) : undefined,
            });
          })(),
        );
      }
    }
    for (const [id, w] of Object.entries(manifest.weapons ?? {})) {
      if (!w) continue;
      jobs.push(
        (async () => {
          const [idle, fire, reload] = await Promise.all([img(w.idle), w.fire ? img(w.fire) : null, w.reload ? img(w.reload) : null]);
          if (idle) this.weaponImages.set(id, { idle, fire: fire ?? undefined, reload: reload ?? undefined });
        })(),
      );
    }
    for (const [key, file] of Object.entries(manifest.pickups ?? {})) {
      if (!file) continue;
      jobs.push(
        (async () => {
          const i = await img(file);
          if (i) this.pickupImages.set(key, i);
        })(),
      );
    }
    await Promise.all(jobs);
    if (this.missing.length) console.warn('[sprites] could not load:', this.missing.join(', '));
    this.loaded = true;
  }

  /** Animation for an infected kind, falling back to idle/walk then to a generated placeholder. */
  anim(kind: InfectedKind | 'patientZero', name: AnimName): SpriteAnim {
    const custom = this.infected.get(kind) ?? (kind === 'patientZero' ? this.infected.get('brute') : undefined);
    if (custom) {
      const a = custom.get(name) ?? custom.get(FALLBACK[name]) ?? custom.get('walk') ?? custom.get('idle');
      if (a) return a;
    }
    return placeholder(kind === 'patientZero' ? 'brute' : kind, name);
  }
}

const FALLBACK: Record<AnimName, AnimName> = { idle: 'walk', walk: 'idle', run: 'walk', attack: 'walk', pain: 'idle', scream: 'attack', death: 'pain' };

function tex(source: HTMLImageElement | HTMLCanvasElement) {
  const t = new THREE.Texture(source);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.wrapS = THREE.RepeatWrapping;
  t.needsUpdate = true;
  return t;
}

export const sprites = new SpriteLibrary();

// ------------------------------------------------------------------ placeholder sheets
// Silhouettes in the style of the HUD concept art: near-black bodies, a cool rim line and violet
// eyes. Front-facing, drawn per frame from a simple pose description.

interface Pose {
  stride: number;
  bob: number;
  armA: number;
  reach: number;
  swing: number;
  headBack: number;
  mouth: number;
  crumple: number;
  roll: number;
  lean: number;
}

const BASE: Pose = { stride: 0, bob: 0, armA: 0.15, reach: 0, swing: 0, headBack: 0, mouth: 0.1, crumple: 0, roll: 0, lean: 0 };

interface Build {
  hipW: number;
  shoulderW: number;
  torsoW: number;
  leg: number;
  arm: number;
  head: number;
  neck: number;
  bloated?: boolean;
  armored?: boolean;
  frameW: number;
  cloth: string;
}

const BUILDS: Record<InfectedKind, Build> = {
  shambler: { hipW: 0.2, shoulderW: 0.4, torsoW: 0.34, leg: 0.14, arm: 0.1, head: 0.115, neck: 0.1, frameW: 160, cloth: '#15211f' },
  runner: { hipW: 0.18, shoulderW: 0.37, torsoW: 0.3, leg: 0.12, arm: 0.09, head: 0.11, neck: 0.1, frameW: 160, cloth: '#141616' },
  screamer: { hipW: 0.16, shoulderW: 0.32, torsoW: 0.26, leg: 0.1, arm: 0.075, head: 0.12, neck: 0.18, frameW: 160, cloth: '#1a1720' },
  bloater: { hipW: 0.26, shoulderW: 0.5, torsoW: 0.82, leg: 0.17, arm: 0.12, head: 0.12, neck: 0.06, bloated: true, frameW: 224, cloth: '#161c1a' },
  brute: { hipW: 0.3, shoulderW: 0.64, torsoW: 0.56, leg: 0.2, arm: 0.17, head: 0.125, neck: 0.08, armored: true, frameW: 224, cloth: '#121516' },
};

const SHEETS: Record<AnimName, { frames: number; fps: number; pose: (i: number, kind: InfectedKind) => Partial<Pose> }> = {
  idle: { frames: 2, fps: 2, pose: (i) => ({ bob: i * 0.012, armA: 0.12 + i * 0.03 }) },
  walk: {
    frames: 4,
    fps: 6,
    pose: (i, k) => ({ stride: Math.sin((i * Math.PI) / 2), bob: Math.abs(Math.sin((i * Math.PI) / 2)) * 0.03, reach: k === 'shambler' ? 0.85 : k === 'bloater' ? 0.3 : 0, swing: k === 'shambler' ? 0 : Math.sin((i * Math.PI) / 2) * 0.3 }),
  },
  run: { frames: 4, fps: 10, pose: (i) => ({ stride: Math.sin((i * Math.PI) / 2) * 1.6, bob: Math.abs(Math.sin((i * Math.PI) / 2)) * 0.06, swing: Math.sin((i * Math.PI) / 2) * 0.7, armA: 0.35, lean: 0.05 }) },
  attack: { frames: 4, fps: 9, pose: (i) => [{ reach: 0.7, armA: 0.4 }, { reach: 1.4, armA: 0.3, mouth: 0.6 }, { reach: 1.7, armA: 0.2, mouth: 0.8 }, { reach: 0.2, armA: 0.6, mouth: 0.5, lean: 0.04 }][i] },
  pain: { frames: 1, fps: 1, pose: () => ({ headBack: 1, armA: 0.6, mouth: 0.5, lean: -0.04 }) },
  scream: { frames: 2, fps: 7, pose: (i) => ({ headBack: 0.8 + i * 0.2, armA: 1.0 + i * 0.1, mouth: 1, bob: i * 0.01 }) },
  death: { frames: 5, fps: 9, pose: (i) => ({ crumple: [0, 0.3, 0.6, 0.85, 1][i], roll: 0.5, headBack: 0.6, armA: 0.5 + i * 0.15 }) },
};

const cache = new Map<string, SpriteAnim>();
const H = 256;
const PPM = H / 2;

function placeholder(kind: InfectedKind, name: AnimName): SpriteAnim {
  const key = `${kind}:${name}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const b = BUILDS[kind];
  const sheet = SHEETS[name];
  const W = b.frameW;
  const albedo = document.createElement('canvas');
  albedo.width = W * sheet.frames;
  albedo.height = H;
  const glow = document.createElement('canvas');
  glow.width = albedo.width;
  glow.height = H;
  const a = albedo.getContext('2d')!;
  const e = glow.getContext('2d')!;
  e.fillStyle = '#000';
  e.fillRect(0, 0, glow.width, H);
  for (let i = 0; i < sheet.frames; i++) {
    const pose = { ...BASE, ...sheet.pose(i, kind) };
    drawFigure(a, e, W * i + W / 2, H - 3, b, pose, kind, i);
  }
  const anim: SpriteAnim = {
    texture: tex(albedo),
    emissive: tex(glow),
    frames: sheet.frames,
    fps: sheet.fps,
    loop: LOOPING[name],
    height: 2,
    width: (2 * W) / H,
  };
  cache.set(key, anim);
  return anim;
}

function drawFigure(a: CanvasRenderingContext2D, e: CanvasRenderingContext2D, cx: number, ground: number, b: Build, p: Pose, kind: InfectedKind, frame: number) {
  for (const ctx of [a, e]) {
    ctx.save();
    ctx.translate(cx, ground);
    if (p.crumple) {
      ctx.rotate(p.roll * p.crumple * 0.6);
      ctx.scale(1 + p.crumple * 0.45, 1 - p.crumple * 0.8);
    }
  }
  const X = (m: number) => m * PPM;
  const Y = (m: number) => -m * PPM;
  const body = '#0b100f';
  const rim = '#4a5d57';
  const hipY = 0.95 - p.bob;
  const shY = 1.42 - p.bob;
  const lean = p.lean;

  const limb = (x1: number, y1: number, x2: number, y2: number, w: number, fill = body) => {
    a.lineCap = 'round';
    a.strokeStyle = rim;
    a.lineWidth = X(w) + 3;
    a.beginPath();
    a.moveTo(X(x1), Y(y1));
    a.lineTo(X(x2), Y(y2));
    a.stroke();
    a.strokeStyle = fill;
    a.lineWidth = X(w);
    a.stroke();
  };

  // legs (front view: a stride lifts one foot and pulls it in)
  for (const side of [-1, 1]) {
    const s = side * p.stride;
    const lift = Math.max(0, s) * 0.12;
    const hx = side * b.hipW * 0.5;
    const kx = hx + side * 0.03;
    const fx = hx + side * (0.05 - Math.max(0, s) * 0.06);
    limb(hx, hipY, kx, 0.5 + lift * 0.6, b.leg);
    limb(kx, 0.5 + lift * 0.6, fx, 0.05 + lift, b.leg * 0.85);
    limb(fx - side * 0.02, 0.04 + lift, fx + side * 0.06, 0.03 + lift, 0.08);
  }

  // torso
  a.fillStyle = b.cloth;
  a.strokeStyle = rim;
  a.lineWidth = 1.5;
  a.beginPath();
  if (b.bloated) a.ellipse(X(lean), Y((hipY + shY) / 2 - 0.02), X(b.torsoW / 2), X(0.38), 0, 0, Math.PI * 2);
  else {
    const tw = b.torsoW / 2;
    a.moveTo(X(-b.hipW * 0.6 + lean * 0.3), Y(hipY - 0.04));
    a.lineTo(X(-tw + lean), Y(shY - 0.12));
    a.quadraticCurveTo(X(-b.shoulderW / 2 + lean), Y(shY + 0.02), X(-0.06 + lean), Y(shY + 0.04));
    a.lineTo(X(0.06 + lean), Y(shY + 0.04));
    a.quadraticCurveTo(X(b.shoulderW / 2 + lean), Y(shY + 0.02), X(tw + lean), Y(shY - 0.12));
    a.lineTo(X(b.hipW * 0.6 + lean * 0.3), Y(hipY - 0.04));
    a.closePath();
  }
  a.fill();
  a.stroke();
  // grime and blood
  a.fillStyle = 'rgba(90,10,12,0.55)';
  for (let k = 0; k < 4; k++) {
    const bx = Math.sin(frame * 3 + k * 7.1 + kind.length) * b.torsoW * 0.3;
    const by = hipY + 0.1 + ((k * 0.37 + kind.length * 0.13) % 0.32);
    a.beginPath();
    a.ellipse(X(bx + lean), Y(by), X(0.03 + (k % 2) * 0.03), X(0.02 + (k % 3) * 0.015), k, 0, Math.PI * 2);
    a.fill();
  }
  if (b.bloated) {
    for (let k = 0; k < 8; k++) {
      const ang = k * 0.8 + 0.3;
      const px = Math.cos(ang) * b.torsoW * 0.36 + lean;
      const py = (hipY + shY) / 2 + Math.sin(ang * 1.7) * 0.25;
      const r = 0.035 + (k % 3) * 0.015;
      for (const [ctx, col] of [[a, '#5a4872'], [e, '#6b55b0']] as const) {
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(X(px), Y(py), X(r), 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  if (b.armored) {
    a.fillStyle = '#232a2c';
    a.strokeStyle = '#56656a';
    a.fillRect(X(-0.2 + lean), Y(shY - 0.06), X(0.4), X(0.32));
    a.strokeRect(X(-0.2 + lean), Y(shY - 0.06), X(0.4), X(0.32));
  }

  // arms
  for (const side of [-1, 1]) {
    const sx = side * b.shoulderW * 0.5 + lean;
    const ang = p.armA + side * p.swing * 0.5;
    const L = 0.62 * (kind === 'screamer' ? 1.12 : 1);
    const reach = p.reach;
    const ex = sx + side * Math.sin(ang) * L * 0.5 * (1 - reach * 0.4);
    const ey = shY - Math.cos(ang) * L * 0.5 * (1 - reach * 1.1);
    const hx = sx + side * Math.sin(ang) * L * (1 - reach * 0.5);
    const hy = shY - Math.cos(ang) * L * (1 - reach * 1.25);
    limb(sx, shY - 0.03, ex, ey, b.arm);
    limb(ex, ey, hx, hy, b.arm * 0.85);
    // claw fingers
    for (let f = -1; f <= 1; f++) limb(hx, hy, hx + side * 0.03 + f * 0.025, hy - 0.07, 0.02);
  }

  // head
  const hx = lean * 1.3;
  const hy = shY + b.neck + b.head * 0.6 - p.headBack * 0.02;
  limb(lean, shY, hx, hy - b.head * 0.5, b.neck > 0.12 ? 0.07 : 0.09);
  a.fillStyle = body;
  a.strokeStyle = rim;
  a.lineWidth = 1.5;
  a.beginPath();
  a.ellipse(X(hx), Y(hy), X(b.head * 0.86), X(b.head * (kind === 'screamer' ? 1.15 : 1)), 0, 0, Math.PI * 2);
  a.fill();
  a.stroke();
  if (b.armored) {
    a.fillStyle = '#232a2c';
    a.beginPath();
    a.ellipse(X(hx), Y(hy + 0.04), X(b.head * 0.95), X(b.head * 0.7), 0, Math.PI, Math.PI * 2);
    a.fill();
  }
  // mouth
  a.fillStyle = '#2a0608';
  a.beginPath();
  a.ellipse(X(hx), Y(hy - b.head * 0.45), X(0.03 + p.mouth * 0.015), X(0.008 + p.mouth * (kind === 'screamer' ? 0.06 : 0.03)), 0, 0, Math.PI * 2);
  a.fill();
  // eyes glow in the emissive pass too
  const eyeY = hy + b.head * 0.18 - p.headBack * 0.02;
  for (const s of [-1, 1]) {
    for (const [ctx, col, r] of [[a, '#a98bff', 0.013], [e, '#b9a3ff', 0.012]] as const) {
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(X(hx + s * b.head * 0.36), Y(eyeY), X(r), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  a.restore();
  e.restore();
}
