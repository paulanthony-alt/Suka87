import * as THREE from 'three';
import type { Action, LevelDef, ObjectiveDef } from '../data/levels';
import { CURE_COMPONENTS, ITEMS } from '../data/items';
import { audio } from '../core/audio';
import type { Game } from './game';

/**
 * Linear objective chain per level. Events that arrive early are remembered, so doing things out of
 * order never soft-locks the run.
 */
export class Objectives {
  index = -1;
  readonly flags = new Set<string>();
  private happened = new Set<string>();
  private queue: { t: number; action: Action }[] = [];
  private entered = new Set<string>();
  private def!: LevelDef;
  completedAll = false;

  constructor(private game: Game) {}

  get current(): ObjectiveDef | null {
    return this.def?.objectives[this.index] ?? null;
  }

  begin(def: LevelDef) {
    this.def = def;
    this.index = -1;
    this.flags.clear();
    this.happened.clear();
    this.queue = [];
    this.entered.clear();
    this.completedAll = false;
    this.advance();
  }

  private advance() {
    this.index++;
    const o = this.current;
    if (!o) {
      this.completedAll = true;
      return;
    }
    this.game.hud.objectiveChanged(o, this.index > 0);
    if (o.onStart) this.run(o.onStart);
    this.check();
  }

  private check() {
    const o = this.current;
    if (!o) return;
    const done = o.complete === 'components' ? this.componentsReady() : this.happened.has(o.complete);
    if (done) {
      if (o.onComplete) this.run(o.onComplete);
      if (this.index < this.def.objectives.length - 1) audio.ui('objective');
      this.advance();
    }
  }

  emit(event: string) {
    this.happened.add(event);
    this.check();
  }

  /** Re-check inventory-driven objectives. */
  inventoryChanged() {
    if (this.current?.complete === 'components') this.check();
  }

  componentsReady() {
    return CURE_COMPONENTS.every((c) => this.game.inventory.has(c));
  }

  missingComponents() {
    return CURE_COMPONENTS.filter((c) => !this.game.inventory.has(c)).map((c) => ITEMS[c].name);
  }

  enterRoom(name: string) {
    if (this.entered.has(name)) return;
    this.entered.add(name);
    const acts = this.def.onEnter?.[name];
    if (acts) this.run(acts);
  }

  run(actions: Action[]) {
    let t = 0;
    for (const a of actions) {
      t += 'delay' in a && a.delay ? a.delay : 0;
      this.queue.push({ t, action: a });
    }
  }

  update(dt: number) {
    for (const q of this.queue) q.t -= dt;
    const due = this.queue.filter((q) => q.t <= 0);
    this.queue = this.queue.filter((q) => q.t > 0);
    for (const q of due) this.execute(q.action);
  }

  private execute(a: Action) {
    const g = this.game;
    if ('say' in a) g.hud.subtitle(a.who ?? '', a.say);
    else if ('horde' in a) g.director.horde(a.horde, a.over, a.kinds);
    else if ('power' in a) g.setPower(a.power);
    else if ('flag' in a) {
      this.flags.add(a.flag);
      if (a.flag === this.def.exitFlag) g.unlockLevel();
    } else if ('synthesis' in a) g.director.startSynthesis(a.synthesis);
  }

  /** Where the compass objective marker points. */
  targetPos(): THREE.Vector3 | null {
    const o = this.current;
    const g = this.game;
    const L = g.level;
    if (!o?.target || !L) return null;
    const tile = (x: number, y: number) => new THREE.Vector3(x * 2 + 1, 0, y * 2 + 1);
    switch (o.target.kind) {
      case 'exit':
        return L.exit?.pos ?? null;
      case 'terminal': {
        const t = L.terminals.find((t) => t.id === o.target!.id);
        return t?.pos ?? null;
      }
      case 'weapon': {
        const m = L.marks.find((m) => m.kind === 'weapon' && m.weapon === o.target!.id);
        return m ? tile(m.x, m.y) : null;
      }
      case 'key': {
        const live = g.interactions.keyItemPos(o.target.id!);
        if (live) return live;
        return null;
      }
      case 'boss': {
        const b = g.infected.find((i) => i.boss && i.alive);
        return b ? b.pos : null;
      }
      case 'station': {
        let best: THREE.Vector3 | null = null;
        let bd = Infinity;
        for (const s of L.stations) {
          if (s.kind !== 'lab') continue;
          const d = s.pos.distanceTo(g.player.pos);
          if (d < bd) {
            bd = d;
            best = s.pos;
          }
        }
        return best;
      }
      case 'synth':
        return L.stations.find((s) => s.kind === 'synth')?.pos ?? null;
    }
    return null;
  }
}
