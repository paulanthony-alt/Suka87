import * as THREE from 'three';
import { sprites } from './library';

const cache = new Map<string, THREE.Texture>();

/** Render one of the HUD's SVG symbols into an image (async). */
function symbolImage(id: string, w: number, h: number): Promise<HTMLImageElement | null> {
  const sym = document.getElementById(id);
  if (!sym) return Promise.resolve(null);
  const vb = sym.getAttribute('viewBox') ?? '0 0 48 48';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" width="${w}" height="${h}" color="#E7E9E2" style="color:#E7E9E2">${sym.innerHTML}</svg>`;
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  });
}

/**
 * Pickup texture: the artist's PNG if the manifest names one for `key`, otherwise the HUD icon on
 * a chamfered dark plate (same language as the quick slots).
 */
function pickupTexture(key: string, iconId: string, wide: boolean): THREE.Texture {
  const hit = cache.get(key);
  if (hit) return hit;
  const W = wide ? 256 : 128;
  const H = 128;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  cache.set(key, t);
  const custom = sprites.pickupImages.get(key);
  const ctx = c.getContext('2d')!;
  if (custom) {
    const s = Math.min(W / custom.width, H / custom.height);
    ctx.drawImage(custom, (W - custom.width * s) / 2, (H - custom.height * s) / 2, custom.width * s, custom.height * s);
    t.needsUpdate = true;
    return t;
  }
  const k = 14;
  ctx.beginPath();
  ctx.moveTo(k, 4);
  ctx.lineTo(W - 4, 4);
  ctx.lineTo(W - 4, H - 4 - k);
  ctx.lineTo(W - 4 - k, H - 4);
  ctx.lineTo(4, H - 4);
  ctx.lineTo(4, 4 + k);
  ctx.closePath();
  ctx.fillStyle = 'rgba(8,12,11,0.78)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(231,233,226,0.45)';
  ctx.lineWidth = 3;
  ctx.stroke();
  void symbolImage(iconId, wide ? 200 : 80, 80).then((img) => {
    if (!img) return;
    ctx.drawImage(img, (W - img.width) / 2, (H - img.height) / 2);
    t.needsUpdate = true;
  });
  t.needsUpdate = true;
  return t;
}

export function pickupSprite(key: string, iconId: string, wide = false) {
  const mat = new THREE.SpriteMaterial({ map: pickupTexture(key, iconId, wide), transparent: true, depthWrite: false });
  const s = new THREE.Sprite(mat);
  s.scale.set(wide ? 0.8 : 0.42, 0.42, 1);
  s.position.y = 0.42;
  s.renderOrder = 2;
  return s;
}
