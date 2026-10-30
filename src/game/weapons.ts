import * as THREE from 'three';
import { WEAPONS, type FireMode, type WeaponDef, type WeaponId } from '../data/weapons';
import { audio } from '../core/audio';
import { DEG, Spring, clamp, damp, rand, smoothstep } from '../core/math';
import { buildViewModel, type ViewModel } from './viewmodels';
import type { Game } from './game';
import type { Infected, Zone } from './infected';

type WState = 'ready' | 'equip' | 'holster' | 'reload' | 'melee' | 'lowered';

const ray = new THREE.Raycaster();
const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();

/**
 * Handles the equipped weapon: fire control, spread, recoil, reloads, melee and every viewmodel
 * animation layer (equip, sway, bob, sprint, ADS, recoil, reload, swing).
 */
export class WeaponSystem {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private models = new Map<WeaponId, ViewModel>();
  private vm!: ViewModel;
  private holder = new THREE.Group();
  private hemi: THREE.HemisphereLight;
  private key: THREE.DirectionalLight;
  private flashLight: THREE.PointLight;

  state: WState = 'equip';
  private stateT = 0;
  private stateDur = 0;
  private pending: WeaponId | null = null;
  private lastWeapon: WeaponId | null = null;
  ads = 0;
  private cooldown = 0;
  private burstLeft = 0;
  private bloom = 0;
  private reloadFromEmpty = false;
  private reloadGiven = false;
  private shellTimer = 0;
  private pumpT = 1;
  private flashT = 0;
  private meleeHitDone = false;
  private meleeKind: 'axe' | 'bash' = 'axe';
  private kick = new Spring(220, 18);
  private kickRot = new Spring(160, 14);
  private slideSpring = new Spring(400, 26);
  private swayX = 0;
  private swayY = 0;
  private sprint = 0;
  private lowerAmount = 0;
  private time = 0;

  constructor(private game: Game) {
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.01, 10);
    this.scene.add(this.camera);
    this.camera.add(this.holder);
    this.hemi = new THREE.HemisphereLight('#c9dbd4', '#202624', 0.6);
    this.scene.add(this.hemi);
    this.key = new THREE.DirectionalLight('#e4efe9', 0.9);
    this.key.position.set(0.3, 1, 0.4);
    this.scene.add(this.key);
    const rim = new THREE.DirectionalLight('#9fb8c8', 0.5);
    rim.position.set(-1, 0.3, -0.6);
    this.scene.add(rim);
    this.flashLight = new THREE.PointLight('#ffb36b', 0, 2, 2);
    this.flashLight.position.set(0.1, -0.05, -0.6);
    this.camera.add(this.flashLight);
    for (const id of Object.keys(WEAPONS) as WeaponId[]) {
      const m = buildViewModel(id);
      m.root.visible = false;
      this.holder.add(m.root);
      this.models.set(id, m);
    }
    this.vm = this.models.get('axe')!;
  }

  get def(): WeaponDef {
    return WEAPONS[this.game.inventory.current];
  }
  get current() {
    return this.game.inventory.current;
  }
  get mode(): FireMode {
    return this.game.inventory.modes[this.current] ?? this.def.modes[0];
  }
  get mag() {
    return this.game.inventory.mags[this.current] ?? 0;
  }
  get reserve() {
    const a = this.def.ammo;
    return a ? this.game.inventory.ammo[a] : 0;
  }
  get busy() {
    return this.state !== 'ready';
  }
  get reloading() {
    return this.state === 'reload';
  }
  get scoped() {
    return !!this.vm.scoped && this.ads > 0.92;
  }
  get aimingDownSights() {
    return this.ads > 0.5;
  }

  /** Current spread cone in degrees (for crosshair + shots). */
  get spreadDeg() {
    const d = this.def;
    const p = this.game.player;
    let s = d.spread + (d.adsSpread - d.spread) * this.ads;
    s += d.moveSpread * p.speed01 * (1 - this.ads * 0.6);
    if (!p.onGround) s += 3;
    if (p.crouching) s *= 0.8;
    s += this.bloom;
    return s;
  }

  // ------------------------------------------------------------------ switching

  /** Instantly show a weapon (level start). */
  reset(id: WeaponId) {
    for (const m of this.models.values()) m.root.visible = false;
    this.game.inventory.current = id;
    this.vm = this.models.get(id)!;
    this.vm.root.visible = true;
    this.setState('equip', this.def.equipTime);
    audio.mech('equip');
    this.ads = 0;
    this.pending = null;
    this.game.hud.weaponChanged();
  }

  select(id: WeaponId) {
    if (!this.game.inventory.weapons.has(id)) return;
    if (id === this.current && this.state !== 'holster') return;
    this.pending = id;
    if (this.state !== 'holster') this.setState('holster', 0.22);
  }

  quickSwap() {
    if (this.lastWeapon && this.game.inventory.weapons.has(this.lastWeapon)) this.select(this.lastWeapon);
  }

  cycle(dir: number, order: WeaponId[]) {
    const owned = order.filter((w) => this.game.inventory.weapons.has(w));
    if (owned.length < 2) return;
    const i = owned.indexOf(this.pending ?? this.current);
    this.select(owned[(i + dir + owned.length) % owned.length]);
  }

  /** Lower the weapon for item use or a throw. */
  lower(seconds: number) {
    this.setState('lowered', seconds);
  }

  private setState(s: WState, dur: number) {
    this.state = s;
    this.stateT = 0;
    this.stateDur = dur;
  }

  // ------------------------------------------------------------------ input + logic

  update(dt: number, enabled: boolean) {
    this.time += dt;
    const input = this.game.input;
    const p = this.game.player;
    const d = this.def;
    this.stateT += dt;
    this.cooldown -= dt;
    this.flashT -= dt;
    this.bloom = damp(this.bloom, 0, 4, dt);

    const wantAds = enabled && input.mouse(2) && !p.sprinting && this.state !== 'melee' && this.state !== 'holster' && this.state !== 'lowered' && d.id !== 'axe';
    this.ads = clamp(this.ads + (wantAds ? 1 : -1) * (dt / d.adsTime), 0, 1);
    p.aiming = this.ads > 0.3;

    switch (this.state) {
      case 'equip':
        if (this.stateT >= this.stateDur) this.state = 'ready';
        break;
      case 'holster':
        if (this.stateT >= this.stateDur) {
          if (this.pending) {
            this.lastWeapon = this.current;
            this.vm.root.visible = false;
            this.game.inventory.current = this.pending;
            this.vm = this.models.get(this.pending)!;
            this.vm.root.visible = true;
            this.pending = null;
            this.setState('equip', this.def.equipTime);
            audio.mech('equip');
            this.game.hud.weaponChanged();
          } else this.setState('equip', 0.2);
        }
        break;
      case 'lowered':
        if (this.stateT >= this.stateDur) this.setState('equip', 0.25);
        break;
      case 'reload':
        this.updateReload(dt, enabled);
        break;
      case 'melee':
        this.updateMelee();
        break;
    }

    if (enabled && this.state === 'ready') {
      if (input.pressed('KeyR')) this.startReload();
      if (input.pressed('KeyB') && d.modes.length > 1) {
        const modes = d.modes;
        const next = modes[(modes.indexOf(this.mode) + 1) % modes.length];
        this.game.inventory.modes[this.current] = next;
        audio.mech('mode');
        this.game.hud.weaponChanged();
      }
      if (input.pressed('KeyV') && d.id !== 'axe') this.startMelee('bash');
    }

    // trigger
    const trig = enabled && input.mouse(0) && !p.sprinting;
    const pressed = enabled && input.mousePressed(0) && !p.sprinting;
    if (d.melee) {
      if (pressed && this.state === 'ready') this.startMelee('axe');
    } else if (this.state === 'ready') {
      if (this.burstLeft > 0) {
        if (this.cooldown <= 0) this.fireOnce();
      } else if (pressed || (trig && this.mode === 'auto')) {
        if (this.cooldown <= 0) {
          if (this.mag <= 0) {
            if (pressed) {
              audio.dryFire();
              if (this.reserve > 0) this.startReload();
            }
          } else {
            if (this.mode === 'burst' && pressed) this.burstLeft = 3;
            this.fireOnce();
          }
        }
      }
    } else if (this.state === 'reload' && d.perShell && pressed && this.mag > 0) {
      // interrupt a shell-by-shell reload to fire
      this.setState('ready', 0);
    }

    this.animate(dt);
  }

  // ------------------------------------------------------------------ firing

  private fireOnce() {
    const d = this.def;
    const inv = this.game.inventory;
    if ((inv.mags[d.id] ?? 0) <= 0) {
      this.burstLeft = 0;
      return;
    }
    inv.mags[d.id] = (inv.mags[d.id] ?? 0) - 1;
    this.cooldown = 60 / d.rpm;
    if (this.burstLeft > 0) {
      this.burstLeft--;
      if (this.burstLeft === 0) this.cooldown += 0.18;
    }
    const p = this.game.player;
    const cam = this.game.camera;
    const spread = this.spreadDeg;

    const origin = cam.getWorldPosition(new THREE.Vector3());
    const fwd = cam.getWorldDirection(new THREE.Vector3());
    const right = tmpV.set(1, 0, 0).applyQuaternion(cam.quaternion).clone();
    const up = tmpV2.set(0, 1, 0).applyQuaternion(cam.quaternion).clone();
    const muzzleWorld = origin.clone().addScaledVector(right, 0.14 * (1 - this.ads)).addScaledVector(up, -0.1 + 0.05 * this.ads).addScaledVector(fwd, 0.7);

    let anyHit = false;
    let kill = false;
    let head = false;
    for (let i = 0; i < d.pellets; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * Math.tan(spread * DEG);
      const dir = fwd.clone().addScaledVector(right, Math.cos(a) * r).addScaledVector(up, Math.sin(a) * r).normalize();
      const res = this.traceShot(origin, dir, muzzleWorld, d, i === 0);
      anyHit ||= res.hit;
      kill ||= res.kill;
      head ||= res.head;
    }
    if (anyHit) this.game.hud.hitmarker(kill ? 'kill' : head ? 'head' : 'hit');
    this.game.stats.shots++;
    if (anyHit) this.game.stats.hits++;

    // feedback
    audio.gunshot(d.sound as 'pistol', undefined);
    this.game.makeNoise(p.pos, d.noise);
    const recoilScale = (1 - this.ads * 0.35) * (p.crouching ? 0.85 : 1);
    p.addRecoil(d.recoil.pitch * recoilScale * rand(0.85, 1.15), d.recoil.yaw * rand(-1, 1) * recoilScale);
    p.shake(d.recoil.kick * 0.8);
    this.kick.impulse(d.recoil.kick * 14);
    this.kickRot.impulse(d.recoil.pitch * 0.9);
    this.bloom = Math.min(this.bloom + d.recoil.pitch * 0.35, 6);
    if (this.vm.slide) this.slideSpring.impulse(-1.6);
    if (this.vm.pump) this.pumpT = 0;
    this.flashT = 0.05;
    if (this.vm.flash) {
      this.vm.flash.rotation.z = rand(0, Math.PI * 2);
      this.vm.flash.scale.setScalar(rand(0.8, 1.25));
    }
    this.game.effects.flash(muzzleWorld, '#ffb36b', d.sound === 'shotgun' ? 70 : 40, 0.06);
    this.game.effects.muzzleSmoke(muzzleWorld, fwd);
    if (d.id === 'pistol' && this.mag === 0) this.slideSpring.value = -0.03;
    if (this.mag === 0 && this.reserve > 0) setTimeout(() => this.state === 'ready' && this.mag === 0 && this.startReload(), 250);
  }

  private traceShot(origin: THREE.Vector3, dir: THREE.Vector3, muzzle: THREE.Vector3, d: WeaponDef, tracer: boolean) {
    const g = this.game;
    ray.set(origin, dir);
    ray.far = 150;
    const targets: THREE.Object3D[] = [...g.level!.hitMeshes];
    for (const inf of g.infected) {
      if (!inf.alive) continue;
      // cheap reject before testing body parts
      tmpV.copy(inf.pos).setY(inf.height * 0.5).sub(origin);
      const along = tmpV.dot(dir);
      if (along < 0) continue;
      const perp = tmpV.addScaledVector(dir, -along).length();
      if (perp > 1.6 * inf.scale) continue;
      for (const m of inf.rig.hitMeshes) targets.push(m);
    }
    const hits = ray.intersectObjects(targets, false);
    let damage = d.damage;
    let penetrations = d.id === 'dmr' ? 1 : 0;
    const result = { hit: false, kill: false, head: false };
    let end = origin.clone().addScaledVector(dir, 80);
    const struck = new Set<Infected>();
    for (const h of hits) {
      if (!h.object.visible) continue;
      const owner = h.object.userData.owner as Infected | undefined;
      if (owner) {
        if (struck.has(owner) || !owner.alive) continue;
        struck.add(owner);
        const zone = h.object.userData.zone as Zone;
        const dist = h.distance;
        const fall = dist <= d.range ? 1 : Math.max(0.5, 1 - ((dist - d.range) / d.range) * 0.5);
        const r = owner.damage(damage * fall, zone, dir, d.stagger, g.infCtx, { headMul: d.headMul, limbMul: d.limbMul });
        g.effects.bloodHit(h.point, dir.clone().multiplyScalar(-0.4).add(dir), zone === 'head' ? 1.4 : 1);
        audio.impactFlesh(h.point, zone === 'head');
        this.splatterBehind(h.point, dir);
        result.hit = true;
        if (zone === 'head') result.head = true;
        if (r.killed) {
          result.kill = true;
          g.onKill(owner, zone === 'head', d.id);
        }
        if (penetrations-- > 0) {
          damage *= 0.6;
          continue;
        }
        end = h.point;
        break;
      }
      // world hit
      const n = h.face ? h.face.normal.clone().transformDirection(h.object.matrixWorld) : dir.clone().negate();
      const metal = h.object.userData.surface === 'prop' || !h.object.userData.surface;
      g.effects.bulletHole(h.point, n);
      g.effects.impactSurface(h.point, n, metal);
      audio.impactSurface(h.point, metal && Math.random() < 0.5);
      end = h.point;
      break;
    }
    if (tracer && (d.sound === 'rifle' || d.sound === 'smg' || d.sound === 'dmr') && Math.random() < 0.6) g.effects.tracer(muzzle, end);
    return result;
  }

  private splatterBehind(p: THREE.Vector3, dir: THREE.Vector3) {
    const g = this.game;
    ray.set(p, dir);
    ray.far = 2.8;
    const h = ray.intersectObjects(g.level!.hitMeshes, false)[0];
    if (h && h.face) {
      const n = h.face.normal.clone().transformDirection(h.object.matrixWorld);
      g.effects.bloodSplat(h.point, n, rand(0.4, 0.9));
    } else if (Math.random() < 0.5) {
      g.effects.bloodSplat(new THREE.Vector3(p.x + dir.x * rand(0.3, 1.2), 0.01, p.z + dir.z * rand(0.3, 1.2)), new THREE.Vector3(0, 1, 0), rand(0.3, 0.7));
    }
  }

  // ------------------------------------------------------------------ reload

  startReload() {
    const d = this.def;
    if (!d.ammo || this.state !== 'ready') return;
    if (this.mag >= d.mag || this.reserve <= 0) return;
    this.reloadFromEmpty = this.mag === 0;
    this.reloadGiven = false;
    this.burstLeft = 0;
    if (d.perShell) {
      this.setState('reload', Infinity);
      this.shellTimer = 0.35 + d.reloadTime;
    } else {
      this.setState('reload', this.reloadFromEmpty ? d.reloadEmptyTime : d.reloadTime);
      setTimeout(() => this.state === 'reload' && audio.mech('magOut'), 180);
    }
  }

  private updateReload(dt: number, enabled: boolean) {
    const d = this.def;
    const inv = this.game.inventory;
    if (!enabled || this.game.player.sprinting) {
      // sprinting cancels an unfinished reload
      if (!this.reloadGiven && !d.perShell) {
        this.setState('ready', 0);
        return;
      }
    }
    if (d.perShell) {
      this.shellTimer -= dt;
      if (this.shellTimer <= 0) {
        if ((inv.mags[d.id] ?? 0) < d.mag && inv.ammo[d.ammo!] > 0) {
          inv.mags[d.id] = (inv.mags[d.id] ?? 0) + 1;
          inv.ammo[d.ammo!]--;
          audio.mech('shell');
          this.shellTimer = d.reloadTime;
          this.game.hud.weaponChanged();
        }
        if ((inv.mags[d.id] ?? 0) >= d.mag || inv.ammo[d.ammo!] <= 0) {
          if (this.reloadFromEmpty) {
            this.pumpT = 0;
            audio.mech('pump');
          }
          this.setState('equip', 0.3);
        }
      }
      return;
    }
    const p = this.stateT / this.stateDur;
    if (!this.reloadGiven && p >= 0.72) {
      this.reloadGiven = true;
      audio.mech('magIn');
      const need = d.mag - (inv.mags[d.id] ?? 0);
      const take = Math.min(need, inv.ammo[d.ammo!]);
      inv.mags[d.id] = (inv.mags[d.id] ?? 0) + take;
      inv.ammo[d.ammo!] -= take;
      this.game.hud.weaponChanged();
      if (this.reloadFromEmpty) setTimeout(() => audio.mech('bolt'), 220);
    }
    if (p >= 1) this.setState('ready', 0);
  }

  // ------------------------------------------------------------------ melee

  private startMelee(kind: 'axe' | 'bash') {
    this.meleeKind = kind;
    this.meleeHitDone = false;
    const d = WEAPONS.axe.melee!;
    this.setState('melee', kind === 'axe' ? d.windup + 0.12 + d.recovery : 0.55);
    audio.swing();
    this.game.makeNoise(this.game.player.pos, 4);
  }

  private updateMelee() {
    const axe = this.meleeKind === 'axe';
    const hitAt = axe ? WEAPONS.axe.melee!.windup : 0.12;
    if (!this.meleeHitDone && this.stateT >= hitAt) {
      this.meleeHitDone = true;
      this.meleeStrike(axe ? WEAPONS.axe.damage : 22, axe ? 2.4 : 1.9, axe ? 0.9 : 0.8);
    }
    if (this.stateT >= this.stateDur) this.setState('ready', 0);
  }

  private meleeStrike(damage: number, range: number, stagger: number) {
    const g = this.game;
    const cam = g.camera;
    const origin = cam.getWorldPosition(new THREE.Vector3());
    const fwd = cam.getWorldDirection(new THREE.Vector3());
    let best: Infected | null = null;
    let bestScore = Infinity;
    for (const inf of g.infected) {
      if (!inf.alive) continue;
      tmpV.set(inf.pos.x - origin.x, 0, inf.pos.z - origin.z);
      const dist = tmpV.length() - inf.radius;
      if (dist > range) continue;
      tmpV.normalize();
      const flat = tmpV2.set(fwd.x, 0, fwd.z).normalize();
      const dot = tmpV.dot(flat);
      if (dot < 0.55) continue;
      const score = dist - dot;
      if (score < bestScore) {
        bestScore = score;
        best = inf;
      }
    }
    if (best) {
      // aim decides head or body
      ray.set(origin, fwd);
      ray.far = range + 1;
      const h = ray.intersectObjects(best.rig.hitMeshes, false)[0];
      const zone: Zone = h?.object.userData.zone === 'head' ? 'head' : 'body';
      const dir = new THREE.Vector3(best.pos.x - origin.x, 0, best.pos.z - origin.z).normalize();
      const r = best.damage(damage, zone, dir, stagger, g.infCtx, { headMul: 1.6, limbMul: 0.9 });
      const p = h?.point ?? best.pos.clone().setY(1.3 * best.scale);
      g.effects.bloodHit(p, dir, 1.6);
      audio.impactFlesh(p, true);
      this.splatterBehind(p, dir);
      g.player.shake(0.25);
      g.hud.hitmarker(r.killed ? 'kill' : zone === 'head' ? 'head' : 'hit');
      if (r.killed) g.onKill(best, zone === 'head', 'axe');
      return;
    }
    // hit a wall?
    ray.set(origin, fwd);
    ray.far = range;
    const h = ray.intersectObjects(g.level!.hitMeshes, false)[0];
    if (h && h.face) {
      const n = h.face.normal.clone().transformDirection(h.object.matrixWorld);
      g.effects.impactSurface(h.point, n, true);
      audio.impactSurface(h.point, true);
      g.player.shake(0.15);
    }
  }

  // ------------------------------------------------------------------ animation

  setLighting(level01: number) {
    this.hemi.intensity = 0.65 + level01 * 0.9;
    this.key.intensity = 0.8 + level01 * 1.2;
  }

  private animate(dt: number) {
    const vm = this.vm;
    const p = this.game.player;
    const input = this.game.input;
    const t = this.time;

    // look sway lags behind the camera
    this.swayX = damp(this.swayX, clamp(-input.dx * 0.00025, -0.03, 0.03), 10, dt);
    this.swayY = damp(this.swayY, clamp(input.dy * 0.00025, -0.03, 0.03), 10, dt);
    this.sprint = damp(this.sprint, p.sprinting ? 1 : 0, 9, dt);
    const lowered = this.state === 'lowered' ? 1 : 0;
    this.lowerAmount = damp(this.lowerAmount, lowered, 10, dt);

    const ads = smoothstep(0, 1, this.ads);
    const pos = vm.hip.clone().lerp(vm.ads, ads);
    const rot = new THREE.Euler(0, 0, 0);

    // breathing + bob
    const bobK = (1 - ads * 0.85);
    const ph = p.bobPhase;
    const moveAmt = p.moving ? p.speed01 * 1.6 : 0;
    pos.x += Math.cos(ph * 0.5) * 0.011 * moveAmt * bobK + this.swayX * bobK;
    pos.y += -Math.abs(Math.sin(ph * 0.5)) * 0.012 * moveAmt * bobK + Math.sin(t * 1.6) * 0.0018 * bobK - this.swayY * bobK;
    rot.z += Math.cos(ph * 0.5) * 0.02 * moveAmt * bobK + this.swayX * 2;
    rot.x += this.swayY * 1.5;

    // sprint pose
    pos.x -= 0.04 * this.sprint;
    pos.y -= 0.035 * this.sprint;
    rot.y += 0.65 * this.sprint;
    rot.x -= 0.2 * this.sprint;
    rot.z += 0.25 * this.sprint;

    // recoil springs
    const k = this.kick.update(dt);
    const kr = this.kickRot.update(dt);
    pos.z += k * 0.012 * (1 - ads * 0.4);
    rot.x += kr * 0.018;

    // equip/holster
    let e = 1;
    if (this.state === 'equip') e = smoothstep(0, 1, this.stateT / Math.max(0.01, this.stateDur));
    if (this.state === 'holster') e = 1 - smoothstep(0, 1, this.stateT / this.stateDur);
    pos.y -= (1 - e) * 0.28;
    rot.x -= (1 - e) * 0.9;
    pos.y -= this.lowerAmount * 0.3;
    rot.x -= this.lowerAmount * 0.6;

    // reload
    if (vm.mag) vm.mag.position.y = 0;
    if (this.state === 'reload') {
      const d = this.def;
      if (d.perShell) {
        const env = smoothstep(0, 0.25, this.stateT);
        rot.z += 0.55 * env;
        rot.x += 0.18 * env;
        pos.y -= 0.02 * env;
        const cyc = 1 - clamp(this.shellTimer / d.reloadTime, 0, 1);
        rot.x += Math.sin(cyc * Math.PI) * 0.06;
      } else {
        const q = this.stateT / this.stateDur;
        const env = smoothstep(0, 0.15, q) * (1 - smoothstep(0.82, 1, q));
        rot.z += 0.6 * env;
        rot.x += 0.25 * env;
        pos.x -= 0.02 * env;
        if (vm.mag) {
          const out = smoothstep(0.15, 0.35, q) * (1 - smoothstep(0.55, 0.72, q));
          vm.mag.position.y = -0.35 * out;
        }
        if (this.reloadFromEmpty && q > 0.82) rot.x -= Math.sin(((q - 0.82) / 0.18) * Math.PI) * 0.12;
      }
    }

    // melee
    if (this.state === 'melee') {
      const q = this.stateT / this.stateDur;
      if (this.meleeKind === 'axe') {
        const wind = WEAPONS.axe.melee!.windup / this.stateDur;
        const strike = (WEAPONS.axe.melee!.windup + 0.12) / this.stateDur;
        if (q < wind) {
          const w = smoothstep(0, 1, q / wind);
          rot.z -= 0.7 * w;
          rot.x += 0.7 * w;
          pos.x += 0.08 * w;
          pos.y += 0.12 * w;
        } else if (q < strike) {
          const s = (q - wind) / (strike - wind);
          rot.z -= 0.7 - 1.9 * s;
          rot.x += 0.7 - 2.0 * s;
          pos.x += 0.08 - 0.3 * s;
          pos.y += 0.12 - 0.22 * s;
        } else {
          const r = smoothstep(0, 1, (q - strike) / (1 - strike));
          rot.z += 1.2 * (1 - r);
          rot.x -= 1.3 * (1 - r);
          pos.x -= 0.22 * (1 - r);
          pos.y -= 0.1 * (1 - r);
        }
      } else {
        const s = Math.sin(clamp(q / 0.6, 0, 1) * Math.PI);
        pos.z -= 0.12 * s;
        pos.x -= 0.06 * s;
        rot.y += 0.5 * s;
        rot.z += 0.6 * s;
      }
    }

    vm.root.position.copy(pos);
    vm.root.rotation.copy(rot);

    // moving parts
    if (vm.slide) vm.slide.position.z = clamp(this.slideSpring.update(dt) * 0.02, -0.035, 0);
    if (vm.pump) {
      this.pumpT = Math.min(1, this.pumpT + dt / 0.38);
      const pk = this.pumpT < 1 ? Math.sin(smoothstep(0.25, 1, this.pumpT) * Math.PI) : 0;
      vm.pump.position.z = 0.08 * pk;
      if (this.pumpT > 0.3 && this.pumpT - dt / 0.38 <= 0.3) audio.mech('pump');
    }
    if (vm.flash) vm.flash.visible = this.flashT > 0;
    this.flashLight.intensity = this.flashT > 0 ? 6 : 0;

    // hide model through the scope
    vm.root.visible = !this.scoped;
  }

  /** FOV multiplier for the world camera from ADS. */
  get zoom() {
    return 1 + (this.def.adsZoom - 1) * smoothstep(0, 1, this.ads);
  }
}
