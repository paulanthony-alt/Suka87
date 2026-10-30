import type { ItemId } from './items';

export type InfectedKind = 'shambler' | 'runner' | 'bloater' | 'screamer' | 'brute';

export interface InfectedDef {
  kind: InfectedKind;
  name: string;
  hint?: string;
  labelColor: 'neutral' | 'danger' | 'warning';
  hp: number;
  walkSpeed: number;
  runSpeed: number;
  damage: number;
  /** % exposure added per landed hit */
  exposure: number;
  attackRange: number;
  attackWindup: number;
  attackCooldown: number;
  sight: number;
  hearing: number;
  radius: number;
  scale: number;
  /** body damage multiplier (armour) */
  bodyArmor: number;
  headMul: number;
  staggerResist: number;
  drops: { item: ItemId; chance: number; min: number; max: number }[];
}

export const INFECTED: Record<InfectedKind, InfectedDef> = {
  shambler: {
    kind: 'shambler', name: 'Shambler', labelColor: 'neutral',
    hp: 100, walkSpeed: 0.9, runSpeed: 2.6, damage: 14, exposure: 4, attackRange: 1.45, attackWindup: 0.55, attackCooldown: 1.3,
    sight: 16, hearing: 1, radius: 0.34, scale: 1, bodyArmor: 1, headMul: 1, staggerResist: 0,
    drops: [{ item: 'tissue', chance: 0.65, min: 1, max: 2 }, { item: 'cloth', chance: 0.25, min: 1, max: 1 }],
  },
  runner: {
    kind: 'runner', name: 'Runner', labelColor: 'neutral',
    hp: 70, walkSpeed: 1.4, runSpeed: 5.6, damage: 10, exposure: 3, attackRange: 1.35, attackWindup: 0.3, attackCooldown: 0.85,
    sight: 22, hearing: 1.3, radius: 0.3, scale: 0.96, bodyArmor: 1, headMul: 1, staggerResist: 0,
    drops: [{ item: 'tissue', chance: 0.6, min: 1, max: 1 }, { item: 'scrap', chance: 0.2, min: 1, max: 1 }],
  },
  bloater: {
    kind: 'bloater', name: 'Bloater', hint: 'Bursts when killed', labelColor: 'danger',
    hp: 260, walkSpeed: 0.75, runSpeed: 1.9, damage: 24, exposure: 8, attackRange: 1.7, attackWindup: 0.8, attackCooldown: 1.8,
    sight: 14, hearing: 0.9, radius: 0.55, scale: 1.12, bodyArmor: 0.85, headMul: 1, staggerResist: 0.6,
    drops: [{ item: 'plasma', chance: 1, min: 1, max: 2 }, { item: 'tissue', chance: 0.6, min: 1, max: 2 }, { item: 'chemicals', chance: 0.3, min: 1, max: 1 }],
  },
  screamer: {
    kind: 'screamer', name: 'Screamer', hint: 'Calls the horde', labelColor: 'warning',
    hp: 85, walkSpeed: 1.1, runSpeed: 3.4, damage: 8, exposure: 3, attackRange: 1.4, attackWindup: 0.4, attackCooldown: 1.2,
    sight: 26, hearing: 1.5, radius: 0.3, scale: 1.04, bodyArmor: 1, headMul: 1.2, staggerResist: 0,
    drops: [{ item: 'neural', chance: 1, min: 1, max: 1 }, { item: 'tissue', chance: 0.5, min: 1, max: 1 }],
  },
  brute: {
    kind: 'brute', name: 'Brute', hint: 'Charges · aim for the head', labelColor: 'danger',
    hp: 650, walkSpeed: 1.1, runSpeed: 3.1, damage: 38, exposure: 10, attackRange: 1.9, attackWindup: 0.7, attackCooldown: 1.6,
    sight: 20, hearing: 1, radius: 0.6, scale: 1.3, bodyArmor: 0.55, headMul: 1.25, staggerResist: 0.85,
    drops: [{ item: 'adrenal', chance: 1, min: 1, max: 1 }, { item: 'tissue', chance: 1, min: 2, max: 3 }, { item: 'scrap', chance: 0.5, min: 1, max: 2 }],
  },
};

/** Per-wave escalation. Every wave the strain adapts: tougher, faster, angrier. */
export interface WaveScaling {
  hp: number;
  damage: number;
  speed: number;
  aggression: number;
  sight: number;
  maxAlive: number;
  trickle: number;
  mutation: number;
}

export function waveScaling(wave: number): WaveScaling {
  const w = wave - 1;
  return {
    hp: 1 + 0.2 * w,
    damage: 1 + 0.14 * w,
    speed: 1 + 0.055 * w,
    aggression: 1 + 0.12 * w,
    sight: 1 + 0.1 * w,
    maxAlive: 7 + 3 * w,
    trickle: Math.max(5, 14 - 2.2 * w),
    mutation: Math.min(1, 0.15 + 0.2 * w),
  };
}

export function scalingSummary(wave: number) {
  const s = waveScaling(wave);
  const pct = (v: number) => `+${Math.round((v - 1) * 100)}%`;
  return [
    ['Durability', pct(s.hp)],
    ['Damage', pct(s.damage)],
    ['Speed', pct(s.speed)],
    ['Aggression', pct(s.aggression)],
  ] as const;
}
