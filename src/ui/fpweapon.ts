import { WEAPONS, type WeaponId } from '../data/weapons';
import { sprites } from '../sprites/library';
import type { Game } from '../game/game';

/**
 * Placeholder layout on the 1920×1080 canvas: the stock sits at `stock`, the barrel points at
 * `aim`. Points in `muzzle`/`grips` are in the 200×80 icon space (icons face right).
 */
interface Layout {
  stock: [number, number];
  aim: [number, number];
  scale: number;
  muzzle: [number, number];
  grips: [number, number][];
}
const LAYOUT: Record<WeaponId, Layout> = {
  axe: { stock: [1500, 1150], aim: [1180, 560], scale: 3.2, muzzle: [190, 36], grips: [[30, 47]] },
  pistol: { stock: [1330, 1060], aim: [1010, 690], scale: 2.3, muzzle: [158, 31], grips: [[78, 60]] },
  smg: { stock: [1420, 1120], aim: [1020, 690], scale: 2.6, muzzle: [190, 34], grips: [[68, 58], [104, 60]] },
  rifle: { stock: [1460, 1130], aim: [1020, 680], scale: 2.8, muzzle: [198, 29], grips: [[96, 58], [146, 34]] },
  shotgun: { stock: [1460, 1130], aim: [1020, 680], scale: 2.8, muzzle: [196, 30], grips: [[86, 56], [142, 40]] },
  dmr: { stock: [1470, 1140], aim: [1020, 680], scale: 2.8, muzzle: [198, 33], grips: [[80, 58], [150, 34]] },
};

/**
 * Doom-style first-person weapon for 2D sprite mode. Uses the artist's PNGs from the sprite
 * manifest when present (idle / fire / reload), otherwise a large silhouette of the HUD weapon icon.
 * Motion comes from the same pose the 3D viewmodel uses (bob, sway, recoil, reload, swing).
 */
export class FirstPersonWeapon {
  private root: HTMLElement;
  private inner: HTMLElement;
  private current: WeaponId | null = null;
  private img: HTMLImageElement | null = null;
  private visible = false;

  constructor(private game: Game, parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'fpw hidden';
    this.root.innerHTML = '<div class="fpw-stage"><div class="fpw-inner"></div></div>';
    parent.prepend(this.root);
    this.inner = this.root.querySelector('.fpw-inner') as HTMLElement;
  }

  private build(id: WeaponId) {
    this.current = id;
    const art = sprites.weaponImages.get(id);
    if (art) {
      this.inner.innerHTML = '';
      this.img = art.idle.cloneNode() as HTMLImageElement;
      this.img.className = 'fpw-img';
      this.inner.appendChild(this.img);
      return;
    }
    this.img = null;
    const L = LAYOUT[id];
    // icons face right; mirror them so the barrel comes in from the right towards the centre
    const ang = Math.atan2(L.aim[1] - L.stock[1], L.aim[0] - L.stock[0]);
    const rot = ang - Math.PI;
    const map = (u: number, v: number): [number, number] => {
      const x = -L.scale * u;
      const y = L.scale * (v - 40);
      return [L.stock[0] + x * Math.cos(rot) - y * Math.sin(rot), L.stock[1] + x * Math.sin(rot) + y * Math.cos(rot)];
    };
    const [fx, fy] = map(...L.muzzle);
    const arms = L.grips
      .map(([u, v], i) => {
        const [hx, hy] = map(u, v);
        const [ex, ey] = i === 0 ? [hx + 420, hy + 420] : [hx + 120, hy + 520];
        return `<line x1="${hx.toFixed(0)}" y1="${hy.toFixed(0)}" x2="${ex.toFixed(0)}" y2="${ey.toFixed(0)}" class="fpw-arm"/><circle cx="${hx.toFixed(0)}" cy="${hy.toFixed(0)}" r="34" class="fpw-hand"/>`;
      })
      .join('');
    this.inner.innerHTML = `
      <svg viewBox="0 0 1920 1080" width="1920" height="1080">
        <defs><radialGradient id="fpwflash"><stop offset="0" stop-color="#fff6dc"/><stop offset=".35" stop-color="#ffc06a" stop-opacity=".9"/><stop offset="1" stop-color="#ff7a2a" stop-opacity="0"/></radialGradient></defs>
        ${WEAPONS[id].ammo ? `<circle class="fpw-mf" cx="${fx.toFixed(0)}" cy="${fy.toFixed(0)}" r="${(36 * L.scale).toFixed(0)}" fill="url(#fpwflash)"/>` : ''}
        <g transform="translate(${L.stock[0]} ${L.stock[1]}) rotate(${((rot * 180) / Math.PI).toFixed(2)}) scale(${-L.scale} ${L.scale}) translate(0 -40)" class="fpw-gun"><use href="#${WEAPONS[id].icon}" width="200" height="80"/></g>
        ${arms}
      </svg>`;
  }

  update() {
    const g = this.game;
    const on = g.settings.spriteMode && (g.state === 'playing' || g.state === 'paused') && g.player.alive && !g.weapons.scoped;
    if (on !== this.visible) {
      this.visible = on;
      this.root.classList.toggle('hidden', !on);
    }
    if (!on) return;
    const id = g.inventory.current;
    if (id !== this.current) this.build(id);
    const p = g.weapons.pose2d;
    const art = sprites.weaponImages.get(id);
    if (art && this.img) {
      const want = p.flash && art.fire ? art.fire : p.reloading && art.reload ? art.reload : art.idle;
      if (this.img.src !== want.src) this.img.src = want.src;
    }
    // metres/radians of viewmodel motion -> canvas pixels/degrees
    const tx = p.dx * 1700 - p.ry * 260;
    const ty = -p.dy * 1700 - p.rx * 380;
    const rot = (-p.rz * 180) / Math.PI * 0.8;
    const sc = 1 + p.ads * 0.15;
    this.inner.style.transform = `translate(${tx.toFixed(1)}px, ${ty.toFixed(1)}px) rotate(${rot.toFixed(2)}deg) scale(${sc.toFixed(3)})`;
    this.inner.classList.toggle('firing', p.flash);
  }
}
