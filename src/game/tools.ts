import * as THREE from 'three';
import type { ItemId } from '../data/items';
import { ITEMS } from '../data/items';
import { audio } from '../core/audio';
import { clamp, rand } from '../core/math';
import { materials } from '../world/materials';
import type { Game } from './game';

type Throwable = 'frag' | 'flare' | 'lure';

interface Projectile {
  kind: Throwable;
  mesh: THREE.Mesh;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  fuse: number;
  resting: boolean;
  light?: THREE.PointLight;
  life: number;
  beep: number;
}

interface GasCloud {
  pos: THREE.Vector3;
  radius: number;
  life: number;
  puff: number;
}

/**
 * Consumables (bandage, medkit, antiviral) and throwables (pipe grenade, flare, noise lure), plus
 * the Bloater gas hazard.
 */
export class ToolSystem {
  readonly group = new THREE.Group();
  private projectiles: Projectile[] = [];
  private clouds: GasCloud[] = [];
  /** item being applied */
  using: { item: ItemId; t: number; dur: number } | null = null;
  private coughTimer = 0;
  private healOverTime = 0;

  private flareLights: THREE.PointLight[] = [];

  constructor(private game: Game) {
    for (let i = 0; i < 2; i++) {
      const l = new THREE.PointLight('#ff3a24', 0, 16, 1.6);
      this.flareLights.push(l);
      this.group.add(l);
    }
  }

  get lure(): THREE.Vector3 | null {
    let best: Projectile | null = null;
    for (const p of this.projectiles) if ((p.kind === 'flare' || p.kind === 'lure') && p.life > 0 && p.resting) best = p;
    return best ? best.pos : null;
  }

  get useProgress() {
    return this.using ? clamp(this.using.t / this.using.dur, 0, 1) : 0;
  }

  /** Try to use or throw a tool. Returns false with a reason if it can't. */
  use(item: ItemId): string | null {
    const g = this.game;
    const p = g.player;
    if (this.using) return 'Busy';
    if (!g.inventory.has(item)) return `No ${ITEMS[item].name.toLowerCase()}`;
    switch (item) {
      case 'bandage':
      case 'medkit':
        if (p.health >= p.maxHealth) return 'Health is full';
        break;
      case 'antiviral':
        if (p.exposure <= 0.5) return 'No exposure to treat';
        break;
      case 'frag':
      case 'flare':
      case 'lure':
        g.inventory.remove(item);
        this.throwItem(item);
        g.weapons.lower(0.55);
        return null;
      default:
        return 'Cannot use that';
    }
    const dur = item === 'medkit' ? 2.2 : item === 'antiviral' ? 1.4 : 1.3;
    this.using = { item, t: 0, dur };
    g.weapons.lower(dur + 0.1);
    audio.ui('pickup');
    return null;
  }

  private finishUse(item: ItemId) {
    const g = this.game;
    const p = g.player;
    if (!g.inventory.remove(item)) return;
    if (item === 'medkit') p.health = Math.min(p.maxHealth, p.health + 70);
    if (item === 'bandage') this.healOverTime += 25;
    if (item === 'antiviral') {
      p.exposure = Math.max(0, p.exposure - 35);
      g.hud.toast('Exposure reduced', 'violet');
    }
    audio.ui('craft');
  }

  private throwItem(kind: Throwable) {
    const g = this.game;
    const cam = g.camera;
    const origin = cam.getWorldPosition(new THREE.Vector3());
    const fwd = cam.getWorldDirection(new THREE.Vector3());
    const M = materials();
    const geo = kind === 'frag' ? new THREE.CylinderGeometry(0.04, 0.04, 0.14, 10) : new THREE.CylinderGeometry(0.025, 0.025, 0.22, 8);
    const mat = kind === 'frag' ? M.rust : kind === 'flare' ? new THREE.MeshStandardMaterial({ color: '#c42a1a', emissive: '#ff4020', emissiveIntensity: 0 }) : M.paintedWhite;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    const pos = origin.clone().addScaledVector(fwd, 0.4).add(new THREE.Vector3(0, -0.15, 0));
    const vel = fwd.clone().multiplyScalar(kind === 'frag' ? 13 : 11).add(new THREE.Vector3(0, 2.6, 0)).add(g.player.vel.clone().multiplyScalar(0.6));
    mesh.position.copy(pos);
    this.group.add(mesh);
    const proj: Projectile = { kind, mesh, pos, vel, fuse: kind === 'frag' ? 2.5 : 0, resting: false, life: kind === 'flare' ? 20 : kind === 'lure' ? 12 : 0, beep: 0 };
    if (kind === 'flare') {
      // reuse a pooled light: adding lights at runtime forces every shader to recompile
      proj.light = this.flareLights.find((l) => !this.projectiles.some((p) => p.light === l)) ?? this.flareLights[0];
      audio.flare(pos);
    }
    this.projectiles.push(proj);
    audio.swing();
  }

  addGas(pos: THREE.Vector3) {
    this.clouds.push({ pos: pos.clone().setY(0), radius: 3.6, life: 9, puff: 0 });
  }

  update(dt: number) {
    const g = this.game;
    const p = g.player;

    // item application
    if (this.using) {
      this.using.t += dt;
      p.encumbered = 0.6;
      if (this.using.t >= this.using.dur) {
        const item = this.using.item;
        this.using = null;
        this.finishUse(item);
      }
    } else p.encumbered = 0;
    if (this.healOverTime > 0) {
      const h = Math.min(this.healOverTime, dt * 9);
      this.healOverTime -= h;
      p.health = Math.min(p.maxHealth, p.health + h);
    }

    // projectiles
    for (const pr of this.projectiles) {
      if (!pr.resting) {
        pr.vel.y -= 16 * dt;
        pr.pos.addScaledVector(pr.vel, dt);
        if (pr.pos.y < 0.05) {
          pr.pos.y = 0.05;
          pr.vel.y *= -0.3;
          pr.vel.x *= 0.6;
          pr.vel.z *= 0.6;
          if (Math.abs(pr.vel.y) < 0.6 && pr.vel.length() < 1.2) {
            pr.resting = true;
            pr.vel.set(0, 0, 0);
          } else audio.impactSurface(pr.pos, true);
        }
        const flat = pr.pos.clone();
        if (g.level!.resolveCircle(flat, 0.08)) {
          // bounce off the wall we hit
          const nx = flat.x - pr.pos.x;
          const nz = flat.z - pr.pos.z;
          if (Math.abs(nx) > Math.abs(nz)) pr.vel.x *= -0.45;
          else pr.vel.z *= -0.45;
          pr.pos.x = flat.x;
          pr.pos.z = flat.z;
          if (pr.vel.length() > 2) audio.impactSurface(pr.pos, true);
        }
        if (pr.pos.y > 3.1) {
          pr.pos.y = 3.1;
          pr.vel.y *= -0.3;
        }
        pr.mesh.rotation.x += dt * 9;
        pr.mesh.rotation.z += dt * 5;
      } else {
        pr.mesh.rotation.x = Math.PI / 2;
      }
      pr.mesh.position.copy(pr.pos);

      if (pr.kind === 'frag') {
        pr.fuse -= dt;
        if (pr.fuse <= 0) this.explode(pr);
      } else if (pr.kind === 'flare') {
        pr.life -= dt;
        const flicker = 0.75 + Math.random() * 0.25;
        pr.light!.intensity = (pr.life > 1 ? 32 : 32 * pr.life) * flicker;
        pr.light!.position.copy(pr.pos).setY(pr.pos.y + 0.3);
        (pr.mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = 3 * flicker;
        if (Math.random() < 0.6) g.effects.flareSparks(pr.pos);
        pr.beep -= dt;
        if (pr.beep <= 0 && pr.resting) {
          pr.beep = 2;
          g.makeNoise(pr.pos, 22);
        }
      } else if (pr.kind === 'lure') {
        pr.life -= dt;
        pr.beep -= dt;
        if (pr.beep <= 0 && pr.resting) {
          pr.beep = 0.6;
          audio.lureBeep(pr.pos);
          g.makeNoise(pr.pos, 30);
        }
      }
    }
    this.projectiles = this.projectiles.filter((pr) => {
      const done = (pr.kind === 'frag' && pr.fuse <= 0) || (pr.kind !== 'frag' && pr.life <= 0);
      if (done) {
        pr.mesh.removeFromParent();
        if (pr.light) pr.light.intensity = 0;
      }
      return !done;
    });

    // gas clouds
    let inGas = false;
    for (const c of this.clouds) {
      c.life -= dt;
      c.puff -= dt;
      if (c.puff <= 0 && c.life > 1) {
        c.puff = 0.12;
        g.effects.gasPuff(c.pos, c.radius);
      }
      if (p.alive && p.pos.distanceTo(c.pos) < c.radius && c.life > 0.5) inGas = true;
    }
    this.clouds = this.clouds.filter((c) => c.life > 0);
    if (inGas) {
      p.exposure = Math.min(100, p.exposure + dt * 7 * g.difficulty.exposure);
      p.health -= dt * 4;
      p.damageFlash = Math.max(p.damageFlash, 0.25);
      this.coughTimer -= dt;
      if (this.coughTimer <= 0) {
        this.coughTimer = rand(1, 1.8);
        audio.cough();
      }
    }
  }

  get inGas() {
    const p = this.game.player.pos;
    return this.clouds.some((c) => p.distanceTo(c.pos) < c.radius && c.life > 0.5);
  }

  private explode(pr: Projectile) {
    const g = this.game;
    const at = pr.pos.clone().setY(Math.max(0.3, pr.pos.y));
    g.effects.explosion(at);
    audio.explosion(at);
    g.makeNoise(at, 55);
    const R = 6.5;
    for (const inf of g.infected) {
      if (!inf.alive) continue;
      const d = inf.pos.distanceTo(at);
      if (d > R) continue;
      if (!g.level!.lineOfSight(at.x, at.z, inf.pos.x, inf.pos.z)) continue;
      const k = 1 - d / R;
      const dir = inf.pos.clone().sub(at).setY(0).normalize();
      const r = inf.damage(260 * k * k + 30, 'body', dir, 1, g.infCtx);
      if (r.killed) g.onKill(inf, false, 'frag');
    }
    const pd = g.player.pos.distanceTo(at);
    if (pd < R && g.level!.lineOfSight(at.x, at.z, g.player.pos.x, g.player.pos.z)) {
      const k = 1 - pd / R;
      g.player.damage(70 * k * k, at, 0, 4 * k);
    }
    g.player.shake(clamp(1 - pd / 16, 0, 0.9));
  }

  clear() {
    for (const pr of this.projectiles) {
      pr.mesh.removeFromParent();
      if (pr.light) pr.light.intensity = 0;
    }
    this.projectiles = [];
    this.clouds = [];
    this.using = null;
    this.healOverTime = 0;
  }
}
