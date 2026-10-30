import * as THREE from 'three';
import { AMMO, ITEMS, type AmmoId, type ItemId } from '../data/items';
import { WEAPONS, type WeaponId } from '../data/weapons';
import { audio } from '../core/audio';
import { pick, rand, randInt, weightedPick } from '../core/math';
import { disposeTree, materials } from '../world/materials';
import { buildWorldWeapon } from './viewmodels';
import type { Infected } from './infected';
import type { Game } from './game';
import type { Door, Terminal } from '../world/level';

export interface Prompt {
  verb: string;
  amount?: string;
  hold?: number;
  disabled?: string;
}

interface Interactable {
  kind: 'pickup' | 'weapon' | 'key' | 'terminal' | 'door' | 'exit' | 'station' | 'synth' | 'corpse';
  pos: THREE.Vector3;
  range: number;
  prompt(): Prompt | null;
  act(): void;
  mesh?: THREE.Object3D;
  gone?: boolean;
  keyItem?: ItemId;
}

type Grant = { item?: ItemId; ammo?: AmmoId; qty: number };

const ray = new THREE.Raycaster();

/**
 * Everything the player can press E on: loot, weapons, key items, terminals, doors, the exit, lab
 * stations, the synthesiser, and infected corpses that can be harvested.
 */
export class Interactions {
  readonly group = new THREE.Group();
  private list: Interactable[] = [];
  focus: Interactable | null = null;
  holdT = 0;
  private holding = false;

  constructor(private game: Game) {}

  get holdProgress() {
    const p = this.focus?.prompt();
    return p?.hold ? Math.min(1, this.holdT / p.hold) : 0;
  }

  keyItemPos(item: string): THREE.Vector3 | null {
    const k = this.list.find((i) => i.kind === 'key' && !i.gone && i.keyItem === item);
    return k ? k.pos : null;
  }

  clear() {
    this.list = [];
    disposeTree(this.group);
    this.group.clear();
    this.focus = null;
  }

  build() {
    const g = this.game;
    const L = g.level!;
    this.clear();

    for (const l of L.loot) this.addLoot(l.ch, l.pos);

    for (const mk of L.marks) {
      const pos = new THREE.Vector3(mk.x * 2 + 1, 0, mk.y * 2 + 1);
      if (mk.kind === 'weapon') this.addWeapon(mk.weapon, pos);
      if (mk.kind === 'key') this.addKey(mk.item, mk.qty, mk.label, pos);
    }
    for (const t of L.terminals) this.addTerminal(t);
    for (const d of L.doors) this.addDoor(d);
    if (L.exit) {
      const ex = L.exit;
      this.list.push({
        kind: 'exit',
        pos: ex.pos.clone().setY(1.4),
        range: 2.6,
        prompt: () => {
          const def = L.def;
          if (!def.exitLabel) return null;
          const ready = !def.exitFlag || g.objectives.flags.has(def.exitFlag);
          const isObjective = g.objectives.current?.complete === 'exit';
          if (!ready || !isObjective) return { verb: def.exitLabel, disabled: ready ? 'Not yet' : def.exitLockedText };
          return { verb: def.exitLabel, hold: 0.8 };
        },
        act: () => g.objectives.emit('exit'),
      });
    }
    for (const s of L.stations) {
      if (s.kind === 'lab') {
        this.list.push({
          kind: 'station',
          pos: s.pos.clone().setY(1.1),
          range: 2.4,
          prompt: () => ({ verb: 'Use lab station' }),
          act: () => g.openCrafting('lab'),
        });
      } else {
        this.list.push({
          kind: 'synth',
          pos: s.pos.clone().setY(1.3),
          range: 2.8,
          prompt: () => {
            if (g.director.synthesis) return { verb: 'Synthesis running', disabled: `${Math.round((g.director.synthesis.t / g.director.synthesis.dur) * 100)}%` };
            if (g.objectives.completedAll) return { verb: 'Cure synthesised', disabled: 'Complete' };
            if (g.objectives.current?.complete !== 'synth') {
              if (g.objectives.current?.complete === 'components') return { verb: 'Load the synthesiser', disabled: `Missing: ${g.objectives.missingComponents().join(', ')}` };
              return { verb: 'Synthesiser', disabled: 'Offline' };
            }
            return { verb: 'Load the synthesiser', hold: 2 };
          },
          act: () => g.beginSynthesis(),
        });
      }
    }
  }

  // ------------------------------------------------------------------ builders

  private addLoot(ch: string, pos: THREE.Vector3) {
    const g = this.game;
    const loot = g.difficulty.loot;
    const grants: Grant[] = [];
    let label = '';
    let mesh: THREE.Object3D;
    const M = materials();
    if (ch === '1') {
      // ammo, weighted towards guns the player owns or will find soon
      const owned = [...g.inventory.weapons].map((w) => WEAPONS[w].ammo).filter(Boolean) as AmmoId[];
      const future = (g.level!.marks.filter((m) => m.kind === 'weapon') as { weapon: WeaponId }[]).map((m) => WEAPONS[m.weapon].ammo).filter(Boolean) as AmmoId[];
      const pool = [...owned, ...owned, ...future];
      const type: AmmoId = pool.length ? pick(pool) : '9mm';
      const amt = { '9mm': [12, 22], '556': [18, 32], '12ga': [4, 8], '762': [5, 9] }[type];
      grants.push({ ammo: type, qty: Math.round(randInt(amt[0], amt[1]) * loot) });
      label = AMMO[type].name;
      mesh = this.box(0.28, 0.16, 0.14, new THREE.MeshStandardMaterial({ color: '#3c4a33', roughness: 0.6, metalness: 0.4, emissive: '#1a2014', emissiveIntensity: 0.4 }));
    } else if (ch === '2') {
      const r = weightedPick<Grant[]>([
        [[{ item: 'bandage', qty: 1 }], 4],
        [[{ item: 'cloth', qty: 2 }, { item: 'antiseptic', qty: 1 }], 3],
        [[{ item: 'medkit', qty: 1 }], 1.5 * loot],
        [[{ item: 'antiviral', qty: 1 }], 1.2 * loot],
      ]);
      grants.push(...r);
      label = r.length > 1 ? 'Medical supplies' : ITEMS[r[0].item!].name;
      mesh = this.box(0.3, 0.12, 0.22, new THREE.MeshStandardMaterial({ color: '#d8dcd6', roughness: 0.5, emissive: '#2a2a2a', emissiveIntensity: 0.3 }));
      const cross = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.005, 0.03), M.emergency);
      cross.position.y = 0.065;
      mesh.add(cross, cross.clone().rotateY(Math.PI / 2));
    } else if (ch === '3') {
      const style = g.level!.surfaceAt(pos.x, pos.z);
      const pool: [ItemId, number][] =
        style === 'concrete' ? [['scrap', 4], ['chemicals', 3], ['cloth', 1], ['antiseptic', 1]] : [['cloth', 3], ['antiseptic', 3], ['chemicals', 1.5], ['scrap', 1.5]];
      const a = weightedPick(pool);
      let b = weightedPick(pool);
      if (b === a) b = weightedPick(pool);
      grants.push({ item: a, qty: Math.max(1, Math.round(randInt(1, 2) * loot)) });
      if (b !== a) grants.push({ item: b, qty: 1 });
      label = grants.map((x) => ITEMS[x.item!].name).join(', ');
      mesh = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 10), new THREE.MeshStandardMaterial({ color: '#6b6150', roughness: 0.95, emissive: '#1a1810', emissiveIntensity: 0.4 }));
      mesh.scale.set(1, 0.6, 0.8);
      mesh.position.y = 0.1;
    } else {
      const item: ItemId = Math.random() < 0.55 ? 'reagent' : 'vial';
      grants.push({ item, qty: Math.max(1, Math.round(randInt(1, 2) * loot)) });
      if (Math.random() < 0.4) grants.push({ item: item === 'reagent' ? 'vial' : 'reagent', qty: 1 });
      label = grants.map((x) => ITEMS[x.item!].name).join(', ');
      const rack = this.box(0.26, 0.05, 0.1, M.paintedWhite);
      for (let i = 0; i < 4; i++) {
        const v = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.1, 8), M.violetGlow);
        v.position.set(-0.09 + i * 0.06, 0.06, 0);
        rack.add(v);
      }
      mesh = rack;
    }
    mesh.position.add(pos);
    mesh.rotation.y = rand(0, Math.PI * 2);
    this.group.add(mesh);
    const it: Interactable = {
      kind: 'pickup',
      pos: pos.clone().setY(0.25),
      range: 2.1,
      mesh,
      prompt: () => ({ verb: `Take ${label}`, amount: grants.length === 1 && grants[0].qty > 1 ? `×${grants[0].qty}` : undefined }),
      act: () => {
        let took = false;
        for (const gr of grants) {
          if (gr.qty <= 0) continue;
          const n = gr.ammo ? g.inventory.addAmmo(gr.ammo, gr.qty) : g.inventory.add(gr.item!, gr.qty);
          if (n > 0) {
            took = true;
            g.hud.pickup(gr.ammo ? 'i-ammo' : ITEMS[gr.item!].icon, gr.ammo ? AMMO[gr.ammo].name : ITEMS[gr.item!].name, n);
            gr.qty -= n;
          }
        }
        if (!took) {
          g.hud.toast('Can\'t carry any more', 'neutral');
          audio.ui('deny');
          return;
        }
        audio.ui('pickup');
        if (grants.every((x) => x.qty <= 0)) this.remove(it);
      },
    };
    this.list.push(it);
  }

  private addWeapon(id: WeaponId, pos: THREE.Vector3) {
    const g = this.game;
    const mesh = buildWorldWeapon(id);
    mesh.position.copy(pos).setY(0.05);
    mesh.rotation.set(0, rand(0, Math.PI * 2), Math.PI / 2);
    this.group.add(mesh);
    const d = WEAPONS[id];
    const it: Interactable = {
      kind: 'weapon',
      pos: pos.clone().setY(0.2),
      range: 2.2,
      mesh,
      prompt: () => ({ verb: g.inventory.weapons.has(id) ? `Take ${d.ammo ? AMMO[d.ammo].name : d.name}` : `Take ${d.name.replace(/(\w)(\w*)/g, (_m, a: string, b: string) => a + b.toLowerCase())}` }),
      act: () => {
        const isNew = g.inventory.giveWeapon(id);
        if (d.ammo) g.inventory.addAmmo(d.ammo, d.mag * 2);
        g.hud.pickup(d.icon, d.name, 1, true);
        audio.mech('equip');
        if (isNew) g.weapons.select(id);
        g.objectives.emit(`weapon:${id}`);
        this.remove(it);
      },
    };
    this.list.push(it);
  }

  private addKey(item: ItemId, qty: number, label: string, pos: THREE.Vector3) {
    const g = this.game;
    const M = materials();
    const mesh = item === 'keycard' ? this.box(0.09, 0.005, 0.055, new THREE.MeshStandardMaterial({ color: '#e0e4e0', emissive: '#4fd0a8', emissiveIntensity: 0.6 })) : this.box(0.16, 0.1, 0.1, M.paintedWhite);
    if (item !== 'keycard') {
      for (let i = 0; i < 3; i++) {
        const b = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.07, 8), new THREE.MeshStandardMaterial({ color: '#d0a040', emissive: '#a07020', emissiveIntensity: 0.5 }));
        b.position.set(-0.05 + i * 0.05, 0.08, 0);
        mesh.add(b);
      }
    }
    mesh.position.add(pos);
    this.group.add(mesh);
    const it: Interactable = {
      kind: 'key',
      keyItem: item,
      pos: pos.clone().setY(0.2),
      range: 2.2,
      mesh,
      prompt: () => ({ verb: `Take ${label.toLowerCase()}`, amount: qty > 1 ? `×${qty}` : undefined }),
      act: () => {
        const n = g.inventory.add(item, qty);
        if (n <= 0 && ITEMS[item].category !== 'key') {
          g.hud.toast('Can\'t carry any more', 'neutral');
          return;
        }
        g.hud.pickup(ITEMS[item].icon, ITEMS[item].name, n, true);
        audio.ui('pickup');
        g.objectives.emit(`pickup:${item}`);
        this.remove(it);
      },
    };
    this.list.push(it);
  }

  private addTerminal(t: Terminal) {
    const g = this.game;
    this.list.push({
      kind: 'terminal',
      pos: t.pos.clone().setY(1.1),
      range: 2.6,
      prompt: () => (t.used ? null : { verb: t.label, hold: t.hold }),
      act: () => {
        t.used = true;
        const lamp = t.build.parts?.lamp as THREE.Mesh | undefined;
        if (lamp) (lamp.material as THREE.MeshStandardMaterial).emissive.set('#4fd08a');
        if (lamp) (lamp.material as THREE.MeshStandardMaterial).color.set('#4fd08a');
        audio.ui('select');
        if (t.id === 'generator') {
          audio.explosion(t.pos.clone().setY(1));
          g.player.shake(0.4);
        }
        g.makeNoise(t.pos, t.id === 'airlock' ? 20 : 60);
        g.objectives.emit(`interact:${t.id}`);
      },
    });
  }

  private addDoor(d: Door) {
    this.list.push({
      kind: 'door',
      pos: d.center.clone().setY(1.2),
      range: 2.4,
      prompt: () => {
        if (d.locked) return { verb: 'Security shutter', disabled: 'Locked' };
        if (d.shutter) return null;
        return { verb: d.target > 0.5 ? 'Close door' : 'Open door' };
      },
      act: () => {
        d.target = d.target > 0.5 ? 0 : 1;
        if (d.target === 1) d.health = 3.5;
        audio.impactSurface(d.center.clone().setY(1.2), true);
        this.game.makeNoise(d.center, 5);
      },
    });
  }

  addCorpse(inf: Infected) {
    if (!inf.loot.length) return;
    const g = this.game;
    const it: Interactable = {
      kind: 'corpse',
      pos: new THREE.Vector3(),
      range: 2.4,
      prompt: () => {
        if (inf.deathTime < 0.9) return null;
        const first = inf.loot[0];
        const more = inf.loot.length > 1 ? ` +${inf.loot.length - 1}` : '';
        return { verb: `Harvest ${ITEMS[first.item].name.toLowerCase()}${more}`, amount: `×${first.qty}`, hold: 0.7 };
      },
      act: () => {
        let any = false;
        for (const l of inf.loot) {
          const n = g.inventory.add(l.item, l.qty);
          if (n > 0) {
            any = true;
            g.hud.pickup(ITEMS[l.item].icon, ITEMS[l.item].name, n);
          }
          l.qty -= n;
        }
        inf.loot = inf.loot.filter((l) => l.qty > 0);
        if (!any) {
          g.hud.toast('Can\'t carry any more', 'neutral');
          audio.ui('deny');
          return;
        }
        audio.impactFlesh(inf.pos);
        g.player.exposure = Math.min(100, g.player.exposure + 0.5 * g.difficulty.exposure);
        if (!inf.loot.length) {
          inf.harvested = true;
          this.remove(it);
        }
      },
    };
    // keep the prompt anchored to the body as it falls
    Object.defineProperty(it, 'pos', { get: () => inf.corpsePoint(new THREE.Vector3()) });
    this.list.push(it);
  }

  private remove(it: Interactable) {
    it.gone = true;
    if (it.mesh) it.mesh.removeFromParent();
    this.list = this.list.filter((x) => x !== it);
    if (this.focus === it) this.focus = null;
  }

  private box(w: number, h: number, d: number, mat: THREE.Material) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.y = h / 2;
    m.castShadow = true;
    return m;
  }

  // ------------------------------------------------------------------ per frame

  update(dt: number, enabled: boolean) {
    const g = this.game;
    const cam = g.camera;
    const eye = cam.getWorldPosition(new THREE.Vector3());
    const fwd = cam.getWorldDirection(new THREE.Vector3());
    let best: Interactable | null = null;
    let bestScore = -Infinity;
    for (const it of this.list) {
      const p = it.pos;
      const to = p.clone().sub(eye);
      const dist = to.length();
      if (dist > it.range + 0.6) continue;
      const flat = Math.hypot(p.x - eye.x, p.z - eye.z);
      if (flat > it.range) continue;
      to.normalize();
      const dot = to.dot(fwd);
      const need = it.kind === 'door' || it.kind === 'exit' ? 0.55 : 0.8;
      if (dot < need) continue;
      const score = dot * 2 - dist * 0.3;
      if (score > bestScore && it.prompt()) {
        bestScore = score;
        best = it;
      }
    }
    // don't offer what's behind a wall
    if (best && best.kind !== 'door') {
      ray.set(eye, best.pos.clone().sub(eye).normalize());
      ray.far = eye.distanceTo(best.pos) - 0.3;
      const blocker = ray.intersectObjects(g.level!.hitMeshes.filter((m) => m.userData.surface === 'wall'), false)[0];
      if (blocker) best = null;
    }
    if (best !== this.focus) {
      this.focus = best;
      this.holdT = 0;
    }

    const input = g.input;
    const pr = this.focus?.prompt();
    if (!enabled || !this.focus || !pr || pr.disabled) {
      if (enabled && pr?.disabled && input.pressed('KeyE')) audio.ui('deny');
      this.holdT = 0;
      this.holding = false;
      return;
    }
    if (pr.hold) {
      if (input.down('KeyE')) {
        if (!this.holding && input.pressed('KeyE')) this.holding = true;
        if (this.holding) {
          this.holdT += dt;
          if (this.holdT >= pr.hold) {
            this.holdT = 0;
            this.holding = false;
            this.focus.act();
          }
        }
      } else {
        this.holdT = Math.max(0, this.holdT - dt * 3);
        this.holding = false;
      }
    } else if (input.pressed('KeyE')) {
      this.focus.act();
    }
  }
}
