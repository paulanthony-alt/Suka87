import * as THREE from 'three';
import { Rng } from '../core/math';

/**
 * Procedural texture library. Everything is painted onto canvases at load time (albedo + a normal
 * map derived from a height pass), which keeps the build asset-free while still giving surfaces
 * grime, wear and relief under the flashlight.
 */

type Paint = (ctx: CanvasRenderingContext2D, rng: Rng, w: number, h: number) => void;

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function toTexture(c: HTMLCanvasElement, srgb: boolean, repeat = true) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.needsUpdate = true;
  return t;
}

/** Sobel normal map from a grayscale height canvas. */
function normalFromHeight(h: HTMLCanvasElement, strength: number) {
  const w = h.width;
  const hh = h.height;
  const src = h.getContext('2d')!.getImageData(0, 0, w, hh).data;
  const out = canvas(w, hh);
  const octx = out.getContext('2d')!;
  const img = octx.createImageData(w, hh);
  const H = (x: number, y: number) => src[(((y + hh) % hh) * w + ((x + w) % w)) * 4] / 255;
  for (let y = 0; y < hh; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (H(x + 1, y - 1) + 2 * H(x + 1, y) + H(x + 1, y + 1) - H(x - 1, y - 1) - 2 * H(x - 1, y) - H(x - 1, y + 1)) * strength;
      const dy = (H(x - 1, y + 1) + 2 * H(x, y + 1) + H(x + 1, y + 1) - H(x - 1, y - 1) - 2 * H(x, y - 1) - H(x + 1, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * w + x) * 4;
      img.data[i] = ((-dx / len) * 0.5 + 0.5) * 255;
      img.data[i + 1] = ((dy / len) * 0.5 + 0.5) * 255;
      img.data[i + 2] = (1 / len) * 0.5 * 255 + 127;
      img.data[i + 3] = 255;
    }
  }
  octx.putImageData(img, 0, 0);
  return out;
}

function speckle(ctx: CanvasRenderingContext2D, rng: Rng, w: number, h: number, n: number, color: string, size: [number, number], alpha: [number, number]) {
  ctx.fillStyle = color;
  for (let i = 0; i < n; i++) {
    ctx.globalAlpha = rng.range(alpha[0], alpha[1]);
    const s = rng.range(size[0], size[1]);
    ctx.fillRect(rng.next() * w, rng.next() * h, s, s);
  }
  ctx.globalAlpha = 1;
}

function blotches(ctx: CanvasRenderingContext2D, rng: Rng, w: number, h: number, n: number, rgb: string, r: [number, number], a: [number, number]) {
  for (let i = 0; i < n; i++) {
    const x = rng.next() * w;
    const y = rng.next() * h;
    const rad = rng.range(r[0], r[1]);
    // draw wrapped copies so the texture tiles seamlessly
    for (const ox of [-w, 0, w]) {
      for (const oy of [-h, 0, h]) {
        const g = ctx.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, rad);
        g.addColorStop(0, `rgba(${rgb},${rng.range(a[0], a[1])})`);
        g.addColorStop(1, `rgba(${rgb},0)`);
        ctx.fillStyle = g;
        ctx.fillRect(x + ox - rad, y + oy - rad, rad * 2, rad * 2);
      }
    }
  }
}

function streaks(ctx: CanvasRenderingContext2D, rng: Rng, w: number, h: number, n: number, rgb: string) {
  for (let i = 0; i < n; i++) {
    const x = rng.next() * w;
    const y0 = rng.range(0, h * 0.5);
    const len = rng.range(h * 0.2, h * 0.7);
    const g = ctx.createLinearGradient(0, y0, 0, y0 + len);
    g.addColorStop(0, `rgba(${rgb},${rng.range(0.15, 0.35)})`);
    g.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(x, y0, rng.range(2, 9), len);
  }
}

export function bloodSmear(ctx: CanvasRenderingContext2D, rng: Rng, x: number, y: number, s: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rng.range(-0.4, 0.4));
  for (let i = 0; i < 4; i++) {
    ctx.fillStyle = `rgba(${rng.int(55, 80)},8,8,${rng.range(0.35, 0.6)})`;
    ctx.fillRect(i * s * 0.22, 0, s * 0.12, s * rng.range(0.6, 1.4));
  }
  ctx.restore();
}

interface Built {
  map: THREE.Texture;
  normal: THREE.Texture;
}

function build(w: number, h: number, seed: number, albedo: Paint, height: Paint, strength: number): Built {
  const a = canvas(w, h);
  albedo(a.getContext('2d')!, new Rng(seed), w, h);
  const hc = canvas(w, h);
  height(hc.getContext('2d')!, new Rng(seed + 1), w, h);
  return { map: toTexture(a, true), normal: toTexture(normalFromHeight(hc, strength), false) };
}

// ------------------------------------------------------------------ surfaces
// Wall textures cover 4 m (u) x 3.2 m (v). Floor/ceiling textures cover 4 m x 4 m.

export function concreteWall(seed = 11): Built {
  return build(512, 512, seed, (ctx, rng, w, h) => {
    ctx.fillStyle = '#4c5552';
    ctx.fillRect(0, 0, w, h);
    blotches(ctx, rng, w, h, 30, '20,26,24', [30, 140], [0.15, 0.4]);
    blotches(ctx, rng, w, h, 16, '110,118,112', [20, 90], [0.08, 0.2]);
    speckle(ctx, rng, w, h, 5000, '#1c2220', [1, 2], [0.1, 0.4]);
    speckle(ctx, rng, w, h, 2500, '#8a948f', [1, 2], [0.06, 0.2]);
    streaks(ctx, rng, w, h, 40, '22,20,14');
    // form-tie holes and panel joints
    ctx.fillStyle = 'rgba(10,12,12,0.6)';
    for (let x = 0; x < w; x += w / 4) {
      ctx.fillRect(x, 0, 2, h);
      for (let y = h / 6; y < h; y += h / 3) {
        ctx.beginPath();
        ctx.arc(x + w / 8, y, 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // damp skirting
    const g = ctx.createLinearGradient(0, h, 0, h * 0.78);
    g.addColorStop(0, 'rgba(14,18,16,0.75)');
    g.addColorStop(1, 'rgba(14,18,16,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, h * 0.78, w, h * 0.22);
  }, (ctx, rng, w, h) => {
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, w, h);
    speckle(ctx, rng, w, h, 9000, '#000', [1, 3], [0.1, 0.35]);
    speckle(ctx, rng, w, h, 3000, '#fff', [1, 2], [0.1, 0.3]);
    ctx.fillStyle = '#303030';
    for (let x = 0; x < w; x += w / 4) {
      ctx.fillRect(x, 0, 3, h);
      for (let y = h / 6; y < h; y += h / 3) {
        ctx.beginPath();
        ctx.arc(x + w / 8, y, 5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }, 2.2);
}

export function concreteFloor(seed = 21): Built {
  return build(512, 512, seed, (ctx, rng, w, h) => {
    ctx.fillStyle = '#3d4441';
    ctx.fillRect(0, 0, w, h);
    blotches(ctx, rng, w, h, 40, '18,22,20', [30, 160], [0.2, 0.5]);
    blotches(ctx, rng, w, h, 10, '40,32,22', [40, 120], [0.15, 0.3]);
    speckle(ctx, rng, w, h, 7000, '#141816', [1, 2], [0.15, 0.4]);
    speckle(ctx, rng, w, h, 2000, '#7d8682', [1, 2], [0.05, 0.2]);
    // expansion joints + cracks
    ctx.strokeStyle = 'rgba(8,10,10,0.8)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(w / 2, 0); ctx.lineTo(w / 2, h);
    ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2);
    ctx.stroke();
    ctx.lineWidth = 1.2;
    for (let i = 0; i < 6; i++) {
      let x = rng.next() * w;
      let y = rng.next() * h;
      ctx.beginPath();
      ctx.moveTo(x, y);
      for (let k = 0; k < 8; k++) {
        x += rng.range(-18, 18);
        y += rng.range(-18, 18);
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    // drain stains
    blotches(ctx, rng, w, h, 3, '50,8,8', [10, 40], [0.2, 0.4]);
  }, (ctx, rng, w, h) => {
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, w, h);
    speckle(ctx, rng, w, h, 12000, '#000', [1, 3], [0.1, 0.3]);
    ctx.strokeStyle = '#202020';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(w / 2, 0); ctx.lineTo(w / 2, h);
    ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2);
    ctx.stroke();
  }, 2.5);
}

/** Painted hospital corridor wall: dark lower wainscot, light upper paint, crash rail at ~1 m. */
export function wardWall(seed = 31): Built {
  const railY = (h: number) => h * (1 - 1.05 / 3.2);
  return build(512, 512, seed, (ctx, rng, w, h) => {
    const ry = railY(h);
    ctx.fillStyle = '#5d6b66';
    ctx.fillRect(0, 0, w, ry);
    ctx.fillStyle = '#2e3a37';
    ctx.fillRect(0, ry, w, h - ry);
    blotches(ctx, rng, w, h, 26, '24,30,28', [30, 120], [0.12, 0.3]);
    streaks(ctx, rng, w, h, 18, '30,28,20');
    speckle(ctx, rng, w, h, 2500, '#1e2422', [1, 2], [0.1, 0.3]);
    // crash rail
    ctx.fillStyle = '#8c9a95';
    ctx.fillRect(0, ry - 10, w, 14);
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(0, ry + 4, w, 4);
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fillRect(0, ry - 10, w, 2);
    // skirting
    ctx.fillStyle = '#1a201f';
    ctx.fillRect(0, h - 18, w, 18);
    // scuffs and the odd bloody hand
    for (let i = 0; i < 30; i++) {
      ctx.fillStyle = `rgba(15,15,12,${rng.range(0.1, 0.3)})`;
      ctx.fillRect(rng.next() * w, ry + rng.range(10, h - ry - 20), rng.range(10, 50), rng.range(1, 3));
    }
  }, (ctx, rng, w, h) => {
    const ry = railY(h);
    ctx.fillStyle = '#7a7a7a';
    ctx.fillRect(0, 0, w, h);
    speckle(ctx, rng, w, h, 4000, '#000', [1, 2], [0.05, 0.2]);
    ctx.fillStyle = '#e0e0e0';
    ctx.fillRect(0, ry - 10, w, 14);
    ctx.fillStyle = '#c0c0c0';
    ctx.fillRect(0, h - 18, w, 18);
  }, 3);
}

/** Morgue / wet-room ceramic tiles. */
export function tileWall(seed = 41): Built {
  const n = 26;
  return build(512, 512, seed, (ctx, rng, w, h) => {
    const s = w / n;
    for (let y = 0; y < h; y += s) {
      for (let x = 0; x < w; x += s) {
        const v = rng.int(150, 178);
        ctx.fillStyle = `rgb(${v - 6},${v + 2},${v})`;
        ctx.fillRect(x, y, s, s);
      }
    }
    ctx.fillStyle = '#3c4441';
    for (let i = 0; i <= n; i++) {
      ctx.fillRect(i * s - 1, 0, 2, h);
      ctx.fillRect(0, i * s - 1, w, 2);
    }
    blotches(ctx, rng, w, h, 30, '30,36,30', [20, 110], [0.15, 0.4]);
    streaks(ctx, rng, w, h, 30, '50,40,20');
    const g = ctx.createLinearGradient(0, h, 0, h * 0.7);
    g.addColorStop(0, 'rgba(26,30,26,0.8)');
    g.addColorStop(1, 'rgba(26,30,26,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, h * 0.7, w, h * 0.3);
    // cracked tiles
    ctx.strokeStyle = 'rgba(20,24,22,0.7)';
    for (let i = 0; i < 10; i++) {
      const x = rng.int(0, n - 1) * s;
      const y = rng.int(0, n - 1) * s;
      ctx.beginPath();
      ctx.moveTo(x + rng.range(0, s), y);
      ctx.lineTo(x + rng.range(0, s), y + s);
      ctx.stroke();
    }
  }, (ctx, _rng, w, h) => {
    const s = w / n;
    ctx.fillStyle = '#c8c8c8';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#404040';
    for (let i = 0; i <= n; i++) {
      ctx.fillRect(i * s - 1.5, 0, 3, h);
      ctx.fillRect(0, i * s - 1.5, w, 3);
    }
  }, 2.4);
}

/** Clean modular wall panels for the research wing. */
export function labWall(seed = 51): Built {
  return build(512, 512, seed, (ctx, rng, w, h) => {
    ctx.fillStyle = '#9fa8a5';
    ctx.fillRect(0, 0, w, h);
    const pw = w / 4;
    for (let i = 0; i < 4; i++) {
      const v = rng.int(-6, 6);
      ctx.fillStyle = `rgb(${158 + v},${167 + v},${164 + v})`;
      ctx.fillRect(i * pw + 3, 3, pw - 6, h * 0.62);
      ctx.fillStyle = `rgb(${120 + v},${130 + v},${128 + v})`;
      ctx.fillRect(i * pw + 3, h * 0.62 + 6, pw - 6, h * 0.38 - 9);
    }
    ctx.fillStyle = '#5b2bd0';
    ctx.globalAlpha = 0.55;
    ctx.fillRect(0, h * 0.62, w, 6);
    ctx.globalAlpha = 1;
    blotches(ctx, rng, w, h, 12, '40,46,44', [20, 90], [0.08, 0.2]);
    speckle(ctx, rng, w, h, 1500, '#3c4442', [1, 2], [0.05, 0.15]);
  }, (ctx, _rng, w, h) => {
    ctx.fillStyle = '#d0d0d0';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#404040';
    const pw = w / 4;
    for (let i = 0; i <= 4; i++) ctx.fillRect(i * pw - 3, 0, 6, h);
    ctx.fillRect(0, h * 0.62, w, 6);
  }, 2);
}

/** Sheet vinyl with a faint tile print (wards, corridors). */
export function vinylFloor(seed = 61): Built {
  return build(512, 512, seed, (ctx, rng, w, h) => {
    ctx.fillStyle = '#4a5653';
    ctx.fillRect(0, 0, w, h);
    const s = w / 4;
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        const v = rng.int(-5, 5);
        ctx.fillStyle = `rgb(${72 + v},${84 + v},${81 + v})`;
        ctx.fillRect(x * s + 2, y * s + 2, s - 4, s - 4);
      }
    }
    speckle(ctx, rng, w, h, 6000, '#2a3230', [1, 2], [0.2, 0.5]);
    speckle(ctx, rng, w, h, 2000, '#a0aaa6', [1, 2], [0.1, 0.3]);
    blotches(ctx, rng, w, h, 30, '16,20,18', [20, 130], [0.15, 0.45]);
    // drag marks + blood trails
    for (let i = 0; i < 2; i++) {
      if (!rng.chance(0.25)) continue;
      ctx.strokeStyle = `rgba(40,10,8,${rng.range(0.12, 0.22)})`;
      ctx.lineWidth = rng.range(6, 16);
      ctx.beginPath();
      let x = rng.next() * w;
      let y = rng.next() * h;
      ctx.moveTo(x, y);
      for (let k = 0; k < 5; k++) {
        x += rng.range(-40, 40);
        y += rng.range(20, 60);
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }, (ctx, rng, w, h) => {
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, w, h);
    const s = w / 4;
    ctx.fillStyle = '#505050';
    for (let i = 0; i <= 4; i++) {
      ctx.fillRect(i * s - 2, 0, 4, h);
      ctx.fillRect(0, i * s - 2, w, 4);
    }
    speckle(ctx, rng, w, h, 3000, '#000', [1, 2], [0.05, 0.2]);
  }, 1.8);
}

export function epoxyFloor(seed = 71): Built {
  return build(512, 512, seed, (ctx, rng, w, h) => {
    ctx.fillStyle = '#6a7472';
    ctx.fillRect(0, 0, w, h);
    speckle(ctx, rng, w, h, 9000, '#4a5250', [1, 2], [0.2, 0.5]);
    speckle(ctx, rng, w, h, 3000, '#c0c8c6', [1, 2], [0.1, 0.3]);
    blotches(ctx, rng, w, h, 16, '30,34,32', [30, 120], [0.1, 0.3]);
    ctx.strokeStyle = 'rgba(200,170,40,0.55)';
    ctx.lineWidth = 8;
    ctx.setLineDash([30, 20]);
    ctx.beginPath();
    ctx.moveTo(0, h * 0.1);
    ctx.lineTo(w, h * 0.1);
    ctx.stroke();
    ctx.setLineDash([]);
  }, (ctx, rng, w, h) => {
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, w, h);
    speckle(ctx, rng, w, h, 4000, '#000', [1, 2], [0.05, 0.15]);
  }, 1);
}

export function ceilingTiles(seed = 81): Built {
  return build(512, 512, seed, (ctx, rng, w, h) => {
    ctx.fillStyle = '#3f4644';
    ctx.fillRect(0, 0, w, h);
    const s = w / 6;
    for (let y = 0; y < 6; y++) {
      for (let x = 0; x < 6; x++) {
        const missing = rng.chance(0.05);
        const v = rng.int(-8, 8);
        ctx.fillStyle = missing ? '#0b0e0d' : `rgb(${92 + v},${98 + v},${94 + v})`;
        ctx.fillRect(x * s + 3, y * s + 3, s - 6, s - 6);
        if (!missing && rng.chance(0.25)) {
          const g = ctx.createRadialGradient(x * s + s / 2, y * s + s / 2, 0, x * s + s / 2, y * s + s / 2, s * 0.6);
          g.addColorStop(0, 'rgba(70,52,24,0.55)');
          g.addColorStop(1, 'rgba(70,52,24,0)');
          ctx.fillStyle = g;
          ctx.fillRect(x * s, y * s, s, s);
        }
      }
    }
    speckle(ctx, rng, w, h, 4000, '#2a2e2c', [1, 2], [0.1, 0.4]);
  }, (ctx, _rng, w, h) => {
    ctx.fillStyle = '#909090';
    ctx.fillRect(0, 0, w, h);
    const s = w / 6;
    ctx.fillStyle = '#202020';
    for (let i = 0; i <= 6; i++) {
      ctx.fillRect(i * s - 3, 0, 6, h);
      ctx.fillRect(0, i * s - 3, w, 6);
    }
  }, 2);
}

// ------------------------------------------------------------------ props & characters

export function brushedMetal(seed = 91, tint = '#7b8582'): Built {
  return build(256, 256, seed, (ctx, rng, w, h) => {
    ctx.fillStyle = tint;
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 600; i++) {
      ctx.fillStyle = `rgba(${rng.chance(0.5) ? '255,255,255' : '0,0,0'},${rng.range(0.02, 0.08)})`;
      ctx.fillRect(0, rng.next() * h, w, 1);
    }
    blotches(ctx, rng, w, h, 10, '20,22,20', [10, 50], [0.1, 0.35]);
    blotches(ctx, rng, w, h, 4, '90,50,20', [6, 26], [0.1, 0.3]);
  }, (ctx, rng, w, h) => {
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, w, h);
    speckle(ctx, rng, w, h, 1500, '#000', [1, 2], [0.05, 0.2]);
  }, 1);
}

export function fabric(seed: number, base: string, pattern: 'gown' | 'scrubs' | 'uniform' | 'plain'): Built {
  return build(256, 256, seed, (ctx, rng, w, h) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
    if (pattern === 'gown') {
      ctx.fillStyle = 'rgba(30,60,80,0.25)';
      for (let y = 0; y < h; y += 16) for (let x = (y / 16) % 2 ? 8 : 0; x < w; x += 16) ctx.fillRect(x + 4, y + 4, 3, 3);
    }
    if (pattern === 'uniform') {
      ctx.fillStyle = 'rgba(0,0,0,0.2)';
      ctx.fillRect(w * 0.48, 0, 4, h);
    }
    for (let i = 0; i < 1800; i++) {
      ctx.fillStyle = `rgba(0,0,0,${rng.range(0.02, 0.08)})`;
      ctx.fillRect(rng.next() * w, rng.next() * h, 1, rng.range(1, 3));
    }
    blotches(ctx, rng, w, h, 14, '20,18,14', [10, 60], [0.2, 0.5]);
    blotches(ctx, rng, w, h, 10, '70,8,10', [8, 50], [0.35, 0.7]);
    blotches(ctx, rng, w, h, 4, '60,40,90', [6, 26], [0.25, 0.5]);
  }, (ctx, rng, w, h) => {
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 3) {
      ctx.fillStyle = `rgba(0,0,0,${rng.range(0.05, 0.15)})`;
      ctx.fillRect(0, y, w, 1);
    }
  }, 1.4);
}

/** Infected skin with Suka 87 vein network. Returns albedo, normal and an emissive vein mask. */
export function infectedSkin(seed: number, base: string): Built & { veins: THREE.Texture } {
  const w = 256;
  const h = 256;
  const veinCanvas = canvas(w, h);
  const vctx = veinCanvas.getContext('2d')!;
  vctx.fillStyle = '#000';
  vctx.fillRect(0, 0, w, h);
  const rng = new Rng(seed + 7);
  const paths: [number, number][][] = [];
  for (let i = 0; i < 16; i++) {
    let x = rng.next() * w;
    let y = rng.next() * h;
    let a = rng.range(0, Math.PI * 2);
    const pts: [number, number][] = [[x, y]];
    for (let k = 0; k < 14; k++) {
      a += rng.range(-0.7, 0.7);
      x += Math.cos(a) * rng.range(6, 14);
      y += Math.sin(a) * rng.range(6, 14);
      pts.push([x, y]);
    }
    paths.push(pts);
  }
  const drawPaths = (ctx: CanvasRenderingContext2D, style: string, width: number) => {
    ctx.strokeStyle = style;
    ctx.lineCap = 'round';
    for (const p of paths) {
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(p[0][0], p[0][1]);
      for (let i = 1; i < p.length; i++) {
        ctx.lineTo(p[i][0], p[i][1]);
        ctx.lineWidth = width * (1 - i / p.length) + 0.5;
      }
      ctx.stroke();
    }
  };
  drawPaths(vctx, '#ffffff', 2.2);

  const built = build(w, h, seed, (ctx, r, ww, hh) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, ww, hh);
    blotches(ctx, r, ww, hh, 20, '60,70,62', [10, 50], [0.2, 0.4]);
    blotches(ctx, r, ww, hh, 10, '90,40,60', [10, 40], [0.15, 0.35]);
    blotches(ctx, r, ww, hh, 12, '60,8,10', [6, 30], [0.25, 0.6]);
    speckle(ctx, r, ww, hh, 2000, '#2a2a26', [1, 2], [0.1, 0.3]);
    drawPaths(ctx, 'rgba(60,30,90,0.75)', 3);
  }, (ctx, r, ww, hh) => {
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, ww, hh);
    speckle(ctx, r, ww, hh, 3000, '#000', [1, 3], [0.05, 0.25]);
    drawPaths(ctx, '#e0e0e0', 3);
  }, 2.5);
  return { ...built, veins: toTexture(veinCanvas, true) };
}

// ------------------------------------------------------------------ decals & sprites

export function bulletHoleTexture() {
  const c = canvas(64, 64);
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 30);
  g.addColorStop(0, 'rgba(0,0,0,1)');
  g.addColorStop(0.18, 'rgba(10,10,10,0.95)');
  g.addColorStop(0.3, 'rgba(40,40,36,0.6)');
  g.addColorStop(1, 'rgba(40,40,36,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const rng = new Rng(5);
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  for (let i = 0; i < 7; i++) {
    const a = rng.range(0, Math.PI * 2);
    ctx.beginPath();
    ctx.moveTo(32 + Math.cos(a) * 5, 32 + Math.sin(a) * 5);
    ctx.lineTo(32 + Math.cos(a) * rng.range(12, 22), 32 + Math.sin(a) * rng.range(12, 22));
    ctx.stroke();
  }
  return toTexture(c, true, false);
}

export function bloodTexture(seed: number) {
  const c = canvas(128, 128);
  const ctx = c.getContext('2d')!;
  const rng = new Rng(seed);
  const col = () => `rgba(${rng.int(70, 105)},${rng.int(4, 12)},${rng.int(6, 14)},${rng.range(0.75, 0.95)})`;
  ctx.fillStyle = col();
  ctx.beginPath();
  ctx.arc(64, 64, rng.range(18, 28), 0, Math.PI * 2);
  ctx.fill();
  for (let i = 0; i < 22; i++) {
    const a = rng.range(0, Math.PI * 2);
    const d = rng.range(14, 56);
    ctx.fillStyle = col();
    ctx.beginPath();
    ctx.arc(64 + Math.cos(a) * d, 64 + Math.sin(a) * d, rng.range(1.5, 8) * (1 - d / 70), 0, Math.PI * 2);
    ctx.fill();
  }
  return toTexture(c, true, false);
}

export function softDotTexture() {
  const c = canvas(64, 64);
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.5)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return toTexture(c, false, false);
}

export function smokeTexture() {
  const c = canvas(128, 128);
  const ctx = c.getContext('2d')!;
  const rng = new Rng(3);
  for (let i = 0; i < 40; i++) {
    const x = 64 + rng.range(-28, 28);
    const y = 64 + rng.range(-28, 28);
    const r = rng.range(12, 34);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,0.18)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  return toTexture(c, false, false);
}

export function muzzleFlashTexture() {
  const c = canvas(128, 128);
  const ctx = c.getContext('2d')!;
  ctx.translate(64, 64);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 60);
  g.addColorStop(0, 'rgba(255,250,230,1)');
  g.addColorStop(0.25, 'rgba(255,200,110,0.9)');
  g.addColorStop(0.6, 'rgba(255,120,40,0.3)');
  g.addColorStop(1, 'rgba(255,90,20,0)');
  const rng = new Rng(9);
  ctx.fillStyle = g;
  for (let i = 0; i < 7; i++) {
    ctx.save();
    ctx.rotate((i / 7) * Math.PI * 2 + rng.range(-0.2, 0.2));
    ctx.beginPath();
    ctx.moveTo(0, -6);
    ctx.lineTo(rng.range(40, 62), 0);
    ctx.lineTo(0, 6);
    ctx.fill();
    ctx.restore();
  }
  ctx.beginPath();
  ctx.arc(0, 0, 22, 0, Math.PI * 2);
  ctx.fill();
  return toTexture(c, false, false);
}

/** Small label textures painted on props (signage, screens). */
export function signTexture(text: string, opts: { bg: string; fg: string; w?: number; h?: number; size?: number; sub?: string }) {
  const w = opts.w ?? 512;
  const h = opts.h ?? 128;
  const c = canvas(w, h);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = opts.bg;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = opts.fg;
  ctx.font = `700 ${opts.size ?? 64}px "Big Shoulders Display", "Barlow Semi Condensed", sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 24, opts.sub ? h * 0.38 : h / 2);
  if (opts.sub) {
    ctx.font = `500 ${Math.round((opts.size ?? 64) * 0.42)}px "Barlow Semi Condensed", sans-serif`;
    ctx.globalAlpha = 0.8;
    ctx.fillText(opts.sub, 26, h * 0.76);
  }
  const rng = new Rng(text.length * 13);
  blotches(ctx, rng, w, h, 6, '20,20,16', [10, 50], [0.2, 0.4]);
  return toTexture(c, true, false);
}

/** Wall smear decal: dragged fingers and drips. */
export function smearTexture(seed: number) {
  const c = canvas(256, 256);
  const ctx = c.getContext('2d')!;
  const rng = new Rng(seed);
  bloodSmear(ctx, rng, 70, 40, 120);
  for (let i = 0; i < 6; i++) {
    const x = rng.range(60, 200);
    const y = rng.range(90, 160);
    const g = ctx.createLinearGradient(0, y, 0, y + rng.range(40, 90));
    g.addColorStop(0, 'rgba(70,8,8,0.6)');
    g.addColorStop(1, 'rgba(70,8,8,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, rng.range(2, 4), 90);
  }
  return toTexture(c, true, false);
}
