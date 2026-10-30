import * as THREE from 'three';
import { Renderer } from '../core/renderer';
import { Input } from '../core/input';
import { audio } from '../core/audio';
import { DIFFICULTY, loadSettings, saveSettings, type Settings } from '../core/settings';
import { clamp, damp, rand, smoothstep } from '../core/math';
import { LEVELS, STARTING_LOADOUT } from '../data/levels';
import { CURE_COMPONENTS, TOOL_ORDER, type ItemId } from '../data/items';
import { WHEEL_ORDER, type WeaponId } from '../data/weapons';
import { waveScaling } from '../data/infected';
import { Level } from '../world/level';
import { Effects } from './effects';
import { Infected, setMutation, type InfectedContext } from './infected';
import { Inventory, type InventorySnapshot } from './inventory';
import { Player } from './player';
import { WeaponSystem } from './weapons';
import { ToolSystem } from './tools';
import { Director } from './director';
import { Objectives } from './objectives';
import { Interactions } from './interactions';
import { Hud } from '../ui/hud';
import { RadialWheel } from '../ui/wheel';
import { CraftingPanel } from '../ui/crafting';
import { Menus } from '../ui/menus';
import { FirstPersonWeapon } from '../ui/fpweapon';

export type GameState = 'title' | 'briefing' | 'playing' | 'paused' | 'dead' | 'victory';

export interface Stats {
  kills: number;
  headshots: number;
  shots: number;
  hits: number;
  time: number;
  crafted: number;
}

interface SaveData {
  version: 1;
  levelIndex: number;
  inventory: InventorySnapshot;
  health: number;
  exposure: number;
  stats: Stats;
}

const SAVE_KEY = 'suka87.save.v1';
const newStats = (): Stats => ({ kills: 0, headshots: 0, shots: 0, hits: 0, time: 0, crafted: 0 });

export class Game {
  readonly renderer: Renderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly input: Input;
  settings: Settings;

  level: Level | null = null;
  levelIndex = 0;
  readonly player = new Player();
  readonly inventory = new Inventory();
  readonly effects = new Effects();
  readonly weapons: WeaponSystem;
  readonly tools: ToolSystem;
  readonly director: Director;
  readonly objectives: Objectives;
  readonly interactions: Interactions;
  infected: Infected[] = [];

  readonly hud: Hud;
  readonly weaponWheel: RadialWheel;
  readonly toolWheel: RadialWheel;
  readonly crafting: CraftingPanel;
  readonly menus: Menus;
  readonly fpWeapon: FirstPersonWeapon;

  state: GameState = 'title';
  time = 0;
  /** in-game clock in minutes */
  clock = 0;
  timeScale = 1;
  stats: Stats = newStats();
  levelStats: Stats = newStats();
  private checkpoint: SaveData | null = null;
  private last = performance.now();
  private flashlight: THREE.SpotLight;
  private flashDir = new THREE.Vector3(0, 0, -1);
  private noiseTimer = 0;
  noiseLevel = 0;
  private room = '';
  private screamHordeCooldown = 0;
  private hints = new Set<string>();
  private preview = false;
  private previewT = 0;
  private qHeldT = 0;

  infCtx: InfectedContext;

  constructor(container: HTMLElement, uiRoot: HTMLElement) {
    this.settings = loadSettings();
    this.renderer = new Renderer(container);
    this.camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.05, 120);
    this.scene.add(this.camera);
    this.scene.background = new THREE.Color('#050808');
    this.scene.fog = new THREE.FogExp2('#050808', 0.038);
    this.scene.add(this.effects.group);
    this.input = new Input(this.renderer.canvas);

    this.flashlight = new THREE.SpotLight('#f2f4ea', 0, 34, 0.48, 0.6, 1.3);
    this.flashlight.shadow.mapSize.set(1024, 1024);
    this.flashlight.shadow.camera.near = 0.2;
    this.flashlight.shadow.camera.far = 34;
    this.flashlight.shadow.bias = -0.0008;
    this.flashlight.shadow.normalBias = 0.02;
    this.scene.add(this.flashlight, this.flashlight.target);

    this.weapons = new WeaponSystem(this);
    this.tools = new ToolSystem(this);
    this.scene.add(this.tools.group);
    this.director = new Director(this);
    this.objectives = new Objectives(this);
    this.interactions = new Interactions(this);
    this.scene.add(this.interactions.group);

    this.infCtx = {
      level: null as unknown as Level,
      effects: this.effects,
      playerPos: this.player.pos,
      playerEye: new THREE.Vector3(),
      playerYaw: 0,
      playerCrouch: false,
      playerFlashlight: true,
      playerAlive: true,
      all: this.infected,
      time: 0,
      scaling: waveScaling(1),
      hpMul: 1,
      dmgMul: 1,
      lure: null,
      cameraPos: this.camera.position,
      spriteMode: this.settings.spriteMode,
      hitPlayer: (inf, dmg, exp, knock) => this.hitPlayer(inf, dmg, exp, knock),
      scream: (inf) => this.onScream(inf),
    };

    this.hud = new Hud(this, uiRoot);
    this.weaponWheel = new RadialWheel(uiRoot, 'weapon');
    this.toolWheel = new RadialWheel(uiRoot, 'tool');
    this.crafting = new CraftingPanel(this, uiRoot);
    this.menus = new Menus(this, uiRoot);
    this.fpWeapon = new FirstPersonWeapon(this, uiRoot);

    this.inventory.onChange(() => {
      this.objectives.inventoryChanged();
      this.hud.inventoryChanged();
      this.crafting.refresh();
    });

    this.input.onLockChange = (locked) => {
      if (!locked && this.state === 'playing' && !this.crafting.open) this.pause();
    };
    this.renderer.canvas.addEventListener('click', () => {
      if (this.state === 'playing' && !this.crafting.open) this.input.requestLock();
    });

    this.applySettings();
    this.showTitle();
    requestAnimationFrame((t) => this.frame(t));
  }

  get difficulty() {
    return DIFFICULTY[this.settings.difficulty];
  }

  get hasSave() {
    try {
      return !!localStorage.getItem(SAVE_KEY);
    } catch {
      return false;
    }
  }

  applySettings() {
    const s = this.settings;
    saveSettings(s);
    this.renderer.configure({ renderScale: s.renderScale, shadows: s.shadows, bloom: s.bloom, grain: s.filmGrain });
    this.flashlight.castShadow = s.shadows;
    audio.volumes = { master: s.masterVolume, sfx: s.sfxVolume, music: s.musicVolume };
    audio.applyVolumes();
    this.infCtx.spriteMode = s.spriteMode;
    this.interactions.setSpriteMode(s.spriteMode);
    this.infCtx.hpMul = this.difficulty.enemyHp;
    this.infCtx.dmgMul = this.difficulty.enemyDmg;
  }

  // ------------------------------------------------------------------ flow

  showTitle() {
    this.state = 'title';
    this.preview = true;
    this.loadLevel(0, true);
    this.menus.showTitle();
    this.hud.setVisible(false);
  }

  newGame() {
    audio.unlock();
    this.stats = newStats();
    const inv = this.inventory;
    inv.items = { ...STARTING_LOADOUT.items };
    inv.ammo = { ...STARTING_LOADOUT.ammo };
    inv.weapons = new Set(STARTING_LOADOUT.weapons);
    inv.mags = {};
    inv.modes = {};
    inv.current = 'axe';
    this.player.reset();
    this.showBriefing(0, null);
  }

  continueGame() {
    audio.unlock();
    const save = this.readSave();
    if (!save) return this.newGame();
    this.applySave(save);
    this.showBriefing(save.levelIndex, null);
  }

  private readSave(): SaveData | null {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      return raw ? (JSON.parse(raw) as SaveData) : null;
    } catch {
      return null;
    }
  }

  private applySave(s: SaveData) {
    this.inventory.restore(s.inventory);
    this.player.reset();
    this.player.health = s.health;
    this.player.exposure = s.exposure;
    this.stats = { ...s.stats };
  }

  private writeCheckpoint(levelIndex: number) {
    this.checkpoint = {
      version: 1,
      levelIndex,
      inventory: this.inventory.snapshot(),
      health: Math.max(60, this.player.health),
      exposure: this.player.exposure,
      stats: { ...this.stats },
    };
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(this.checkpoint));
    } catch {
      /* ignore */
    }
  }

  showBriefing(index: number, prev: Stats | null) {
    this.state = 'briefing';
    this.hud.setVisible(false);
    this.input.exitLock();
    this.menus.showBriefing(LEVELS[index], index, prev);
    this.levelIndex = index;
  }

  /** Called by the briefing screen. */
  startLevel() {
    audio.unlock();
    this.preview = false;
    this.player.health = Math.max(this.player.health, 60);
    this.writeCheckpoint(this.levelIndex);
    this.loadLevel(this.levelIndex, false);
    this.state = 'playing';
    this.menus.hideAll();
    this.hud.setVisible(true);
    this.input.capture = true;
    this.input.requestLock();
    audio.setPaused(false);
  }

  retry() {
    if (!this.checkpoint) this.checkpoint = this.readSave();
    if (this.checkpoint) this.applySave(this.checkpoint);
    this.player.reset();
    if (this.checkpoint) {
      this.player.health = this.checkpoint.health;
      this.player.exposure = this.checkpoint.exposure;
    }
    this.startLevel();
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.weaponWheel.close();
    this.toolWheel.close();
    this.input.capture = false;
    this.menus.showPause();
    audio.setPaused(true);
  }

  resume() {
    if (this.state !== 'paused') return;
    this.state = 'playing';
    this.menus.hideAll();
    this.input.capture = true;
    this.input.requestLock();
    audio.setPaused(false);
  }

  quitToTitle() {
    audio.setPaused(false);
    this.input.exitLock();
    this.input.capture = false;
    this.showTitle();
  }

  private loadLevel(index: number, preview: boolean) {
    if (this.level) {
      this.scene.remove(this.level.group);
      this.level.dispose();
    }
    for (const inf of this.infected) inf.dispose();
    this.infected.length = 0;
    this.effects.clear();
    this.tools.clear();
    this.interactions.clear();

    const def = LEVELS[index];
    const level = new Level(def);
    this.level = level;
    this.levelIndex = index;
    this.scene.add(level.group);
    this.infCtx.level = level;
    this.infCtx.scaling = waveScaling(def.wave);
    setMutation(this.infCtx.scaling.mutation);
    this.clock = def.clock;
    this.levelStats = newStats();
    this.room = '';
    this.player.spawn(level.start, level.startYaw);
    this.player.crouching = false;
    this.player.flashlight = true;
    this.updateExitLamp();

    if (preview) return;
    this.interactions.build();
    this.director.begin();
    this.objectives.begin(def);
    this.weapons.reset(this.inventory.weapons.has(this.inventory.current) ? this.inventory.current : 'axe');
    this.hud.levelChanged(def);
    audio.setAmbience(1);
  }

  private completeLevel() {
    this.input.exitLock();
    this.input.capture = false;
    if (this.levelIndex >= LEVELS.length - 1) {
      this.state = 'victory';
      this.hud.setVisible(false);
      try {
        localStorage.removeItem(SAVE_KEY);
      } catch {
        /* ignore */
      }
      this.menus.showVictory(this.stats);
      return;
    }
    this.showBriefing(this.levelIndex + 1, this.levelStats);
  }

  // ------------------------------------------------------------------ hooks used by systems

  setPower(on: boolean) {
    this.level?.setPowered(on);
    if (on) {
      audio.setAmbience(1);
      this.player.shake(0.2);
    }
  }

  unlockLevel() {
    this.level?.unlockDoors();
    this.updateExitLamp();
  }

  private updateExitLamp() {
    const ex = this.level?.exit;
    if (!ex) return;
    const def = this.level!.def;
    const ok = !def.exitFlag || this.objectives.flags.has(def.exitFlag);
    const m = ex.lamp.material as THREE.MeshStandardMaterial;
    m.color.set(ok ? '#4fd08a' : '#e2442e');
    m.emissive.set(ok ? '#4fd08a' : '#e2442e');
  }

  makeNoise(pos: THREE.Vector3, radius: number) {
    if (pos === this.player.pos || pos.distanceTo(this.player.pos) < 1) this.noiseLevel = Math.max(this.noiseLevel, clamp(radius / 50, 0, 1));
    for (const inf of this.infected) inf.hear(pos, radius, this.infCtx);
  }

  private hitPlayer(inf: Infected, damage: number, exposure: number, knock: number) {
    if (this.tools.using && this.tools.using.item !== 'medkit') this.tools.using = null;
    this.player.damage(damage, inf.pos, exposure * this.difficulty.exposure, knock);
    this.effects.bloodHit(this.player.eye.add(new THREE.Vector3(0, -0.4, 0)), new THREE.Vector3(rand(-1, 1), 0, rand(-1, 1)), 0.6);
    audio.impactFlesh(this.player.pos, damage > 20);
  }

  private onScream(inf: Infected) {
    this.player.shake(0.3);
    for (const o of this.infected) {
      if (o !== inf && o.alive && o.pos.distanceTo(inf.pos) < 40) o.alert(this.infCtx);
    }
    if (this.screamHordeCooldown <= 0) {
      this.screamHordeCooldown = 12;
      this.director.horde(2 + Math.floor(this.level!.def.wave / 2), 6, ['runner', 'runner', 'shambler']);
    }
    this.hud.screamPulse(inf);
    this.hint('scream', 'Screamer\'s calling them in. Put it down fast.');
  }

  onKill(inf: Infected, headshot: boolean, _weapon: WeaponId | 'frag') {
    this.stats.kills++;
    this.levelStats.kills++;
    if (headshot) {
      this.stats.headshots++;
      this.levelStats.headshots++;
    }
    if (inf.kind === 'bloater') {
      const at = inf.pos.clone().setY(1.1);
      audio.rupture(at);
      this.effects.gore(at);
      this.tools.addGas(inf.pos);
      this.makeNoise(at, 25);
      this.hint('bloater', 'Stay out of that mist. It\'s pure Suka 87.');
    }
    if (inf.boss) this.objectives.emit('kill:boss');
    this.interactions.addCorpse(inf);
    if (inf.loot.length && !this.hints.has('harvest')) this.hint('harvest', 'Harvest the body. Tissue samples are what the cure is built from.');
  }

  hint(key: string, text: string) {
    if (this.hints.has(key)) return;
    this.hints.add(key);
    this.hud.subtitle('Voss', text);
  }

  openCrafting(station: 'field' | 'lab') {
    if (this.state !== 'playing') return;
    this.weaponWheel.close();
    this.toolWheel.close();
    this.crafting.show(station);
    this.input.exitLock();
  }

  closeCrafting() {
    this.crafting.hide();
    // swallow the key that closed the panel so it doesn't reopen it this frame
    this.input.endFrame();
    if (this.state === 'playing') this.input.requestLock();
  }

  beginSynthesis() {
    if (!this.objectives.componentsReady()) return;
    for (const c of CURE_COMPONENTS) this.inventory.remove(c);
    this.director.startSynthesis(90);
    this.makeNoise(this.player.pos, 80);
    this.hud.subtitle('Voss', 'Synthesis is running. Ninety seconds. Don\'t let them near it.');
  }

  useTool(item: ItemId) {
    const err = this.tools.use(item);
    if (err) {
      this.hud.toast(err, 'neutral');
      audio.ui('deny');
    }
  }

  // ------------------------------------------------------------------ main loop

  private frame(now: number) {
    requestAnimationFrame((t) => this.frame(t));
    const rawDt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;

    if (this.state === 'playing' || this.state === 'dead') {
      this.update(rawDt);
    } else if (this.state === 'title' && this.preview) {
      this.updatePreview(rawDt);
    }
    if (this.level) {
      const view = this.state === 'playing' || this.state === 'paused' || this.state === 'dead' ? { scene: this.weapons.scene, camera: this.weapons.camera } : undefined;
      this.renderer.render(this.scene, this.camera, this.time, this.player.alive && !this.settings.spriteMode ? view : undefined);
    }
    this.hud.frame(rawDt);
    this.fpWeapon.update();
    this.input.endFrame();
  }

  private updatePreview(dt: number) {
    const L = this.level!;
    this.time += dt;
    this.previewT += dt;
    const t = this.previewT;
    const p = L.start.clone();
    this.camera.position.set(p.x + Math.sin(t * 0.08) * 1.2, 1.55 + Math.sin(t * 0.3) * 0.05, p.z + Math.cos(t * 0.06) * 0.8);
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.set(-0.08 + Math.sin(t * 0.21) * 0.04, L.startYaw + Math.sin(t * 0.1) * 0.6, 0);
    this.updateCameraFov(dt);
    this.updateFlashlight(dt, true);
    L.update(dt, this.time, this.camera.position);
    this.effects.update(dt);
    const fx = this.renderer.fx;
    fx.uDamage.value = 0;
    fx.uLowHealth.value = 0;
    fx.uExposure.value = 0.25;
  }

  private updateCameraFov(dt: number) {
    const aspect = this.renderer.width / this.renderer.height;
    const hfov = (this.settings.fov * Math.PI) / 180;
    const vfov = (2 * Math.atan(Math.tan(hfov / 2) / aspect) * 180) / Math.PI;
    const target = vfov / this.weapons.zoom;
    this.camera.fov = damp(this.camera.fov, target, 18, dt);
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    this.weapons.camera.fov = 52 / (1 + (this.weapons.zoom - 1) * 0.25);
    this.weapons.camera.aspect = aspect;
    this.weapons.camera.updateProjectionMatrix();
    this.effects.setViewScale(this.renderer.height, this.camera.fov);
  }

  private updateFlashlight(dt: number, on: boolean) {
    const cam = this.camera;
    const fwd = cam.getWorldDirection(new THREE.Vector3());
    // the beam lags slightly behind the view, like a light strapped to a chest rig
    this.flashDir.lerp(fwd, 1 - Math.exp(-dt * 14)).normalize();
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
    this.flashlight.position.copy(cam.position).addScaledVector(right, 0.18).add(new THREE.Vector3(0, -0.22, 0));
    this.flashlight.target.position.copy(this.flashlight.position).addScaledVector(this.flashDir, 10);
    const flicker = this.player.exposure > 60 && Math.random() < 0.02 ? 0.3 : 1;
    this.flashlight.intensity = on ? 34 * flicker : 0;
  }

  private update(rawDt: number) {
    const input = this.input;
    const p = this.player;
    const L = this.level!;

    // ---- wheels & menus (time slows while a wheel is open)
    const wheelOpen = this.weaponWheel.isOpen || this.toolWheel.isOpen;
    const craftOpen = this.crafting.open;
    this.timeScale = damp(this.timeScale, wheelOpen ? 0.2 : craftOpen ? 0.35 : 1, 12, rawDt);
    const dt = rawDt * this.timeScale;
    this.time += dt;
    this.clock += dt / 10;
    this.stats.time += rawDt;
    this.levelStats.time += rawDt;

    const canAct = p.alive && !craftOpen;

    if (canAct) {
      // weapon wheel: hold Q (tap = quick swap)
      if (input.pressed('KeyQ')) this.qHeldT = 0;
      if (input.down('KeyQ')) {
        this.qHeldT += rawDt;
        if (this.qHeldT > 0.16 && !this.weaponWheel.isOpen) {
          this.toolWheel.close();
          this.weaponWheel.openWith(this.weaponWheelItems(), WHEEL_ORDER.indexOf(this.inventory.current));
          audio.ui('open');
        }
      }
      if (input.released('KeyQ')) {
        if (this.weaponWheel.isOpen) {
          const id = this.weaponWheel.close() as WeaponId | null;
          audio.ui('close');
          if (id) this.weapons.select(id);
        } else if (this.qHeldT <= 0.16) this.weapons.quickSwap();
      }
      // tool wheel: hold T
      if (input.pressed('KeyT') && !this.weaponWheel.isOpen) {
        this.toolWheel.openWith(this.toolWheelItems(), -1);
        audio.ui('open');
      }
      if (input.released('KeyT') && this.toolWheel.isOpen) {
        const id = this.toolWheel.close() as ItemId | null;
        audio.ui('close');
        if (id) this.useTool(id);
      }
      if (input.pressed('Tab')) this.openCrafting(this.nearLab() ? 'lab' : 'field');
      if (input.pressed('KeyF')) {
        p.flashlight = !p.flashlight;
        audio.mech('mode');
      }
      for (let i = 0; i < 4; i++) if (input.pressed(`Digit${i + 1}`)) this.useTool(TOOL_ORDER[i]);
      if (input.wheel && !wheelOpen) this.weapons.cycle(input.wheel, WHEEL_ORDER);
    }

    // ---- look
    if (wheelOpen) {
      const w = this.weaponWheel.isOpen ? this.weaponWheel : this.toolWheel;
      w.pointer(input.dx, input.dy);
    } else if (p.alive && !craftOpen) {
      const sens = this.settings.sensitivity * (this.weapons.aimingDownSights ? this.settings.adsSensitivity / this.weapons.zoom : 1);
      p.look(input.dx, input.dy, sens, this.settings.invertY);
    }

    // ---- simulation
    p.update(dt, canAct && !wheelOpen ? input : null, L, { canSprint: true, adsSlow: 0.55 });
    p.applyCamera(this.camera, this.time);
    this.updateCameraFov(rawDt);
    this.updateFlashlight(rawDt, p.flashlight && p.alive);
    L.update(dt, this.time, p.pos);
    L.updateFlow(p.pos.x, p.pos.z);

    const room = L.roomAt(p.pos.x, p.pos.z)?.name ?? this.room;
    if (room !== this.room) {
      this.room = room;
      this.hud.roomChanged(room);
      this.objectives.enterRoom(room);
    }

    const ctx = this.infCtx;
    ctx.time = this.time;
    ctx.playerEye.copy(p.eye);
    ctx.playerYaw = p.yaw;
    ctx.playerCrouch = p.crouching;
    ctx.playerFlashlight = p.flashlight;
    ctx.playerAlive = p.alive;
    ctx.lure = this.tools.lure;
    for (const inf of this.infected) inf.update(dt, ctx);
    this.cullCorpses();

    this.director.update(dt);
    this.tools.update(dt);
    this.weapons.update(dt, canAct && !wheelOpen);
    this.interactions.update(dt, canAct && !wheelOpen);
    this.objectives.update(dt);
    this.effects.update(dt);
    this.screamHordeCooldown -= dt;

    // footstep noise
    this.noiseTimer -= dt;
    if (this.noiseTimer <= 0) {
      this.noiseTimer = 0.35;
      const n = p.footNoise;
      if (n > 0) this.makeNoise(p.pos, n);
    }
    this.noiseLevel = Math.max(0, this.noiseLevel - dt * 0.45);
    if (p.moving) this.noiseLevel = Math.max(this.noiseLevel, p.footNoise / 50);

    // synthesiser visuals
    const synth = L.stations.find((s) => s.kind === 'synth');
    if (synth) {
      const liquid = synth.build.parts!.liquid as THREE.Mesh;
      const k = this.director.synthesis ? this.director.synthesis.t / this.director.synthesis.dur : this.objectives.completedAll ? 1 : 0;
      liquid.scale.y = damp(liquid.scale.y, 0.05 + k * 1.45, 2, dt);
      liquid.position.y = 0.55 + liquid.scale.y / 2;
      (liquid.material as THREE.MeshStandardMaterial).emissiveIntensity = 1 + Math.sin(this.time * 4) * 0.4 * (this.director.synthesis ? 1 : 0);
    }
    for (const s of L.stations) {
      const c = s.build.parts?.centrifuge;
      if (c) c.rotation.y += dt * (this.crafting.open && this.crafting.station === 'lab' ? 30 : 0.5);
    }

    // view lighting for the weapon model
    let light = L.powered ? 0.3 : 0.12;
    for (const f of L.fixtures) {
      const d = f.pos.distanceTo(p.pos);
      if (d < 9) light += (1 - d / 9) * f.level * (f.kind === 'emergency' ? 0.25 : 0.55);
    }
    if (p.flashlight) light += 0.15;
    this.weapons.setLighting(clamp(light, 0, 1.2));

    // grade
    const fx = this.renderer.fx;
    fx.uDamage.value = p.damageFlash;
    fx.uLowHealth.value = smoothstep(45, 10, p.health);
    fx.uExposure.value = smoothstep(15, 100, p.exposure);
    fx.uVignette.value = 0.55 + (this.weapons.scoped ? 0.6 : 0);

    // audio
    const fwd = this.camera.getWorldDirection(new THREE.Vector3());
    audio.setListener(this.camera.position, fwd);
    audio.update(dt, p.health / p.maxHealth, this.director.intensity);

    // death / level end
    if (!p.alive && this.state === 'playing') {
      this.state = 'dead';
      this.weaponWheel.close();
      this.toolWheel.close();
      this.crafting.hide();
      setTimeout(() => {
        this.input.exitLock();
        this.input.capture = false;
        this.menus.showDeath(p.causeOfDeath);
      }, 1800);
    }
    if (this.objectives.completedAll && this.state === 'playing') this.completeLevel();
  }

  private cullCorpses() {
    const dead = this.infected.filter((i) => !i.alive);
    if (dead.length <= 28) return;
    const old = dead.sort((a, b) => b.deathTime - a.deathTime).slice(0, dead.length - 28);
    for (const o of old) {
      if (o.loot.length && !o.harvested && o.deathTime < 90) continue;
      o.dispose();
      this.infected.splice(this.infected.indexOf(o), 1);
    }
  }

  private nearLab() {
    return !!this.level?.stations.some((s) => s.kind === 'lab' && s.pos.distanceTo(this.player.pos) < 3.2);
  }

  private weaponWheelItems() {
    return WHEEL_ORDER.map((id) => this.hud.weaponWheelEntry(id));
  }

  private toolWheelItems() {
    return TOOL_ORDER.map((id) => this.hud.toolWheelEntry(id));
  }

  /** Test hook: advance the simulation without rendering (fixed 60 Hz steps). */
  debugStep(seconds: number) {
    const steps = Math.round(seconds * 60);
    audio.silent = true;
    for (let i = 0; i < steps && (this.state === 'playing' || this.state === 'dead'); i++) {
      this.update(1 / 60);
      this.input.endFrame();
    }
    audio.silent = false;
  }

  /** used by the death screen while the camera sinks */
  get fallen() {
    return !this.player.alive;
  }
}
