export type Difficulty = 'story' | 'survivor' | 'grounded';

export interface Settings {
  sensitivity: number;
  adsSensitivity: number;
  invertY: boolean;
  fov: number;
  masterVolume: number;
  sfxVolume: number;
  musicVolume: number;
  enemyLabels: boolean;
  difficulty: Difficulty;
  renderScale: number;
  shadows: boolean;
  bloom: boolean;
  filmGrain: boolean;
  showFps: boolean;
  /** render infected, pickups and the held weapon as 2D sprites */
  spriteMode: boolean;
}

const DEFAULTS: Settings = {
  sensitivity: 1,
  adsSensitivity: 0.75,
  invertY: false,
  fov: 90,
  masterVolume: 0.8,
  sfxVolume: 1,
  musicVolume: 0.6,
  enemyLabels: true,
  difficulty: 'survivor',
  renderScale: 1,
  shadows: true,
  bloom: true,
  filmGrain: true,
  showFps: false,
  spriteMode: true,
};

const KEY = 'suka87.settings.v1';

export const DIFFICULTY: Record<Difficulty, { label: string; desc: string; enemyHp: number; enemyDmg: number; exposure: number; loot: number }> = {
  story: { label: 'Story', desc: 'Infected hit softer and supplies are plentiful.', enemyHp: 0.75, enemyDmg: 0.6, exposure: 0.6, loot: 1.4 },
  survivor: { label: 'Survivor', desc: 'The intended balance. Every bullet counts.', enemyHp: 1, enemyDmg: 1, exposure: 1, loot: 1 },
  grounded: { label: 'Grounded', desc: 'Scarce supplies, brutal infected, fast infection.', enemyHp: 1.25, enemyDmg: 1.45, exposure: 1.35, loot: 0.7 },
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    /* storage unavailable: fall back to defaults */
  }
  return { ...DEFAULTS };
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}
