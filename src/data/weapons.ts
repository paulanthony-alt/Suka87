import type { AmmoId } from './items';

export type WeaponId = 'axe' | 'pistol' | 'smg' | 'rifle' | 'shotgun' | 'dmr';
export type FireMode = 'auto' | 'burst' | 'semi';

export interface WeaponDef {
  id: WeaponId;
  name: string;
  kind: string;
  icon: string;
  sound: 'pistol' | 'smg' | 'rifle' | 'shotgun' | 'dmr' | 'melee';
  ammo?: AmmoId;
  /** damage per bullet/pellet at close range */
  damage: number;
  pellets: number;
  rpm: number;
  modes: FireMode[];
  mag: number;
  reloadTime: number;
  reloadEmptyTime: number;
  /** shotgun-style one-at-a-time reload; reloadTime is per shell */
  perShell?: boolean;
  /** degrees, hip fire standing still */
  spread: number;
  adsSpread: number;
  moveSpread: number;
  recoil: { pitch: number; yaw: number; kick: number };
  adsZoom: number;
  adsTime: number;
  /** metres: damage starts falling off here, reaches 50% at 2x */
  range: number;
  headMul: number;
  limbMul: number;
  /** metres an alert carries */
  noise: number;
  equipTime: number;
  /** stagger power, 0..1 */
  stagger: number;
  melee?: { range: number; arc: number; windup: number; recovery: number };
}

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  axe: {
    id: 'axe', name: 'FIRE AXE', kind: 'Melee · Pick-head', icon: 'w-axe', sound: 'melee',
    damage: 70, pellets: 1, rpm: 70, modes: ['semi'], mag: 0, reloadTime: 0, reloadEmptyTime: 0,
    spread: 0, adsSpread: 0, moveSpread: 0, recoil: { pitch: 0, yaw: 0, kick: 0 },
    adsZoom: 1, adsTime: 0.2, range: 2.4, headMul: 1.6, limbMul: 0.8, noise: 4, equipTime: 0.45, stagger: 0.9,
    melee: { range: 2.4, arc: 0.75, windup: 0.22, recovery: 0.6 },
  },
  pistol: {
    id: 'pistol', name: 'KESTREL P9', kind: 'Service pistol', icon: 'w-pistol', sound: 'pistol', ammo: '9mm',
    damage: 30, pellets: 1, rpm: 380, modes: ['semi'], mag: 15, reloadTime: 1.45, reloadEmptyTime: 1.8,
    spread: 1.4, adsSpread: 0.35, moveSpread: 2.2, recoil: { pitch: 1.9, yaw: 0.6, kick: 0.05 },
    adsZoom: 1.25, adsTime: 0.16, range: 22, headMul: 2.6, limbMul: 0.7, noise: 28, equipTime: 0.35, stagger: 0.25,
  },
  smg: {
    id: 'smg', name: 'COURIER SMG-9', kind: 'Submachine gun', icon: 'w-smg', sound: 'smg', ammo: '9mm',
    damage: 22, pellets: 1, rpm: 820, modes: ['auto', 'semi'], mag: 32, reloadTime: 1.9, reloadEmptyTime: 2.3,
    spread: 2.4, adsSpread: 0.8, moveSpread: 2.6, recoil: { pitch: 0.95, yaw: 0.65, kick: 0.035 },
    adsZoom: 1.3, adsTime: 0.18, range: 18, headMul: 2.3, limbMul: 0.7, noise: 32, equipTime: 0.45, stagger: 0.15,
  },
  rifle: {
    id: 'rifle', name: 'WARDEN AR-4', kind: 'Assault rifle', icon: 'w-rifle', sound: 'rifle', ammo: '556',
    damage: 34, pellets: 1, rpm: 690, modes: ['auto', 'burst', 'semi'], mag: 30, reloadTime: 2.1, reloadEmptyTime: 2.6,
    spread: 2.2, adsSpread: 0.25, moveSpread: 2.8, recoil: { pitch: 1.25, yaw: 0.55, kick: 0.04 },
    adsZoom: 1.55, adsTime: 0.22, range: 45, headMul: 2.4, limbMul: 0.7, noise: 42, equipTime: 0.55, stagger: 0.3,
  },
  shotgun: {
    id: 'shotgun', name: 'HARROW SG-12', kind: 'Pump shotgun', icon: 'w-shotgun', sound: 'shotgun', ammo: '12ga',
    damage: 17, pellets: 9, rpm: 72, modes: ['semi'], mag: 6, reloadTime: 0.52, reloadEmptyTime: 0.52, perShell: true,
    spread: 4.8, adsSpread: 3.6, moveSpread: 1.5, recoil: { pitch: 5.5, yaw: 1.2, kick: 0.12 },
    adsZoom: 1.2, adsTime: 0.22, range: 9, headMul: 1.7, limbMul: 0.8, noise: 45, equipTime: 0.6, stagger: 1,
  },
  dmr: {
    id: 'dmr', name: 'LANCET DMR-7', kind: 'Marksman rifle', icon: 'w-dmr', sound: 'dmr', ammo: '762',
    damage: 92, pellets: 1, rpm: 160, modes: ['semi'], mag: 10, reloadTime: 2.4, reloadEmptyTime: 2.9,
    spread: 3.2, adsSpread: 0.05, moveSpread: 3.5, recoil: { pitch: 4.2, yaw: 0.9, kick: 0.09 },
    adsZoom: 2.6, adsTime: 0.3, range: 80, headMul: 2.5, limbMul: 0.75, noise: 55, equipTime: 0.65, stagger: 0.85,
  },
};

/** Weapon wheel layout (clockwise from top). */
export const WHEEL_ORDER: WeaponId[] = ['rifle', 'shotgun', 'dmr', 'axe', 'pistol', 'smg'];
