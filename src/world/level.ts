import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { LevelDef } from '../data/levels';
import type { Mark, RoomDef, SurfaceStyle } from './mapbuilder';
import { disposeTree, materials } from './materials';
import { buildDoorLeaf, buildExit, buildProp, buildShutter, buildTerminal, type PropBuild } from './props';
import { bloodTexture, smearTexture } from './textures';
import { Rng, clamp, damp } from '../core/math';

export const TILE = 2;
export const WALL_H = 3.2;
const DOOR_H = 2.4;

export interface AABB {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  /** door colliders are only active while the door is shut */
  door?: Door;
}

export class Door {
  open = 0;
  target = 0;
  /** infected bash closed doors down */
  health = 3.5;
  readonly pivot: THREE.Group;
  readonly center: THREE.Vector3;
  constructor(
    readonly tx: number,
    readonly ty: number,
    /** 'x' when the leaf spans the X axis (walls left/right, passage along Z) */
    readonly axis: 'x' | 'z',
    public locked: boolean,
    readonly shutter: boolean,
    readonly object: THREE.Group,
  ) {
    this.pivot = object;
    this.center = new THREE.Vector3(tx * TILE + TILE / 2, 0, ty * TILE + TILE / 2);
  }
  get blocking() {
    return this.open < 0.85;
  }
  get blocksSight() {
    return this.open < 0.35;
  }
}

export interface Fixture {
  pos: THREE.Vector3;
  kind: 'normal' | 'flicker' | 'emergency';
  phase: number;
  /** current brightness 0..1 for this frame */
  level: number;
  index: number;
}

export interface Terminal {
  id: string;
  label: string;
  hold: number;
  pos: THREE.Vector3;
  used: boolean;
  build: PropBuild;
}

export interface Station {
  kind: 'lab' | 'synth';
  pos: THREE.Vector3;
  build: PropBuild;
}

export interface SpawnPoint {
  ch: string;
  pos: THREE.Vector3;
}

const PROP_CHARS = 'gbctksmopulfvrqwxy';

type Buf = { pos: number[]; nor: number[]; uv: number[]; col: number[]; idx: number[] };

interface TrimFace {
  style: SurfaceStyle;
  x: number;
  y: number;
  dx: number;
  dy: number;
}

function quad(b: Buf, v: number[][], n: number[], uvs: number[][], shade: number[]) {
  const base = b.pos.length / 3;
  for (let i = 0; i < 4; i++) {
    b.pos.push(...v[i]);
    b.nor.push(...n);
    b.uv.push(...uvs[i]);
    b.col.push(shade[i], shade[i], shade[i]);
  }
  b.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
}
const DIRS: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/**
 * Runtime level: renders the tile map, owns collision, line-of-sight, lighting and navigation.
 */
export class Level {
  readonly W: number;
  readonly H: number;
  readonly rows: string[];
  readonly group = new THREE.Group();
  /** meshes bullets can hit */
  readonly hitMeshes: THREE.Object3D[] = [];
  readonly doors: Door[] = [];
  readonly fixtures: Fixture[] = [];
  readonly terminals: Terminal[] = [];
  readonly stations: Station[] = [];
  readonly spawns: SpawnPoint[] = [];
  readonly vents: THREE.Vector3[] = [];
  readonly loot: SpawnPoint[] = [];
  readonly marks: Mark[];
  readonly rooms: RoomDef[];
  readonly start = new THREE.Vector3();
  startYaw = 0;
  exit: { pos: THREE.Vector3; lamp: THREE.Mesh; face: THREE.Vector3 } | null = null;

  /** wall tiles */
  private solid: Uint8Array;
  /** tiles blocked for navigation (walls + props) */
  private blocked: Uint8Array;
  private doorAt = new Map<number, Door>();
  private colliders: AABB[][];
  private styleAt: (SurfaceStyle | null)[];
  private roomIndex: Int16Array;

  powered: boolean;
  private fixtureMesh!: THREE.InstancedMesh;
  private lights: { light: THREE.PointLight; fixture: Fixture | null; fade: number }[] = [];
  private lightTimer = 0;
  readonly hemi: THREE.HemisphereLight;

  // navigation
  private flow: Int16Array;
  private flowTile = -1;
  private pathCache = new Map<number, Int16Array>();

  constructor(readonly def: LevelDef) {
    this.rows = def.map.rows;
    this.H = this.rows.length;
    this.W = this.rows[0].length;
    this.marks = def.map.marks;
    this.rooms = def.map.rooms;
    this.powered = def.powered;
    const N = this.W * this.H;
    this.solid = new Uint8Array(N);
    this.blocked = new Uint8Array(N);
    this.flow = new Int16Array(N).fill(-1);
    this.colliders = Array.from({ length: N }, () => []);
    this.styleAt = new Array(N).fill(null);
    this.roomIndex = new Int16Array(N).fill(-1);

    this.rooms.forEach((r, i) => {
      for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) {
        this.styleAt[y * this.W + x] = r.style;
        this.roomIndex[y * this.W + x] = i;
      }
    });

    for (let y = 0; y < this.H; y++) {
      for (let x = 0; x < this.W; x++) {
        const c = this.rows[y][x];
        if (c === '#') {
          this.solid[y * this.W + x] = 1;
          this.blocked[y * this.W + x] = 1;
          this.colliders[y * this.W + x].push({ minX: x * TILE, maxX: x * TILE + TILE, minZ: y * TILE, maxZ: y * TILE + TILE });
        }
      }
    }
    // door tiles take the style of their neighbours
    for (let y = 0; y < this.H; y++) for (let x = 0; x < this.W; x++) {
      const i = y * this.W + x;
      if (this.solid[i] || this.styleAt[i]) continue;
      for (const [dx, dy] of DIRS) {
        const s = this.styleAt[(y + dy) * this.W + x + dx];
        if (s) {
          this.styleAt[i] = s;
          break;
        }
      }
    }

    // soft bounce light so unlit areas fall to deep shadow rather than a flat void
    this.hemi = new THREE.HemisphereLight('#8aa8a0', '#1a1612', this.powered ? 0.42 : 0.2);
    this.group.add(this.hemi);

    this.buildSurfaces();
    this.buildDecals();
    this.buildContents();
    this.buildFixtures();
    this.updateFlow(this.start.x, this.start.z);
  }

  // ------------------------------------------------------------------ queries

  tileOf(x: number, z: number): [number, number] {
    return [Math.floor(x / TILE), Math.floor(z / TILE)];
  }

  isSolid(tx: number, ty: number) {
    if (tx < 0 || ty < 0 || tx >= this.W || ty >= this.H) return true;
    return this.solid[ty * this.W + tx] === 1;
  }

  private passable(tx: number, ty: number) {
    if (tx < 0 || ty < 0 || tx >= this.W || ty >= this.H) return false;
    const i = ty * this.W + tx;
    if (this.blocked[i]) return false;
    const d = this.doorAt.get(i);
    return !d || !d.locked;
  }

  roomAt(x: number, z: number): RoomDef | null {
    const [tx, ty] = this.tileOf(x, z);
    if (tx < 0 || ty < 0 || tx >= this.W || ty >= this.H) return null;
    const i = this.roomIndex[ty * this.W + tx];
    return i >= 0 ? this.rooms[i] : null;
  }

  surfaceAt(x: number, z: number): SurfaceStyle {
    const [tx, ty] = this.tileOf(x, z);
    return this.styleAt[ty * this.W + tx] ?? 'concrete';
  }

  doorNear(x: number, z: number, maxDist: number): Door | null {
    let best: Door | null = null;
    let bd = maxDist;
    for (const d of this.doors) {
      const dist = Math.hypot(d.center.x - x, d.center.z - z);
      if (dist < bd) {
        bd = dist;
        best = d;
      }
    }
    return best;
  }

  /** Push a circle out of walls, props and closed doors. Returns true on contact. */
  resolveCircle(p: THREE.Vector3, r: number): boolean {
    let hit = false;
    const t0x = Math.floor((p.x - r) / TILE);
    const t1x = Math.floor((p.x + r) / TILE);
    const t0z = Math.floor((p.z - r) / TILE);
    const t1z = Math.floor((p.z + r) / TILE);
    for (let iter = 0; iter < 2; iter++) {
      for (let ty = t0z; ty <= t1z; ty++) {
        for (let tx = t0x; tx <= t1x; tx++) {
          if (tx < 0 || ty < 0 || tx >= this.W || ty >= this.H) continue;
          for (const b of this.colliders[ty * this.W + tx]) {
            if (b.door && !b.door.blocking) continue;
            const cx = clamp(p.x, b.minX, b.maxX);
            const cz = clamp(p.z, b.minZ, b.maxZ);
            const dx = p.x - cx;
            const dz = p.z - cz;
            const d2 = dx * dx + dz * dz;
            if (d2 >= r * r) continue;
            hit = true;
            if (d2 > 1e-8) {
              const d = Math.sqrt(d2);
              p.x += (dx / d) * (r - d);
              p.z += (dz / d) * (r - d);
            } else {
              // centre inside the box: push out along the shallowest axis
              const pl = p.x - b.minX, pr = b.maxX - p.x, pt = p.z - b.minZ, pb = b.maxZ - p.z;
              const m = Math.min(pl, pr, pt, pb);
              if (m === pl) p.x = b.minX - r;
              else if (m === pr) p.x = b.maxX + r;
              else if (m === pt) p.z = b.minZ - r;
              else p.z = b.maxZ + r;
            }
          }
        }
      }
    }
    return hit;
  }

  /** Grid DDA line of sight (walls + shut doors). */
  lineOfSight(ax: number, az: number, bx: number, bz: number): boolean {
    let tx = Math.floor(ax / TILE);
    let ty = Math.floor(az / TILE);
    const ex = Math.floor(bx / TILE);
    const ey = Math.floor(bz / TILE);
    const dx = bx - ax;
    const dz = bz - az;
    const sx = Math.sign(dx);
    const sz = Math.sign(dz);
    const tdx = dx !== 0 ? Math.abs(TILE / dx) : Infinity;
    const tdz = dz !== 0 ? Math.abs(TILE / dz) : Infinity;
    let tmx = dx !== 0 ? (sx > 0 ? (tx + 1) * TILE - ax : ax - tx * TILE) / Math.abs(dx) : Infinity;
    let tmz = dz !== 0 ? (sz > 0 ? (ty + 1) * TILE - az : az - ty * TILE) / Math.abs(dz) : Infinity;
    for (let i = 0; i < 128; i++) {
      if (tx === ex && ty === ey) return true;
      if (tmx < tmz) {
        tmx += tdx;
        tx += sx;
      } else {
        tmz += tdz;
        ty += sz;
      }
      if (this.isSolid(tx, ty)) return false;
      const d = this.doorAt.get(ty * this.W + tx);
      if (d && d.blocksSight) return false;
    }
    return true;
  }

  // ------------------------------------------------------------------ navigation

  private bfs(fromTile: number, out: Int16Array) {
    out.fill(-1);
    const q = new Int32Array(this.W * this.H);
    let h = 0;
    let t = 0;
    q[t++] = fromTile;
    out[fromTile] = 0;
    while (h < t) {
      const i = q[h++];
      const x = i % this.W;
      const y = (i / this.W) | 0;
      for (const [dx, dy] of DIRS) {
        const nx = x + dx;
        const ny = y + dy;
        if (!this.passable(nx, ny)) continue;
        const ni = ny * this.W + nx;
        if (out[ni] !== -1) continue;
        out[ni] = out[i] + 1;
        q[t++] = ni;
      }
    }
  }

  /** Flow field towards the player, rebuilt when the player changes tile. */
  updateFlow(px: number, pz: number) {
    const [tx, ty] = this.tileOf(px, pz);
    const i = ty * this.W + tx;
    if (i === this.flowTile) return;
    this.flowTile = i;
    this.bfs(i, this.flow);
  }

  invalidateNav() {
    this.flowTile = -1;
    this.pathCache.clear();
  }

  /** Direction (x, z) to step from a world position along a distance field. Returns false if unreachable. */
  private stepAlong(field: Int16Array, x: number, z: number, out: THREE.Vector3): boolean {
    const [tx, ty] = this.tileOf(x, z);
    const here = field[ty * this.W + tx];
    if (here === -1) return false;
    let best = here;
    let bx = tx;
    let by = ty;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = tx + dx;
        const ny = ty + dy;
        if (!this.passable(nx, ny)) continue;
        if (dx && dy && (!this.passable(tx + dx, ty) || !this.passable(tx, ty + dy))) continue;
        const v = field[ny * this.W + nx];
        if (v === -1) continue;
        const score = v + (dx && dy ? 0.4 : 0);
        if (score < best) {
          best = score;
          bx = nx;
          by = ny;
        }
      }
    }
    if (bx === tx && by === ty) {
      out.set(0, 0, 0);
      return true;
    }
    out.set(bx * TILE + TILE / 2 - x, 0, by * TILE + TILE / 2 - z).normalize();
    return true;
  }

  flowDir(x: number, z: number, out: THREE.Vector3) {
    return this.stepAlong(this.flow, x, z, out);
  }

  /** Path step towards any target (cached distance field per target tile). */
  pathDir(x: number, z: number, targetX: number, targetZ: number, out: THREE.Vector3) {
    const [tx, ty] = this.tileOf(targetX, targetZ);
    const key = ty * this.W + tx;
    let field = this.pathCache.get(key);
    if (!field) {
      if (this.pathCache.size > 24) this.pathCache.clear();
      field = new Int16Array(this.W * this.H);
      this.bfs(key, field);
      this.pathCache.set(key, field);
    }
    return this.stepAlong(field, x, z, out);
  }

  flowDistance(x: number, z: number) {
    const [tx, ty] = this.tileOf(x, z);
    return this.flow[ty * this.W + tx];
  }

  /** The closed door (if any) on the tile the given position is about to step into. */
  closedDoorAhead(x: number, z: number, dir: THREE.Vector3): Door | null {
    const [tx, ty] = this.tileOf(x + dir.x * 1.1, z + dir.z * 1.1);
    const d = this.doorAt.get(ty * this.W + tx);
    return d && d.blocking && !d.locked ? d : null;
  }

  // ------------------------------------------------------------------ doors & power

  unlockDoors() {
    for (const d of this.doors) {
      if (!d.locked) continue;
      d.locked = false;
      d.target = 1;
    }
    this.invalidateNav();
  }

  setPowered(on: boolean) {
    this.powered = on;
    this.hemi.intensity = on ? 0.42 : 0.2;
  }

  // ------------------------------------------------------------------ per-frame

  update(dt: number, time: number, player: THREE.Vector3) {
    for (const d of this.doors) {
      if (d.open === d.target) continue;
      d.open = damp(d.open, d.target, d.shutter ? 2.5 : 7, dt);
      if (Math.abs(d.open - d.target) < 0.01) d.open = d.target;
      if (d.shutter) d.pivot.position.y = d.open * (DOOR_H - 0.1);
      else d.pivot.rotation.y = (d.axis === 'x' ? -1 : 1) * d.open * Math.PI * 0.5;
    }
    this.updateFixtures(dt, time, player);
  }

  private updateFixtures(dt: number, time: number, player: THREE.Vector3) {
    const color = new THREE.Color();
    const on = new THREE.Color('#e4f0ea');
    const red = new THREE.Color('#ff3a24');
    for (const f of this.fixtures) {
      let lv = 0;
      if (f.kind === 'emergency') lv = 0.75 + 0.25 * Math.sin(time * 3 + f.phase);
      else if (this.powered) {
        lv = 1;
        if (f.kind === 'flicker') {
          const n = Math.sin(time * 23 + f.phase) * Math.sin(time * 7.3 + f.phase * 2) + Math.sin(time * 1.3 + f.phase);
          lv = n > 0.6 ? 0.08 : n > 0.3 ? 0.55 : 1;
        }
      }
      f.level = lv;
      color.copy(f.kind === 'emergency' ? red : on).multiplyScalar(f.kind === 'emergency' ? lv * 1.6 : 0.1 + lv * 1.9);
      this.fixtureMesh.setColorAt(f.index, color);
    }
    if (this.fixtureMesh.instanceColor) this.fixtureMesh.instanceColor.needsUpdate = true;

    // assign the pooled point lights to the nearest live fixtures
    this.lightTimer -= dt;
    if (this.lightTimer <= 0) {
      this.lightTimer = 0.2;
      const live = this.fixtures
        .filter((f) => f.kind === 'emergency' || this.powered)
        .map((f) => ({ f, d: f.pos.distanceToSquared(player) }))
        .sort((a, b) => a.d - b.d)
        .slice(0, this.lights.length)
        .map((e) => e.f);
      const free = this.lights.filter((l) => !l.fixture || !live.includes(l.fixture));
      for (const l of this.lights) if (l.fixture && !live.includes(l.fixture)) l.fixture = null;
      for (const f of live) {
        if (this.lights.some((l) => l.fixture === f)) continue;
        const slot = free.shift();
        if (!slot) break;
        slot.fixture = f;
        slot.fade = 0;
        slot.light.position.copy(f.pos).setY(WALL_H - 0.35);
        // fluorescent tubes vary tube to tube: some cool, some warm and tired
        slot.light.color.set(f.kind === 'emergency' ? '#ff3a24' : f.phase % 3 < 1 ? '#e8e2d0' : f.phase % 3 < 2 ? '#d6e6de' : '#cfe0e6');
      }
    }
    for (const l of this.lights) {
      l.fade = Math.min(1, l.fade + dt * 3);
      const f = l.fixture;
      if (!f) {
        l.light.intensity = damp(l.light.intensity, 0, 10, dt);
        continue;
      }
      const base = f.kind === 'emergency' ? 8 : 24;
      l.light.intensity = base * f.level * l.fade;
      l.light.distance = f.kind === 'emergency' ? 11 : 20;
    }
  }

  // ------------------------------------------------------------------ construction

  private buildSurfaces() {
    const M = materials();
    const bufs = new Map<string, Buf>();
    const get = (k: string) => {
      let b = bufs.get(k);
      if (!b) bufs.set(k, (b = { pos: [], nor: [], uv: [], col: [], idx: [] }));
      return b;
    };
    const W = this.W;
    const solidAt = (x: number, y: number) => this.isSolid(x, y);
    // vertex AO for floor/ceiling corners
    const cornerAO = (vx: number, vy: number) => {
      let n = 0;
      if (solidAt(vx - 1, vy - 1)) n++;
      if (solidAt(vx, vy - 1)) n++;
      if (solidAt(vx - 1, vy)) n++;
      if (solidAt(vx, vy)) n++;
      return 1 - n * 0.16;
    };

    const trim: TrimFace[] = [];
    for (let y = 0; y < this.H; y++) {
      for (let x = 0; x < W; x++) {
        if (this.solid[y * W + x]) continue;
        const style = this.styleAt[y * W + x] ?? 'concrete';
        const x0 = x * TILE, x1 = x0 + TILE, z0 = y * TILE, z1 = z0 + TILE;
        const isDoor = this.rows[y][x] === 'D' || this.rows[y][x] === 'L';
        const ceil = isDoor ? DOOR_H : WALL_H;
        // floor
        quad(get('floor:' + style), [[x0, 0, z1], [x1, 0, z1], [x1, 0, z0], [x0, 0, z0]], [0, 1, 0],
          [[x0 / 4, z1 / 4], [x1 / 4, z1 / 4], [x1 / 4, z0 / 4], [x0 / 4, z0 / 4]],
          [cornerAO(x, y + 1), cornerAO(x + 1, y + 1), cornerAO(x + 1, y), cornerAO(x, y)]);
        // ceiling
        quad(get(isDoor ? 'wall:' + style : 'ceiling'), [[x0, ceil, z0], [x1, ceil, z0], [x1, ceil, z1], [x0, ceil, z1]], [0, -1, 0],
          [[x0 / 4, z0 / 4], [x1 / 4, z0 / 4], [x1 / 4, z1 / 4], [x0 / 4, z1 / 4]],
          [cornerAO(x, y), cornerAO(x + 1, y), cornerAO(x + 1, y + 1), cornerAO(x, y + 1)].map((v) => 0.5 + v * 0.5));
        // walls around this open tile
        for (const [dx, dy] of DIRS) {
          if (!solidAt(x + dx, y + dy)) {
            // lintel faces above a doorway seen from a room
            const nIsDoor = this.rows[y + dy]?.[x + dx] === 'D' || this.rows[y + dy]?.[x + dx] === 'L';
            if (!isDoor && nIsDoor) this.wallFace(get('wall:' + style), x, y, dx, dy, DOOR_H, WALL_H);
            continue;
          }
          this.wallFace(get('wall:' + style), x, y, dx, dy, 0, ceil);
          if (!isDoor) trim.push({ style, x, y, dx, dy });
        }
      }
    }

    for (const [k, b] of bufs) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(b.nor, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
      g.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 3));
      g.setIndex(b.idx);
      g.computeBoundingSphere();
      const [kind, style] = k.split(':') as ['floor' | 'wall' | 'ceiling', SurfaceStyle];
      const base = kind === 'ceiling' ? M.ceiling : kind === 'floor' ? M.floor[style] : M.wall[style];
      const mat = base.clone();
      mat.vertexColors = true;
      const mesh = new THREE.Mesh(g, mat);
      mesh.receiveShadow = true;
      mesh.castShadow = kind === 'wall';
      mesh.userData.surface = kind;
      this.group.add(mesh);
      this.hitMeshes.push(mesh);
    }
    this.buildTrim(trim);
  }

  /**
   * Real geometry for the details that sell a hospital: rubber skirting, vinyl crash rails on
   * brackets in wards and labs, and conduit runs along the top of the basement walls. One merged
   * mesh per material.
   */
  private buildTrim(faces: TrimFace[]) {
    const M = materials();
    const geos = new Map<THREE.Material, THREE.BufferGeometry[]>();
    const push = (m: THREE.Material, g: THREE.BufferGeometry) => {
      let l = geos.get(m);
      if (!l) geos.set(m, (l = []));
      l.push(g);
    };
    const m4 = new THREE.Matrix4();
    for (const f of faces) {
      const alongZ = f.dx !== 0;
      // centre of the wall face, and the direction pointing back into the room
      const cx = f.x * TILE + TILE / 2 + (f.dx * TILE) / 2;
      const cz = f.y * TILE + TILE / 2 + (f.dy * TILE) / 2;
      const nx = -f.dx;
      const nz = -f.dy;
      /** box flush against the wall: `len` along it, `h` tall, `t` proud of the surface, `off` gap from it */
      const strip = (m: THREE.Material, y: number, h: number, t: number, len = TILE, along = 0, off = 0) => {
        const g = alongZ ? new THREE.BoxGeometry(t, h, len) : new THREE.BoxGeometry(len, h, t);
        const px = cx + nx * (off + t / 2) + (alongZ ? 0 : along);
        const pz = cz + nz * (off + t / 2) + (alongZ ? along : 0);
        push(m, g.applyMatrix4(m4.makeTranslation(px, y, pz)));
      };
      const pipe = (r: number, y: number, off: number) => {
        const g = new THREE.CylinderGeometry(r, r, TILE, 10, 1, true);
        g.rotateZ(Math.PI / 2);
        if (alongZ) g.rotateY(Math.PI / 2);
        push(M.conduit, g.applyMatrix4(m4.makeTranslation(cx + nx * off, y, cz + nz * off)));
      };
      switch (f.style) {
        case 'ward':
          strip(M.skirting, 0.06, 0.12, 0.016);
          strip(M.railWard, 1.0, 0.14, 0.05, TILE, 0, 0.03);
          for (const a of [-0.55, 0.55]) strip(M.bracket, 0.99, 0.07, 0.03, 0.05, a);
          break;
        case 'lab':
          strip(M.skirting, 0.05, 0.1, 0.012);
          strip(M.railLab, 0.95, 0.1, 0.04, TILE, 0, 0.025);
          for (const a of [-0.55, 0.55]) strip(M.bracket, 0.95, 0.05, 0.025, 0.04, a);
          break;
        case 'tile':
          // coved base in wet rooms
          strip(M.skirting, 0.04, 0.08, 0.01);
          break;
        case 'concrete':
          strip(M.skirting, 0.05, 0.1, 0.03);
          pipe(0.045, WALL_H - 0.28, 0.1);
          pipe(0.025, WALL_H - 0.44, 0.075);
          strip(M.bracket, WALL_H - 0.33, 0.24, 0.13, 0.04, 0.3);
          break;
      }
    }
    for (const [m, list] of geos) {
      const merged = mergeGeometries(list, false);
      list.forEach((g) => g.dispose());
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, m);
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }
  }

  private wallFace(b: Buf, x: number, y: number, dx: number, dy: number, y0: number, y1: number) {
    const x0 = x * TILE, x1 = x0 + TILE, z0 = y * TILE, z1 = z0 + TILE;
    const v0 = y0 / WALL_H, v1 = y1 / WALL_H;
    const s0 = y0 === 0 ? 0.62 : 0.85;
    const s1 = 0.9;
    const q = quad;
    if (dx === 1) q(b, [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], [-1, 0, 0], [[z1 / 4, v0], [z0 / 4, v0], [z0 / 4, v1], [z1 / 4, v1]], [s0, s0, s1, s1]);
    if (dx === -1) q(b, [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], [1, 0, 0], [[z0 / 4, v0], [z1 / 4, v0], [z1 / 4, v1], [z0 / 4, v1]], [s0, s0, s1, s1]);
    if (dy === 1) q(b, [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [0, 0, -1], [[x0 / 4, v0], [x1 / 4, v0], [x1 / 4, v1], [x0 / 4, v1]], [s0, s0, s1, s1]);
    if (dy === -1) q(b, [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], [0, 0, 1], [[x1 / 4, v0], [x0 / 4, v0], [x0 / 4, v1], [x1 / 4, v1]], [s0, s0, s1, s1]);
  }

  /** Scattered blood on walls and floors, merged into a few draw calls. */
  private buildDecals() {
    const rng = new Rng(this.def.wave * 77 + 5);
    const mats = [bloodTexture(11), bloodTexture(23), smearTexture(7), smearTexture(19)].map(
      (t) => new THREE.MeshStandardMaterial({ map: t, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, roughness: 0.35 }),
    );
    const geos: THREE.BufferGeometry[][] = mats.map(() => []);
    const o = new THREE.Object3D();
    const add = (mat: number, size: number, pos: THREE.Vector3, normal: THREE.Vector3) => {
      o.position.copy(pos);
      o.lookAt(pos.clone().add(normal));
      o.rotateZ(mat >= 2 ? rng.range(-0.15, 0.15) : rng.range(0, Math.PI * 2));
      o.scale.setScalar(size);
      o.updateMatrix();
      geos[mat].push(new THREE.PlaneGeometry(1, 1).applyMatrix4(o.matrix));
    };
    for (let y = 0; y < this.H; y++) {
      for (let x = 0; x < this.W; x++) {
        const c = this.rows[y][x];
        if (this.solid[y * this.W + x] || c === 'D' || c === 'L') continue;
        const cx = x * TILE + TILE / 2;
        const cz = y * TILE + TILE / 2;
        for (const [dx, dy] of DIRS) {
          if (!this.isSolid(x + dx, y + dy) || !rng.chance(0.06)) continue;
          const along = rng.range(-0.6, 0.6);
          const pos = new THREE.Vector3(cx + dx * (TILE / 2 - 0.005) + (dy ? along : 0), rng.range(0.5, 1.5), cz + dy * (TILE / 2 - 0.005) + (dx ? along : 0));
          const smear = rng.chance(0.6);
          add(smear ? rng.int(2, 3) : rng.int(0, 1), smear ? rng.range(0.8, 1.3) : rng.range(0.4, 0.9), pos, new THREE.Vector3(-dx, 0, -dy));
        }
        if (rng.chance(0.035)) add(rng.int(0, 1), rng.range(0.6, 1.5), new THREE.Vector3(cx + rng.range(-0.5, 0.5), 0.006, cz + rng.range(-0.5, 0.5)), new THREE.Vector3(0, 1, 0));
      }
    }
    mats.forEach((m, i) => {
      if (!geos[i].length) return;
      const merged = mergeGeometries(geos[i], false);
      if (!merged) return;
      const mesh = new THREE.Mesh(merged, m);
      mesh.receiveShadow = true;
      mesh.renderOrder = 1;
      this.group.add(mesh);
    });
  }

  /** Yaw that turns a prop's back (-Z) toward the nearest wall. */
  private wallYaw(x: number, y: number, rng: Rng): number | null {
    // order: wall at -Z (north), +Z (south), -X (west), +X (east)
    const opts: [boolean, number][] = [
      [this.isSolid(x, y - 1), 0],
      [this.isSolid(x, y + 1), Math.PI],
      [this.isSolid(x - 1, y), -Math.PI / 2],
      [this.isSolid(x + 1, y), Math.PI / 2],
    ];
    const valid = opts.filter((o) => o[0]);
    if (!valid.length) return null;
    return rng.pick(valid)[1];
  }

  private buildContents() {
    const M = materials();
    const rng = new Rng(this.def.wave * 1000 + 17);
    const staticByMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
    const markAt = (x: number, y: number) => this.marks.find((m) => m.x === x && m.y === y);

    const addStatic = (obj: THREE.Object3D) => {
      obj.updateMatrixWorld(true);
      obj.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const mat = mesh.material as THREE.Material;
        if ((mat as THREE.MeshStandardMaterial).transparent) {
          // keep transparent parts as standalone meshes (sorting)
          const clone = new THREE.Mesh(mesh.geometry, mat);
          clone.applyMatrix4(mesh.matrixWorld);
          this.group.add(clone);
          return;
        }
        const geo = mesh.geometry.index ? mesh.geometry.clone() : mesh.geometry.clone();
        geo.applyMatrix4(mesh.matrixWorld);
        for (const name of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(name)) geo.deleteAttribute(name);
        let list = staticByMat.get(mat);
        if (!list) staticByMat.set(mat, (list = []));
        list.push(geo);
      });
    };

    const place = (b: PropBuild, x: number, y: number, yaw: number, dynamic: boolean, collide = true) => {
      b.group.position.set(x * TILE + TILE / 2, 0, y * TILE + TILE / 2);
      b.group.rotation.y = yaw;
      b.group.updateMatrixWorld(true);
      if (collide) {
        const box = new THREE.Box3().setFromObject(b.group);
        const shrink = 0.04;
        this.colliders[y * this.W + x].push({ minX: box.min.x + shrink, maxX: box.max.x - shrink, minZ: box.min.z + shrink, maxZ: box.max.z - shrink });
        this.blocked[y * this.W + x] = 1;
      }
      if (dynamic) {
        this.group.add(b.group);
        b.group.traverse((o) => {
          if ((o as THREE.Mesh).isMesh) this.hitMeshes.push(o);
        });
      } else addStatic(b.group);
    };

    for (let y = 0; y < this.H; y++) {
      for (let x = 0; x < this.W; x++) {
        const c = this.rows[y][x];
        const wx = x * TILE + TILE / 2;
        const wz = y * TILE + TILE / 2;
        if (c === 'P') {
          this.start.set(wx, 0, wz);
          // face the most open direction
          let best = 0;
          let bestLen = -1;
          for (const [dx, dy, yaw] of [[0, -1, 0], [0, 1, Math.PI], [-1, 0, Math.PI / 2], [1, 0, -Math.PI / 2]] as const) {
            let len = 0;
            while (!this.isSolid(x + dx * (len + 1), y + dy * (len + 1)) && len < 20) len++;
            if (len > bestLen) {
              bestLen = len;
              best = yaw;
            }
          }
          this.startYaw = best;
        } else if (c === 'S') {
          this.vents.push(new THREE.Vector3(wx, 0, wz));
          const grate = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.02, 0.9), M.darkMetal);
          grate.position.set(wx, 0.01, wz);
          grate.receiveShadow = true;
          addStatic(grate);
        } else if ('zRBCU0'.includes(c)) {
          this.spawns.push({ ch: c, pos: new THREE.Vector3(wx + rng.range(-0.4, 0.4), 0, wz + rng.range(-0.4, 0.4)) });
        } else if ('1234'.includes(c)) {
          this.loot.push({ ch: c, pos: new THREE.Vector3(wx + rng.range(-0.3, 0.3), 0, wz + rng.range(-0.3, 0.3)) });
        } else if (c === 'D' || c === 'L') {
          this.buildDoor(x, y, c === 'L');
        } else if (c === 'E') {
          this.buildExitDoor(x, y);
        } else if (c === 'T') {
          const mk = markAt(x, y);
          if (mk?.kind === 'terminal') {
            const b = buildTerminal(mk.prop);
            const yaw = this.wallYaw(x, y, rng) ?? 0;
            place(b, x, y, yaw, true, mk.prop !== 'airlock');
            this.terminals.push({ id: mk.id, label: mk.label, hold: mk.hold, pos: new THREE.Vector3(wx, 0, wz), used: false, build: b });
          }
        } else if (PROP_CHARS.includes(c)) {
          const b = buildProp(c, rng);
          if (!b) continue;
          const wy = this.wallYaw(x, y, rng);
          const yaw = b.freeRotate ? rng.range(0, Math.PI * 2) : wy ?? rng.int(0, 3) * (Math.PI / 2);
          place(b, x, y, yaw, !!b.dynamic);
          if (c === 'x') this.stations.push({ kind: 'lab', pos: new THREE.Vector3(wx, 0, wz), build: b });
          if (c === 'y') this.stations.push({ kind: 'synth', pos: new THREE.Vector3(wx, 0, wz), build: b });
        }
      }
    }

    for (const [mat, geos] of staticByMat) {
      const merged = mergeGeometries(geos, false);
      if (!merged) continue;
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.surface = 'prop';
      this.group.add(mesh);
      this.hitMeshes.push(mesh);
    }
  }

  private buildDoor(x: number, y: number, locked: boolean) {
    const axis: 'x' | 'z' = this.isSolid(x - 1, y) && this.isSolid(x + 1, y) ? 'x' : 'z';
    const cx = x * TILE + TILE / 2;
    const cz = y * TILE + TILE / 2;
    const width = TILE - 0.16;
    const M = materials();
    let pivot: THREE.Group;
    if (locked) {
      pivot = buildShutter(TILE);
      const holder = new THREE.Group();
      holder.position.set(cx, 0, cz);
      holder.rotation.y = axis === 'x' ? 0 : Math.PI / 2;
      holder.add(pivot);
      this.group.add(holder);
    } else {
      pivot = new THREE.Group();
      const leaf = buildDoorLeaf(width, false);
      pivot.add(leaf);
      const holder = new THREE.Group();
      holder.position.set(cx, 0, cz);
      holder.rotation.y = axis === 'x' ? 0 : Math.PI / 2;
      pivot.position.x = -width / 2;
      holder.add(pivot);
      this.group.add(holder);
      // frame posts
      for (const s of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, DOOR_H, 0.2), M.darkMetal);
        post.position.set(s * (TILE / 2 - 0.04), DOOR_H / 2, 0);
        post.castShadow = true;
        holder.add(post);
      }
    }
    pivot.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) this.hitMeshes.push(o);
    });
    const door = new Door(x, y, axis, locked, locked, pivot);
    this.doors.push(door);
    this.doorAt.set(y * this.W + x, door);
    const half = 0.12;
    this.colliders[y * this.W + x].push(
      axis === 'x'
        ? { minX: x * TILE, maxX: x * TILE + TILE, minZ: cz - half, maxZ: cz + half, door }
        : { minX: cx - half, maxX: cx + half, minZ: y * TILE, maxZ: y * TILE + TILE, door },
    );
  }

  private buildExitDoor(x: number, y: number) {
    let face = new THREE.Vector3(0, 0, 1);
    let yaw = 0;
    let off = new THREE.Vector3(0, 0, -TILE / 2);
    if (this.isSolid(x, y - 1)) { face.set(0, 0, 1); yaw = 0; off.set(0, 0, -TILE / 2); }
    else if (this.isSolid(x, y + 1)) { face.set(0, 0, -1); yaw = Math.PI; off.set(0, 0, TILE / 2); }
    else if (this.isSolid(x - 1, y)) { face.set(1, 0, 0); yaw = Math.PI / 2; off.set(-TILE / 2, 0, 0); }
    else { face.set(-1, 0, 0); yaw = -Math.PI / 2; off.set(TILE / 2, 0, 0); }
    const label = this.def.exitLabel.toUpperCase().replace(/^(TAKE|ENTER|CROSS) (THE )?/, '');
    const { group, lamp } = buildExit(label || 'EXIT', this.def.title);
    const pos = new THREE.Vector3(x * TILE + TILE / 2, 0, y * TILE + TILE / 2);
    group.position.copy(pos).add(off).addScaledVector(face, 0.02);
    group.rotation.y = yaw;
    this.group.add(group);
    group.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) this.hitMeshes.push(o);
    });
    this.exit = { pos, lamp, face };
  }

  private buildFixtures() {
    const pts: Fixture[] = [];
    for (let y = 0; y < this.H; y++) {
      for (let x = 0; x < this.W; x++) {
        const c = this.rows[y][x];
        const kind = c === '*' ? 'normal' : c === '!' ? 'flicker' : c === '^' ? 'emergency' : null;
        if (!kind) continue;
        pts.push({ pos: new THREE.Vector3(x * TILE + TILE / 2, WALL_H, y * TILE + TILE / 2), kind, phase: Math.random() * 100, level: 0, index: pts.length });
      }
    }
    this.fixtures.push(...pts);
    const M = materials();
    const panelGeo = new THREE.BoxGeometry(1.25, 0.05, 0.42);
    const panelMat = new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: true });
    this.fixtureMesh = new THREE.InstancedMesh(panelGeo, panelMat, Math.max(1, pts.length));
    const housing = new THREE.InstancedMesh(new THREE.BoxGeometry(1.35, 0.08, 0.52), M.darkMetal, Math.max(1, pts.length));
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    pts.forEach((f, i) => {
      const rot = (Math.floor(f.pos.x) + Math.floor(f.pos.z)) % 4 === 0 ? Math.PI / 2 : 0;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot);
      const small = f.kind === 'emergency' ? new THREE.Vector3(0.3, 1.6, 0.5) : new THREE.Vector3(1, 1, 1);
      m4.compose(f.pos.clone().setY(WALL_H - 0.06), q, small);
      this.fixtureMesh.setMatrixAt(i, m4);
      m4.compose(f.pos.clone().setY(WALL_H - 0.02), q, small);
      housing.setMatrixAt(i, m4);
      this.fixtureMesh.setColorAt(i, new THREE.Color(0, 0, 0));
    });
    this.fixtureMesh.count = pts.length;
    housing.count = pts.length;
    this.group.add(this.fixtureMesh, housing);

    for (let i = 0; i < 5; i++) {
      const light = new THREE.PointLight('#d6e6de', 0, 15, 2);
      light.castShadow = false;
      this.group.add(light);
      this.lights.push({ light, fixture: null, fade: 0 });
    }
  }

  dispose() {
    disposeTree(this.group);
  }
}
