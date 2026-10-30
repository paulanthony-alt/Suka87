import * as THREE from 'three';
import type { InfectedKind } from '../data/infected';
import { pick, rand, weightedPick } from '../core/math';
import { Infected } from './infected';
import type { Game } from './game';

/**
 * Spawning and pacing. Places the hand-authored infected, trickles in reinforcements from vents the
 * player can't see, runs scripted hordes, and drives the final synthesis hold-out.
 */
export class Director {
  private trickleTimer = 30;
  private queue: { at: number; kind: InfectedKind | null }[] = [];
  private clock = 0;
  synthesis: { t: number; dur: number; nextWave: number; brutes: number } | null = null;
  /** 0..1 combat intensity for music */
  intensity = 0;

  constructor(private game: Game) {}

  begin() {
    const g = this.game;
    this.queue = [];
    this.clock = 0;
    this.trickleTimer = 35;
    this.synthesis = null;
    for (const s of g.level!.spawns) {
      const kind: InfectedKind | null =
        s.ch === 'R' ? 'runner' : s.ch === 'B' ? 'bloater' : s.ch === 'C' ? 'screamer' : s.ch === 'U' || s.ch === '0' ? 'brute' : null;
      this.spawn(kind ?? this.pickKind(), s.pos, { boss: s.ch === '0' });
    }
  }

  /** Mix weights, biased towards whatever the cure still needs from wave 4 on. */
  pickKind(kinds?: InfectedKind[]): InfectedKind {
    if (kinds?.length) return pick(kinds);
    const g = this.game;
    const inv = g.inventory;
    const mix = g.level!.def.mix.map(([k, w]) => [k, w] as [InfectedKind, number]);
    if (g.level!.def.wave >= 4) {
      const need = (comp: Parameters<typeof inv.has>[0], drop: Parameters<typeof inv.has>[0], n: number) => !inv.has(comp) && !inv.has(drop, n);
      for (const e of mix) {
        if (e[0] === 'bloater' && need('concentrate', 'plasma', 3)) e[1] *= 2.5;
        if (e[0] === 'screamer' && need('suppressant', 'neural', 2)) e[1] *= 2.5;
        if (e[0] === 'brute' && need('catalyst', 'adrenal', 1)) e[1] *= 3;
      }
    }
    return weightedPick(mix);
  }

  spawn(kind: InfectedKind, pos: THREE.Vector3, opts: { boss?: boolean; alerted?: boolean } = {}) {
    const g = this.game;
    const inf = new Infected(kind, pos, g.infCtx, opts);
    g.infected.push(inf);
    g.scene.add(inf.rig.root, inf.sprite.mesh);
    return inf;
  }

  horde(count: number, over: number, kinds?: InfectedKind[]) {
    for (let i = 0; i < count; i++) {
      this.queue.push({ at: this.clock + (i / Math.max(1, count - 1)) * over + rand(-0.5, 0.5), kind: kinds?.length ? pick(kinds) : null });
    }
  }

  /** A vent out of the player's sight, not too close and not too far. */
  private ventPos(): THREE.Vector3 | null {
    const g = this.game;
    const p = g.player.pos;
    const level = g.level!;
    const vents = level.vents.length ? level.vents : level.spawns.map((s) => s.pos);
    const scored = vents
      .map((v) => {
        const d = v.distanceTo(p);
        const seen = level.lineOfSight(p.x, p.z, v.x, v.z);
        const reach = level.flowDistance(v.x, v.z);
        let score = 0;
        if (d < 10) score -= 100;
        if (seen && d < 25) score -= 50;
        if (reach < 0) score -= 1000;
        score -= Math.abs(d - 22);
        return { v, score };
      })
      .sort((a, b) => b.score - a.score);
    const best = scored[0];
    if (!best || best.score < -500) return null;
    return best.v.clone().add(new THREE.Vector3(rand(-0.4, 0.4), 0, rand(-0.4, 0.4)));
  }

  get aliveCount() {
    return this.game.infected.reduce((n, i) => n + (i.alive ? 1 : 0), 0);
  }

  update(dt: number) {
    const g = this.game;
    this.clock += dt;
    const sc = g.infCtx.scaling;

    // scripted hordes
    while (this.queue.length && this.queue[0].at <= this.clock) {
      this.queue.sort((a, b) => a.at - b.at);
      const e = this.queue.shift()!;
      if (this.aliveCount >= sc.maxAlive + 8) {
        e.at = this.clock + 2;
        this.queue.push(e);
        break;
      }
      const pos = this.ventPos();
      if (pos) this.spawn(e.kind ?? this.pickKind(), pos, { alerted: true });
    }
    this.queue.sort((a, b) => a.at - b.at);

    // ambient trickle
    this.trickleTimer -= dt;
    if (this.trickleTimer <= 0) {
      this.trickleTimer = sc.trickle * rand(0.8, 1.3);
      if (this.aliveCount < sc.maxAlive && !this.synthesis) {
        const pos = this.ventPos();
        if (pos) {
          const inf = this.spawn(this.pickKind(), pos);
          // drift towards where the player is
          inf.investigate(g.player.pos.clone().add(new THREE.Vector3(rand(-6, 6), 0, rand(-6, 6))));
        }
      }
    }

    // final hold-out
    if (this.synthesis) {
      const s = this.synthesis;
      s.t += dt;
      if (s.t >= s.nextWave && this.aliveCount < sc.maxAlive) {
        s.nextWave += 9;
        const n = 2 + Math.floor(s.t / 40);
        this.horde(n, 4);
      }
      if (s.brutes < 2 && s.t > 30 * (s.brutes + 1)) {
        s.brutes++;
        const pos = this.ventPos();
        if (pos) this.spawn('brute', pos, { alerted: true });
      }
      if (s.t >= s.dur) {
        this.synthesis = null;
        g.objectives.emit('synth');
      }
    }

    // intensity for the music bed
    let chasing = 0;
    for (const i of g.infected) if (i.alive && (i.state === 'chase' || i.state === 'attack' || i.state === 'charge')) chasing++;
    this.intensity = Math.min(1, chasing / 5 + (this.synthesis ? 0.4 : 0));
  }

  startSynthesis(seconds: number) {
    this.synthesis = { t: 0, dur: seconds, nextWave: 4, brutes: 0 };
    this.horde(4, 4, ['runner', 'runner', 'shambler']);
  }
}
