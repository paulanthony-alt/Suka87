import type { Game, Stats } from '../game/game';
import type { LevelDef } from '../data/levels';
import { DIFFICULTY, type Difficulty, type Settings } from '../core/settings';
import { INFECTED, scalingSummary, type InfectedKind } from '../data/infected';
import { LEVELS } from '../data/levels';
import { audio } from '../core/audio';

const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const acc = (st: Stats) => (st.shots ? `${Math.round((st.hits / st.shots) * 100)}%` : '—');

const CONTROLS: [string, string][] = [
  ['W A S D', 'Move'],
  ['Shift', 'Sprint'],
  ['C / Ctrl', 'Crouch (quieter, harder to spot)'],
  ['Space', 'Jump'],
  ['Mouse 1', 'Fire / swing'],
  ['Mouse 2', 'Aim down sights'],
  ['R', 'Reload'],
  ['B', 'Fire mode'],
  ['V', 'Quick melee'],
  ['Q (hold)', 'Weapon wheel · tap to swap to last weapon'],
  ['T (hold)', 'Tool wheel'],
  ['1 – 4', 'Antiviral · Medkit · Pipe grenade · Flare'],
  ['Mouse wheel', 'Cycle weapons'],
  ['E', 'Interact · hold for some actions'],
  ['Tab', 'Field kit (crafting)'],
  ['F', 'Flashlight'],
  ['Esc', 'Pause'],
];

/** NEW THREAT callouts per wave. */
const NEW_THREATS: Partial<Record<number, InfectedKind[]>> = { 1: ['shambler', 'runner'], 2: ['bloater'], 3: ['screamer'], 4: ['brute'] };
const THREAT_TEXT: Record<InfectedKind, string> = {
  shambler: 'Slow, relentless. Hunts by sound — keep crouched and quiet.',
  runner: 'Fresh turns. Fast, fragile, and they close distance in seconds.',
  bloater: 'Swollen with viral plasma. Bursts into a Suka 87 mist when killed. Plasma is a cure ingredient.',
  screamer: 'Its cry pulls every infected nearby. Kill it first. Carries the neural tissue the cure needs.',
  brute: 'Armoured and enormous. Charges in a straight line — sidestep and it hits the wall. Head shots only.',
};

/**
 * Title, pause, settings, controls, briefing, death and ending screens.
 */
export class Menus {
  private root: HTMLElement;
  private back: (() => void) | null = null;

  constructor(private game: Game, parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'menus';
    parent.appendChild(this.root);
    this.root.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
      if (!b || b.classList.contains('disabled')) return;
      audio.unlock();
      audio.ui('select');
      this.act(b.dataset.act!, b.dataset.arg);
    });
    this.root.addEventListener('mouseover', (e) => {
      const b = (e.target as HTMLElement).closest('[data-act]');
      if (b && !(b as HTMLElement).dataset.hovered) {
        (b as HTMLElement).dataset.hovered = '1';
        audio.ui('tick');
      }
    });
    this.root.addEventListener('mouseout', (e) => {
      const b = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
      if (b) delete b.dataset.hovered;
    });
    this.root.addEventListener('input', (e) => this.onSetting(e.target as HTMLInputElement));
    this.root.addEventListener('change', (e) => this.onSetting(e.target as HTMLInputElement));
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && this.back) {
        e.preventDefault();
        this.back();
      }
      if ((e.code === 'Enter' || e.code === 'Space') && this.root.querySelector('.briefing')) {
        e.preventDefault();
        this.act('begin');
      }
    });
  }

  hideAll() {
    this.root.innerHTML = '';
    this.root.className = 'menus';
    this.back = null;
  }

  private screen(cls: string, html: string, back: (() => void) | null = null) {
    this.root.className = `menus on ${cls}`;
    this.root.innerHTML = html;
    this.back = back;
  }

  private act(a: string, arg?: string) {
    const g = this.game;
    switch (a) {
      case 'continue': return g.continueGame();
      case 'new': return this.showDifficulty();
      case 'difficulty':
        g.settings.difficulty = arg as Difficulty;
        g.applySettings();
        return g.newGame();
      case 'settings': return this.showSettings(g.state === 'paused' ? () => this.showPause() : () => this.showTitle());
      case 'controls': return this.showControls(g.state === 'paused' ? () => this.showPause() : () => this.showTitle());
      case 'title': return this.showTitle();
      case 'begin': return g.startLevel();
      case 'resume': return g.resume();
      case 'retry': return g.retry();
      case 'quit': return g.quitToTitle();
      case 'back': return this.back?.();
    }
  }

  // ------------------------------------------------------------------ screens

  showTitle() {
    const has = this.game.hasSave;
    this.screen('title', `
      <div class="title-wrap">
        <div class="brand">
          <div class="eyebrow">St. Brendan's Hospital · Day 3</div>
          <h1>SUKA <span>87</span></h1>
          <p class="tag">Fight up through the hospital. Harvest what the infected carry. Synthesise the cure.</p>
        </div>
        <nav class="menu">
          ${has ? '<button data-act="continue">Continue<span>Resume from your last checkpoint</span></button>' : ''}
          <button data-act="new">New game</button>
          <button data-act="settings">Settings</button>
          <button data-act="controls">Controls</button>
        </nav>
        <footer>Headphones recommended · Click to capture the mouse · Esc pauses</footer>
      </div>`);
  }

  private showDifficulty() {
    const opts = (Object.keys(DIFFICULTY) as Difficulty[])
      .map((k) => `<button data-act="difficulty" data-arg="${k}" class="${k === this.game.settings.difficulty ? 'rec' : ''}">${DIFFICULTY[k].label}<span>${DIFFICULTY[k].desc}</span></button>`)
      .join('');
    this.screen('title', `
      <div class="title-wrap">
        <div class="brand"><div class="eyebrow">New game</div><h1 class="small">Choose difficulty</h1>
        ${this.game.hasSave ? '<p class="tag warn">Starting a new game replaces your current checkpoint.</p>' : ''}</div>
        <nav class="menu">${opts}<button data-act="title" class="ghost">Back</button></nav>
      </div>`, () => this.showTitle());
  }

  showPause() {
    const g = this.game;
    const o = g.objectives.current;
    this.screen('pause', `
      <div class="panel">
        <div class="eyebrow">Paused · Wave ${String(g.level!.def.wave).padStart(2, '0')}</div>
        <h1>${g.level!.def.title}</h1>
        ${o ? `<div class="pobj"><span>Objective</span>${o.title}<em>${o.detail}</em></div>` : ''}
        <nav class="menu">
          <button data-act="resume">Resume</button>
          <button data-act="settings">Settings</button>
          <button data-act="controls">Controls</button>
          <button data-act="retry">Restart from checkpoint</button>
          <button data-act="quit" class="ghost">Quit to title</button>
        </nav>
      </div>`, () => g.resume());
  }

  showBriefing(def: LevelDef, index: number, prev: Stats | null) {
    const threats = NEW_THREATS[def.wave] ?? [];
    const scale = scalingSummary(def.wave);
    this.screen('briefing-screen', `
      <div class="briefing">
        <div class="b-left">
          <div class="eyebrow">Wave ${String(def.wave).padStart(2, '0')} of ${String(LEVELS.length).padStart(2, '0')}</div>
          <h1>${def.title}</h1>
          <div class="area">${def.area}</div>
          <p class="text">${def.briefing}</p>
          ${threats.length ? `<div class="threats"><h3>${index === 0 ? 'Known infected' : 'New strain observed'}</h3>${threats.map((k) => `<div class="threat ${INFECTED[k].labelColor}"><b>${INFECTED[k].name}</b><span>${THREAT_TEXT[k]}</span></div>`).join('')}</div>` : ''}
        </div>
        <div class="b-right">
          ${def.wave > 1 ? `<div class="block"><h3>Strain adaptation</h3>${scale.map(([k, v]) => `<div class="kv"><span>${k}</span><b>${v}</b></div>`).join('')}</div>` : `<div class="block"><h3>Suka 87</h3><p class="small">A hemorrhagic rage virus. Every wave it spreads, the strain hardens: the infected get tougher, faster and more aggressive. Exposure climbs with every wound — at 100% you turn.</p></div>`}
          ${prev ? `<div class="block"><h3>Previous wave</h3><div class="kv"><span>Kills</span><b>${prev.kills}</b></div><div class="kv"><span>Headshots</span><b>${prev.headshots}</b></div><div class="kv"><span>Accuracy</span><b>${acc(prev)}</b></div><div class="kv"><span>Time</span><b>${fmtTime(prev.time)}</b></div></div>` : ''}
          <button class="begin" data-act="begin">Begin<span>Enter</span></button>
        </div>
      </div>`);
  }

  showDeath(cause: 'wounds' | 'turned') {
    this.screen('death', `
      <div class="panel center">
        <div class="eyebrow">${cause === 'turned' ? 'Suka 87 exposure · 100%' : 'Vital signs lost'}</div>
        <h1 class="${cause === 'turned' ? 'violet' : 'red'}">${cause === 'turned' ? 'You turned' : 'You died'}</h1>
        <p class="tag">${cause === 'turned' ? 'The virus finished what the wounds started. Antiviral shots buy time — use them.' : 'Too many, too close. Use doors, chokepoints and noise to split them up.'}</p>
        <nav class="menu row">
          <button data-act="retry">Retry from checkpoint</button>
          <button data-act="quit" class="ghost">Quit to title</button>
        </nav>
      </div>`);
  }

  showVictory(st: Stats) {
    this.screen('victory', `
      <div class="ending">
        <div class="eyebrow">Day 3 · 05:12 · Research Wing</div>
        <h1>The cure works.</h1>
        <p class="text">The synthesiser ran clear violet, then clear. Voss loaded the first dose by hand and stopped talking for a long time. By sunrise, the formula was on every open frequency in the city. Suka 87 isn't over — but now it can be ended.</p>
        <div class="stats">
          <div><span>Infected killed</span><b>${st.kills}</b></div>
          <div><span>Headshots</span><b>${st.headshots}</b></div>
          <div><span>Accuracy</span><b>${acc(st)}</b></div>
          <div><span>Items crafted</span><b>${st.crafted}</b></div>
          <div><span>Time</span><b>${fmtTime(st.time)}</b></div>
          <div><span>Difficulty</span><b>${DIFFICULTY[this.game.settings.difficulty].label}</b></div>
        </div>
        <nav class="menu row"><button data-act="quit">Return to title</button></nav>
      </div>`);
  }

  private showControls(back: () => void) {
    this.screen('controls', `
      <div class="panel wide">
        <div class="eyebrow">Reference</div><h1>Controls</h1>
        <div class="keys">${CONTROLS.map(([k, v]) => `<div class="krow"><kbd>${k}</kbd><span>${v}</span></div>`).join('')}</div>
        <nav class="menu row"><button data-act="back" class="ghost">Back</button></nav>
      </div>`, back);
  }

  private showSettings(back: () => void) {
    const s = this.game.settings;
    const slider = (key: keyof Settings, label: string, min: number, max: number, step: number, fmt: (v: number) => string) =>
      `<label class="set"><span>${label}</span><input type="range" data-key="${key}" min="${min}" max="${max}" step="${step}" value="${s[key]}"><b data-out="${key}">${fmt(s[key] as number)}</b></label>`;
    const toggle = (key: keyof Settings, label: string) =>
      `<label class="set tog"><span>${label}</span><input type="checkbox" data-key="${key}" ${s[key] ? 'checked' : ''}><i></i></label>`;
    const pct = (v: number) => `${Math.round(v * 100)}%`;
    this.screen('settings', `
      <div class="panel wide">
        <div class="eyebrow">Options</div><h1>Settings</h1>
        <div class="sets">
          <div class="sgroup"><h3>Controls</h3>
            ${slider('sensitivity', 'Mouse sensitivity', 0.2, 3, 0.05, (v) => v.toFixed(2))}
            ${slider('adsSensitivity', 'Aim sensitivity', 0.2, 1.5, 0.05, (v) => v.toFixed(2))}
            ${toggle('invertY', 'Invert Y axis')}
          </div>
          <div class="sgroup"><h3>Display</h3>
            ${slider('fov', 'Field of view', 70, 110, 1, (v) => `${v}°`)}
            ${slider('renderScale', 'Render scale', 0.5, 1, 0.05, pct)}
            ${toggle('shadows', 'Flashlight shadows')}
            ${toggle('bloom', 'Bloom')}
            ${toggle('filmGrain', 'Film grain')}
            ${toggle('spriteMode', '2D sprite characters')}
            ${toggle('enemyLabels', 'Infected labels')}
            ${toggle('showFps', 'Show FPS')}
          </div>
          <div class="sgroup"><h3>Audio</h3>
            ${slider('masterVolume', 'Master', 0, 1, 0.05, pct)}
            ${slider('sfxVolume', 'Effects', 0, 1, 0.05, pct)}
            ${slider('musicVolume', 'Ambience & music', 0, 1, 0.05, pct)}
          </div>
        </div>
        <nav class="menu row"><button data-act="back" class="ghost">Back</button></nav>
      </div>`, back);
  }

  private onSetting(input: HTMLInputElement) {
    const key = input.dataset.key as keyof Settings | undefined;
    if (!key) return;
    const s = this.game.settings as unknown as Record<string, unknown>;
    s[key] = input.type === 'checkbox' ? input.checked : Number(input.value);
    const out = this.root.querySelector(`[data-out="${key}"]`);
    if (out) {
      const v = Number(input.value);
      out.textContent = key === 'fov' ? `${v}°` : key.includes('Volume') || key === 'renderScale' ? `${Math.round(v * 100)}%` : v.toFixed(2);
    }
    this.game.applySettings();
  }
}
