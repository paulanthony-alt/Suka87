import type { ItemId } from '../data/items';
import type { WeaponId } from '../data/weapons';

export type SurfaceStyle = 'concrete' | 'ward' | 'tile' | 'lab';
export type LightKind = 'normal' | 'flicker' | 'emergency' | 'none';

/**
 * Map legend (one character = one 2 m tile)
 *   #  wall            .  floor           D  door            L  locked door (opens on level flag)
 *   P  player start    E  exit            S  spawn vent
 *   *  ceiling light   !  flickering      ^  emergency light (always on)
 *   props: g gurney  b bed  c cabinet  t desk  k crates  s shelving  m morgue drawers  o drums
 *          p boiler  l lab bench  f fume hood  v vending  r chairs  q washer  w workbench
 *          x lab station (craft cure components)  y synthesiser (final objective)
 *   loot:  1 ammo  2 medical  3 materials  4 lab supplies
 *   infected: z wave mix  R runner  B bloater  C screamer  U brute  0 Patient Zero
 *   marks: W weapon  K key item  T terminal  (metadata held in `marks`)
 */

export interface RoomDef {
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  style: SurfaceStyle;
}

export type Mark =
  | { kind: 'weapon'; x: number; y: number; weapon: WeaponId }
  | { kind: 'key'; x: number; y: number; item: ItemId; qty: number; label: string }
  | { kind: 'terminal'; x: number; y: number; id: string; label: string; hold: number; prop: 'generator' | 'console' | 'airlock' };

export interface BuiltMap {
  rows: string[];
  rooms: RoomDef[];
  marks: Mark[];
}

export class MapBuilder {
  private g: string[][];
  private rooms: RoomDef[] = [];
  private marks: Mark[] = [];
  private lights: { x: number; y: number; w: number; h: number; kind: LightKind; spacing: number }[] = [];

  constructor(readonly w: number, readonly h: number) {
    this.g = Array.from({ length: h }, () => Array.from({ length: w }, () => '#'));
  }

  room(name: string, x: number, y: number, w: number, h: number, style: SurfaceStyle, lights: LightKind = 'normal', spacing = 4) {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.set(i, j, '.');
    this.rooms.push({ name, x, y, w, h, style });
    if (lights !== 'none') this.lights.push({ x, y, w, h, kind: lights, spacing });
    return this;
  }

  door(x: number, y: number) {
    return this.set(x, y, 'D');
  }
  locked(x: number, y: number) {
    return this.set(x, y, 'L');
  }

  /** Place one character at each coordinate pair. */
  put(ch: string, ...coords: [number, number][]) {
    for (const [x, y] of coords) this.set(x, y, ch);
    return this;
  }

  weapon(x: number, y: number, weapon: WeaponId) {
    this.set(x, y, 'W');
    this.marks.push({ kind: 'weapon', x, y, weapon });
    return this;
  }

  key(x: number, y: number, item: ItemId, qty: number, label: string) {
    this.set(x, y, 'K');
    this.marks.push({ kind: 'key', x, y, item, qty, label });
    return this;
  }

  terminal(x: number, y: number, id: string, label: string, hold: number, prop: 'generator' | 'console' | 'airlock') {
    this.set(x, y, 'T');
    this.marks.push({ kind: 'terminal', x, y, id, label, hold, prop });
    return this;
  }

  private set(x: number, y: number, ch: string) {
    if (x <= 0 || y <= 0 || x >= this.w - 1 || y >= this.h - 1) throw new Error(`map write out of bounds ${x},${y}`);
    this.g[y][x] = ch;
    return this;
  }

  build(): BuiltMap {
    // Lights go in last so they only take free floor tiles.
    const chars: Record<LightKind, string> = { normal: '*', flicker: '!', emergency: '^', none: '' };
    for (const L of this.lights) {
      const nx = Math.max(1, Math.round(L.w / L.spacing));
      const ny = Math.max(1, Math.round(L.h / L.spacing));
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          const tx = L.x + Math.floor(((i + 0.5) * L.w) / nx);
          const ty = L.y + Math.floor(((j + 0.5) * L.h) / ny);
          const spot = this.nearestFree(tx, ty, L);
          if (spot) {
            // a share of normal fixtures are failing
            const flick = L.kind === 'normal' && (tx * 7 + ty * 13) % 5 === 0;
            this.g[spot[1]][spot[0]] = flick ? '!' : chars[L.kind];
          }
        }
      }
    }
    return { rows: this.g.map((r) => r.join('')), rooms: this.rooms, marks: this.marks };
  }

  private nearestFree(x: number, y: number, r: { x: number; y: number; w: number; h: number }): [number, number] | null {
    for (let rad = 0; rad < 3; rad++) {
      for (let dy = -rad; dy <= rad; dy++) {
        for (let dx = -rad; dx <= rad; dx++) {
          const i = x + dx;
          const j = y + dy;
          if (i < r.x || j < r.y || i >= r.x + r.w || j >= r.y + r.h) continue;
          if (this.g[j][i] === '.') return [i, j];
        }
      }
    }
    return null;
  }
}
