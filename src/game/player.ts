import * as THREE from 'three';
import type { Input } from '../core/input';
import type { Level } from '../world/level';
import { audio } from '../core/audio';
import { DEG, clamp, damp, rand } from '../core/math';

const EYE_STAND = 1.68;
const EYE_CROUCH = 1.12;
const RADIUS = 0.33;
const GRAVITY = 18;

/**
 * First-person controller: movement, stamina, health, Suka 87 exposure and camera feel (bob,
 * landing dip, recoil and trauma-based shake).
 */
export class Player {
  readonly pos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  private vy = 0;
  onGround = true;
  eyeHeight = EYE_STAND;
  crouching = false;
  sprinting = false;
  aiming = false;
  /** 0..1 movement speed relative to sprint */
  speed01 = 0;
  moving = false;

  health = 100;
  maxHealth = 100;
  exposure = 0;
  stamina = 100;
  private staminaDelay = 0;
  private exhausted = false;
  alive = true;
  causeOfDeath: 'wounds' | 'turned' = 'wounds';

  flashlight = true;
  /** 0..1 movement penalty while using items */
  encumbered = 0;

  // camera feel
  bobPhase = 0;
  private bobAmount = 0;
  private landDip = 0;
  private trauma = 0;
  recoilPitch = 0;
  recoilYaw = 0;
  private stepDist = 0;
  private knock = new THREE.Vector3();
  /** for HUD: last damage direction world yaw + age */
  damageEvents: { yaw: number; t: number }[] = [];
  damageFlash = 0;
  private regenDelay = 0;

  spawn(at: THREE.Vector3, yaw: number) {
    this.pos.copy(at);
    this.vel.set(0, 0, 0);
    this.yaw = yaw;
    this.pitch = 0;
    this.vy = 0;
    this.alive = true;
    this.recoilPitch = this.recoilYaw = 0;
    this.trauma = 0;
    this.damageEvents = [];
  }

  reset() {
    this.health = this.maxHealth;
    this.exposure = 0;
    this.stamina = 100;
    this.crouching = false;
    this.flashlight = true;
  }

  get eye() {
    return new THREE.Vector3(this.pos.x, this.pos.y + this.eyeHeight, this.pos.z);
  }

  get forward() {
    return new THREE.Vector3(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
  }

  look(dx: number, dy: number, sens: number, invertY: boolean) {
    const k = 0.0022 * sens;
    this.yaw -= dx * k;
    this.pitch -= dy * k * (invertY ? -1 : 1);
    this.pitch = clamp(this.pitch, -1.45, 1.45);
  }

  addRecoil(pitchDeg: number, yawDeg: number) {
    // part of the kick is permanent (the player must pull down), the rest recovers
    this.pitch = clamp(this.pitch + pitchDeg * DEG * 0.45, -1.45, 1.45);
    this.yaw += yawDeg * DEG * 0.35;
    this.recoilPitch += pitchDeg * DEG * 0.55;
    this.recoilYaw += yawDeg * DEG * 0.4;
  }

  shake(amount: number) {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  damage(amount: number, from: THREE.Vector3 | null, exposure: number, knockback: number) {
    if (!this.alive) return;
    this.health -= amount;
    this.exposure = Math.min(100, this.exposure + exposure);
    this.damageFlash = Math.min(1, this.damageFlash + 0.4 + amount / 40);
    this.shake(0.25 + amount / 60);
    this.regenDelay = 6;
    if (from) {
      const dx = from.x - this.pos.x;
      const dz = from.z - this.pos.z;
      this.damageEvents.push({ yaw: Math.atan2(-dx, -dz), t: 1.6 });
      if (knockback > 0) {
        const d = Math.hypot(dx, dz) || 1;
        this.knock.set((-dx / d) * knockback, 0, (-dz / d) * knockback);
      }
    }
    audio.playerHurt(amount > 20);
    if (this.health <= 0) {
      this.health = 0;
      this.alive = false;
      this.causeOfDeath = 'wounds';
    }
  }

  update(dt: number, input: Input | null, level: Level, opts: { canSprint: boolean; adsSlow: number }) {
    // ---- Suka 87 exposure: slowly climbs once past stage II, stage IV drains health
    if (this.alive) {
      if (this.exposure > 50) this.exposure = Math.min(100, this.exposure + dt * 0.12 * (this.exposure / 50));
      if (this.exposure >= 75) this.health -= dt * 0.6;
      if (this.exposure >= 100) {
        this.alive = false;
        this.causeOfDeath = 'turned';
      }
      if (this.health <= 0 && this.alive) {
        this.alive = false;
        this.health = 0;
      }
      // a small amount of natural recovery up to 35
      this.regenDelay -= dt;
      if (this.regenDelay <= 0 && this.health < 35) this.health = Math.min(35, this.health + dt * 1.5);
    }

    let wish = new THREE.Vector3();
    let wantSprint = false;
    let jump = false;
    if (input && this.alive) {
      if (input.down('KeyW')) wish.z -= 1;
      if (input.down('KeyS')) wish.z += 1;
      if (input.down('KeyA')) wish.x -= 1;
      if (input.down('KeyD')) wish.x += 1;
      wantSprint = input.down('ShiftLeft') && wish.z < 0;
      if (input.pressed('KeyC') || input.pressed('ControlLeft')) this.crouching = !this.crouching;
      jump = input.pressed('Space');
    }
    if (wish.lengthSq() > 0) wish.normalize();
    // rotate into world space
    const s = Math.sin(this.yaw);
    const c = Math.cos(this.yaw);
    wish = new THREE.Vector3(wish.x * c + wish.z * s, 0, -wish.x * s + wish.z * c);

    // ---- stamina
    this.sprinting = wantSprint && opts.canSprint && !this.exhausted && !this.aiming && wish.lengthSq() > 0 && this.encumbered < 0.5;
    if (this.sprinting) {
      if (this.crouching) this.crouching = false;
      this.stamina -= dt * 16 * (this.exposure >= 50 ? 1.4 : 1);
      this.staminaDelay = 1.1;
      if (this.stamina <= 0) {
        this.stamina = 0;
        this.exhausted = true;
      }
    } else {
      this.staminaDelay -= dt;
      if (this.staminaDelay <= 0) this.stamina = Math.min(100, this.stamina + dt * 15);
      if (this.exhausted && this.stamina > 30) this.exhausted = false;
    }

    let maxSpeed = 3.7;
    if (this.sprinting) maxSpeed = 6.3;
    if (this.crouching) maxSpeed = 1.9;
    if (this.aiming) maxSpeed *= opts.adsSlow;
    if (this.exhausted) maxSpeed *= 0.8;
    maxSpeed *= 1 - this.encumbered * 0.55;

    const target = wish.multiplyScalar(maxSpeed);
    const accel = this.onGround ? (target.lengthSq() > 0 ? 12 : 10) : 2;
    this.vel.x = damp(this.vel.x, target.x, accel, dt);
    this.vel.z = damp(this.vel.z, target.z, accel, dt);

    if (jump && this.onGround && !this.crouching && this.stamina > 10) {
      this.vy = 5.2;
      this.onGround = false;
      this.stamina -= 8;
    }
    this.vy -= GRAVITY * dt;

    // knockback
    this.vel.addScaledVector(this.knock, 1);
    this.knock.multiplyScalar(0);

    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this.pos.y += this.vy * dt;
    if (this.pos.y <= 0) {
      if (!this.onGround && this.vy < -3) {
        this.landDip = Math.min(0.12, -this.vy * 0.012);
        audio.land(-this.vy * 0.2);
      }
      this.pos.y = 0;
      this.vy = 0;
      this.onGround = true;
    }
    level.resolveCircle(this.pos, RADIUS);

    // ---- crouch height
    const targetEye = this.crouching ? EYE_CROUCH : EYE_STAND;
    this.eyeHeight = damp(this.eyeHeight, targetEye, 10, dt);
    if (!this.alive) this.eyeHeight = damp(this.eyeHeight, 0.35, 3, dt);

    // ---- bob + footsteps
    const hs = Math.hypot(this.vel.x, this.vel.z);
    this.speed01 = clamp(hs / 6.3, 0, 1);
    this.moving = hs > 0.4 && this.onGround;
    this.bobAmount = damp(this.bobAmount, this.moving ? clamp(hs / 4, 0, 1.4) : 0, 8, dt);
    this.bobPhase += dt * (this.sprinting ? 12.5 : 8.5) * (this.moving ? 1 : 0.3);
    if (this.moving) {
      this.stepDist += hs * dt;
      const stride = this.sprinting ? 2.1 : this.crouching ? 1.3 : 1.7;
      if (this.stepDist > stride) {
        this.stepDist = 0;
        const surface = level.surfaceAt(this.pos.x, this.pos.z);
        audio.footstep(this.crouching ? 0.4 : this.sprinting ? 1.3 : 0.85, surface === 'tile' ? 'tile' : surface === 'ward' || surface === 'lab' ? 'vinyl' : 'concrete');
      }
    }

    // ---- camera recovery
    this.recoilPitch = damp(this.recoilPitch, 0, 7, dt);
    this.recoilYaw = damp(this.recoilYaw, 0, 7, dt);
    this.landDip = damp(this.landDip, 0, 8, dt);
    this.trauma = Math.max(0, this.trauma - dt * 1.2);
    this.damageFlash = Math.max(0, this.damageFlash - dt * 1.6);
    for (const e of this.damageEvents) e.t -= dt;
    this.damageEvents = this.damageEvents.filter((e) => e.t > 0);
  }

  /** Noise the player makes this frame, as an alert radius in metres. */
  get footNoise() {
    if (!this.moving) return 0;
    if (this.crouching) return 2;
    if (this.sprinting) return 14;
    return 6;
  }

  applyCamera(cam: THREE.PerspectiveCamera, time: number) {
    const bobX = Math.cos(this.bobPhase * 0.5) * 0.035 * this.bobAmount;
    const bobY = Math.abs(Math.sin(this.bobPhase * 0.5)) * 0.045 * this.bobAmount;
    const shake = this.trauma * this.trauma;
    const sx = (Math.sin(time * 37) + Math.sin(time * 23.1)) * 0.5 * shake;
    const sy = (Math.sin(time * 31.7) + Math.sin(time * 19.3)) * 0.5 * shake;
    // exposure stage III+: slow drunken sway
    const ex = Math.max(0, (this.exposure - 50) / 50);
    const sway = Math.sin(time * 0.7) * 0.02 * ex;

    const s = Math.sin(this.yaw);
    const c = Math.cos(this.yaw);
    cam.position.set(this.pos.x + bobX * c, this.pos.y + this.eyeHeight + bobY - this.landDip, this.pos.z - bobX * s);
    cam.rotation.order = 'YXZ';
    cam.rotation.y = this.yaw + this.recoilYaw + sx * 0.03;
    cam.rotation.x = this.pitch + this.recoilPitch + sy * 0.03 + rand(-1, 1) * 0.0005 * ex;
    cam.rotation.z = sx * 0.02 + sway - (this.alive ? 0 : 0.6);
  }
}
