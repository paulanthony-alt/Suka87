import * as THREE from 'three';
import type { Game } from '../game/game';
import type { LevelDef, ObjectiveDef } from '../data/levels';
import { AMMO, CURE_COMPONENTS, ITEMS, RECIPES, TOOL_ORDER, type ItemId } from '../data/items';
import { WEAPONS, type WeaponId } from '../data/weapons';
import { icon, weaponIcon } from './icons';
import { clamp, wrapAngle } from '../core/math';
import type { Infected } from '../game/infected';
import type { WheelEntry } from './wheel';
import { audio } from '../core/audio';

const el = (tag: string, cls = '', html = '') => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};

const STAGES = ['Stage I', 'Stage II', 'Stage III', 'Stage IV'];

interface Tag {
  root: HTMLElement;
  name: HTMLElement;
  dist: HTMLElement;
  bar: HTMLElement;
  fill: HTMLElement;
  hint: HTMLElement;
  rings: HTMLElement;
  lead: HTMLElement;
  used: boolean;
}

/**
 * Gameplay HUD. Mirrors the supplied 1920×1080 design; each cluster is anchored to its screen
 * corner and scaled uniformly so the layout holds on any aspect ratio.
 */
export class Hud {
  private root: HTMLElement;
  private objTitle!: HTMLElement;
  private objDetail!: HTMLElement;
  private objLabel!: HTMLElement;
  private objBlock!: HTMLElement;
  private cure!: HTMLElement;
  private locTitle!: HTMLElement;
  private locSub!: HTMLElement;
  private feed!: HTMLElement;
  private compass!: HTMLCanvasElement;
  private cctx!: CanvasRenderingContext2D;
  private crosshair!: SVGGElement;
  private chDot!: SVGRectElement;
  private hitmark!: SVGGElement;
  private arcs!: SVGGElement;
  private prompt!: HTMLElement;
  private promptKey!: HTMLElement;
  private promptRing!: SVGRectElement;
  private promptText!: HTMLElement;
  private promptAmt!: HTMLElement;
  private promptSub!: HTMLElement;
  private subs!: HTMLElement;
  private noiseFill!: HTMLElement;
  private hpNum!: HTMLElement;
  private hpFill!: HTMLElement;
  private exStage!: HTMLElement;
  private exPct!: HTMLElement;
  private exFill!: HTMLElement;
  private exBlock!: HTMLElement;
  private stFill!: HTMLElement;
  private slots: { root: HTMLElement; count: HTMLElement; item: ItemId }[] = [];
  private wIcon!: HTMLElement;
  private wName!: HTMLElement;
  private wKind!: HTMLElement;
  private wModes!: HTMLElement;
  private wMag!: HTMLElement;
  private wRes!: HTMLElement;
  private wBar!: HTMLElement;
  private wAmmoRow!: HTMLElement;
  private toastEl!: HTMLElement;
  private scope!: HTMLElement;
  private synth!: HTMLElement;
  private synthFill!: HTMLElement;
  private synthPct!: HTMLElement;
  private useBar!: HTMLElement;
  private useFill!: HTMLElement;
  private useLabel!: HTMLElement;
  private tagLayer!: HTMLElement;
  private banner!: HTMLElement;
  private fps!: HTMLElement;
  private tags: Tag[] = [];
  private hitT = 0;
  private hitKind: 'hit' | 'head' | 'kill' = 'hit';
  private subQueue: { who: string; text: string }[] = [];
  private subT = 0;
  private toastT = 0;
  private bannerT = 0;
  private fpsAcc = 0;
  private fpsN = 0;
  private screamers = new Map<Infected, number>();
  private lastVals = new Map<string, string | number>();
  private proj = new THREE.Vector3();

  constructor(private game: Game, parent: HTMLElement) {
    this.root = el('div', 'hud');
    parent.appendChild(this.root);
    this.build();
    window.addEventListener('resize', () => this.layout());
    this.layout();
  }

  setVisible(v: boolean) {
    this.root.classList.toggle('hidden', !v);
  }

  private layout() {
    const s = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
    document.documentElement.style.setProperty('--s', String(s));
  }

  // ------------------------------------------------------------------ construction

  private build() {
    const r = this.root;
    this.tagLayer = el('div', 'tags');
    r.appendChild(this.tagLayer);

    // scope overlay
    this.scope = el('div', 'scope hidden', '<div class="scope-ring"></div><div class="scope-h"></div><div class="scope-v"></div><div class="scope-dot"></div>');
    r.appendChild(this.scope);

    // top-left: objective + cure tracker
    const tl = el('div', 'grp tl');
    this.objBlock = el('div', 'objective');
    this.objLabel = el('div', 'label', 'Objective');
    this.objTitle = el('div', 'title');
    this.objDetail = el('div', 'detail');
    this.objBlock.append(this.objLabel, this.objTitle, this.objDetail);
    this.cure = el('div', 'cure');
    tl.append(this.objBlock, this.cure);
    this.feed = el('div', 'feed');
    tl.appendChild(this.feed);
    r.appendChild(tl);

    // top-center compass + synthesis bar
    const tc = el('div', 'grp tc');
    this.compass = document.createElement('canvas');
    this.compass.className = 'compass';
    this.compass.width = 640 * 2;
    this.compass.height = 64 * 2;
    this.cctx = this.compass.getContext('2d')!;
    this.synth = el('div', 'synth hidden', '<div class="synth-row"><span>Cure synthesis</span><b class="pct">0%</b></div><div class="synth-bar"><div class="fill"></div></div>');
    this.synthFill = this.synth.querySelector('.fill') as HTMLElement;
    this.synthPct = this.synth.querySelector('.pct') as HTMLElement;
    tc.append(this.compass, this.synth);
    r.appendChild(tc);

    // top-right location
    const tr = el('div', 'grp tr');
    const loc = el('div', 'location');
    this.locTitle = el('div', 'loc-title');
    this.locSub = el('div', 'loc-sub');
    loc.append(this.locTitle, this.locSub);
    this.fps = el('div', 'fps hidden');
    tr.append(loc, this.fps);
    r.appendChild(tr);

    // center: crosshair, hitmarker, damage arcs, prompt
    const cc = el('div', 'grp cc');
    cc.innerHTML = `
      <svg class="reticle" width="1920" height="1080" viewBox="0 0 1920 1080">
        <defs><filter id="redblur" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="6"/></filter></defs>
        <g class="arcs"></g>
        <g class="crosshair" stroke="#E7E9E2" stroke-width="2.2" opacity=".92">
          <line class="ch-t" x1="960" y1="500" x2="960" y2="522"/><line class="ch-b" x1="960" y1="558" x2="960" y2="580"/>
          <line class="ch-l" x1="920" y1="540" x2="942" y2="540"/><line class="ch-r" x1="978" y1="540" x2="1000" y2="540"/>
        </g>
        <rect class="ch-dot" x="958.5" y="538.5" width="3" height="3" fill="#E7E9E2"/>
        <g class="hitmark" stroke="#ffffff" stroke-width="2.6" opacity="0">
          <line x1="946" y1="526" x2="938" y2="518"/><line x1="974" y1="526" x2="982" y2="518"/>
          <line x1="946" y1="554" x2="938" y2="562"/><line x1="974" y1="554" x2="982" y2="562"/>
        </g>
      </svg>`;
    this.crosshair = cc.querySelector('.crosshair') as SVGGElement;
    this.chDot = cc.querySelector('.ch-dot') as SVGRectElement;
    this.hitmark = cc.querySelector('.hitmark') as SVGGElement;
    this.arcs = cc.querySelector('.arcs') as SVGGElement;

    this.prompt = el('div', 'prompt hidden');
    this.promptKey = el('div', 'key', '<span>E</span><svg width="34" height="34" viewBox="0 0 34 34"><rect class="ring" x="1" y="1" width="32" height="32" pathLength="100"/></svg>');
    this.promptRing = this.promptKey.querySelector('.ring') as SVGRectElement;
    this.promptText = el('div', 'ptext');
    this.promptAmt = el('div', 'pamt');
    this.promptSub = el('div', 'psub');
    const prow = el('div', 'prow');
    prow.append(this.promptKey, this.promptText, this.promptAmt);
    this.prompt.append(prow, this.promptSub);
    cc.appendChild(this.prompt);

    this.useBar = el('div', 'usebar hidden', '<div class="ulabel"></div><div class="utrack"><div class="ufill"></div></div>');
    this.useLabel = this.useBar.querySelector('.ulabel') as HTMLElement;
    this.useFill = this.useBar.querySelector('.ufill') as HTMLElement;
    cc.appendChild(this.useBar);

    this.toastEl = el('div', 'toast hidden');
    cc.appendChild(this.toastEl);
    this.banner = el('div', 'banner hidden');
    cc.appendChild(this.banner);
    r.appendChild(cc);

    // bottom-center: noise + subtitles
    const bc = el('div', 'grp bc');
    const noise = el('div', 'noise', '<span>Noise</span><div class="segs"><div class="fill"></div></div>');
    this.noiseFill = noise.querySelector('.fill') as HTMLElement;
    this.subs = el('div', 'subtitle hidden');
    bc.append(noise, this.subs);
    r.appendChild(bc);

    // bottom-left vitals
    const bl = el('div', 'grp bl');
    bl.innerHTML = `
      <div class="vitals">
        <div class="hp-row"><span class="hp-num">100</span><span class="hp-lbl">Health</span></div>
        <div class="segbar hp"><div class="fill"></div></div>
        <div class="ex">
          <div class="ex-row"><span class="ex-lbl">Suka 87 exposure <span class="ex-stage">· Stage I</span></span><span class="ex-pct">0%</span></div>
          <div class="ex-bar"><div class="fill"></div><i style="left:99px"></i><i style="left:199px"></i><i style="left:299px"></i></div>
        </div>
        <div class="st-row"><span>Stamina</span><div class="st-bar"><div class="fill"></div></div></div>
      </div>`;
    this.hpNum = bl.querySelector('.hp-num') as HTMLElement;
    this.hpFill = bl.querySelector('.segbar.hp .fill') as HTMLElement;
    this.exBlock = bl.querySelector('.ex') as HTMLElement;
    this.exStage = bl.querySelector('.ex-stage') as HTMLElement;
    this.exPct = bl.querySelector('.ex-pct') as HTMLElement;
    this.exFill = bl.querySelector('.ex-bar .fill') as HTMLElement;
    this.stFill = bl.querySelector('.st-bar .fill') as HTMLElement;
    r.appendChild(bl);

    // bottom-right: quick slots + weapon
    const br = el('div', 'grp br');
    const pos: Record<number, [number, number]> = { 0: [672, 190], 1: [602, 260], 2: [532, 190], 3: [602, 120] };
    TOOL_ORDER.slice(0, 4).forEach((item, i) => {
      const [right, bottom] = pos[i];
      const s = el('div', 'slot');
      s.style.right = right - 64 + 'px';
      s.style.bottom = bottom + 'px';
      s.innerHTML = `${icon(ITEMS[item].icon, 36)}<span class="k">${i + 1}</span><span class="n"></span>`;
      br.appendChild(s);
      this.slots.push({ root: s, count: s.querySelector('.n') as HTMLElement, item });
    });
    const wp = el('div', 'wpanel');
    this.wIcon = el('div', 'wicon');
    this.wName = el('div', 'wname');
    this.wKind = el('div', 'wkind');
    const row = el('div', 'wrow');
    this.wModes = el('div', 'modes');
    this.wAmmoRow = el('div', 'ammo', '<span class="mag">0</span><span class="res">/ 0</span>');
    this.wMag = this.wAmmoRow.querySelector('.mag') as HTMLElement;
    this.wRes = this.wAmmoRow.querySelector('.res') as HTMLElement;
    row.append(this.wModes, this.wAmmoRow);
    this.wBar = el('div', 'magbar', '<div class="fill"></div>');
    wp.append(this.wIcon, this.wName, this.wKind, row, this.wBar);
    br.appendChild(wp);
    r.appendChild(br);
  }

  // ------------------------------------------------------------------ events

  levelChanged(def: LevelDef) {
    this.locTitle.textContent = `${def.title}, St. Brendan's Hospital`;
    this.subQueue = [];
    this.subs.classList.add('hidden');
    this.feed.innerHTML = '';
    this.weaponChanged();
    this.inventoryChanged();
    this.banner.innerHTML = `<div class="b-small">Wave ${String(def.wave).padStart(2, '0')}</div><div class="b-big">${def.title}</div><div class="b-sub">${def.area}</div>`;
    this.banner.classList.remove('hidden');
    this.bannerT = 4;
  }

  roomChanged(room: string) {
    const def = this.game.level!.def;
    this.locTitle.textContent = `${room}, ${def.title}`;
  }

  objectiveChanged(o: ObjectiveDef, updated: boolean) {
    this.objTitle.textContent = o.title;
    this.objDetail.textContent = o.detail;
    this.objLabel.textContent = updated ? 'New objective' : 'Objective';
    this.objBlock.classList.remove('flash');
    void this.objBlock.offsetWidth;
    this.objBlock.classList.add('flash');
    setTimeout(() => (this.objLabel.textContent = 'Objective'), 4000);
  }

  inventoryChanged() {
    const inv = this.game.inventory;
    for (const s of this.slots) {
      const n = inv.count(s.item);
      s.count.textContent = n ? `×${n}` : '';
      s.root.classList.toggle('empty', n === 0);
    }
    // Cure tracker: one cell per component with ingredient progress, plus what to hunt for next.
    let next = '';
    const cells = CURE_COMPONENTS.map((c) => {
      const done = inv.has(c);
      const r = RECIPES.find((x) => x.output === c);
      const need = r ? r.inputs.reduce((a, [, n]) => a + n, 0) : 1;
      const got = r ? r.inputs.reduce((a, [id, n]) => a + Math.min(inv.count(id), n), 0) : 0;
      const ready = !done && got >= need;
      if (!done && !next && r) {
        const missing = r.inputs.find(([id, n]) => inv.count(id) < n);
        next = missing
          ? `Next: <b>${ITEMS[c].name}</b> · ${ITEMS[missing[0]].name.toLowerCase()} ${inv.count(missing[0])}/${missing[1]}`
          : `<b>${ITEMS[c].name}</b> ready to culture at a lab station`;
      }
      const cls = done ? 'on' : ready ? 'ready' : '';
      return `<div class="cc ${cls}" title="${ITEMS[c].name}">${icon(ITEMS[c].icon, 28)}<div class="prog"><b style="width:${Math.round((got / need) * 100)}%"></b></div></div>`;
    });
    const doneN = CURE_COMPONENTS.filter((c) => inv.has(c)).length;
    if (doneN === 4) next = '<b>All four components</b> · synthesise the cure in the virology lab';
    this.cure.innerHTML =
      `<div class="cure-head"><span class="cure-lbl">Suka 87 cure</span><span class="cure-n">${doneN}<i>/4</i></span></div>` +
      `<div class="cure-row">${cells.join('')}</div><div class="cure-next">${next}</div>`;
    this.weaponChanged();
  }

  weaponChanged() {
    const w = this.game.weapons;
    const d = WEAPONS[this.game.inventory.current];
    this.wIcon.innerHTML = weaponIcon(d.icon, 180, 72);
    this.wName.textContent = d.name;
    this.wKind.textContent = d.ammo ? `${d.kind} · ${AMMO[d.ammo].short}` : d.kind;
    this.wModes.innerHTML = d.modes.length > 1 || d.ammo ? (['auto', 'burst', 'semi'] as const).filter((m) => d.modes.includes(m)).map((m) => `<span class="${m === w.mode ? 'on' : ''}">${m.toUpperCase()}</span>`).join('') : '';
    this.wAmmoRow.classList.toggle('hidden', !d.ammo);
    this.wBar.classList.toggle('hidden', !d.ammo);
    this.lastVals.delete('mag');
  }

  hitmarker(kind: 'hit' | 'head' | 'kill') {
    this.hitT = kind === 'kill' ? 0.32 : 0.18;
    this.hitKind = kind;
    if (kind === 'kill') audio.ui('tick');
  }

  pickup(iconId: string, name: string, qty: number, special = false) {
    const row = el('div', 'feed-row' + (special ? ' special' : ''));
    const ico = iconId.startsWith('w-') ? weaponIcon(iconId, 56, 22) : icon(iconId, 28);
    row.innerHTML = `${ico}<span class="fname">${name}</span><span class="famt">+${qty}</span>`;
    this.feed.prepend(row);
    while (this.feed.children.length > 5) this.feed.lastElementChild!.remove();
    setTimeout(() => row.classList.add('fade'), 3800);
    setTimeout(() => row.remove(), 4600);
  }

  subtitle(who: string, text: string) {
    this.subQueue.push({ who, text });
    if (this.subT <= 0) this.nextSubtitle();
  }

  private nextSubtitle() {
    const s = this.subQueue.shift();
    if (!s) {
      this.subs.classList.add('hidden');
      return;
    }
    this.subs.innerHTML = s.who ? `<span class="who">${s.who}</span> ${s.text}` : s.text;
    this.subs.classList.remove('hidden');
    this.subT = 2.2 + s.text.length * 0.055;
    if (s.who) audio.ui('radio');
  }

  toast(text: string, tone: 'neutral' | 'violet' | 'amber') {
    this.toastEl.textContent = text;
    this.toastEl.className = `toast ${tone}`;
    this.toastT = 1.8;
  }

  screamPulse(inf: Infected) {
    this.screamers.set(inf, 1.8);
  }

  // ------------------------------------------------------------------ wheel entries

  weaponWheelEntry(id: WeaponId): WheelEntry {
    const inv = this.game.inventory;
    const d = WEAPONS[id];
    const owned = inv.weapons.has(id);
    return {
      id,
      label: owned ? d.name : 'Empty',
      sub: owned ? (d.ammo ? `${d.kind} · ${AMMO[d.ammo].short}` : d.kind) : 'Not found yet',
      iconHtml: weaponIcon(d.icon, 120, 48),
      value: owned && d.ammo ? `${inv.mags[id] ?? 0} / ${inv.ammo[d.ammo]}` : owned ? '' : '',
      detail: owned ? weaponBlurb(id) : 'Search the hospital.',
      enabled: owned,
      current: inv.current === id,
    };
  }

  toolWheelEntry(id: ItemId): WheelEntry {
    const inv = this.game.inventory;
    const n = inv.count(id);
    const slot = TOOL_ORDER.indexOf(id);
    return {
      id,
      label: ITEMS[id].name,
      sub: slot < 4 ? `Quick slot ${slot + 1}` : 'Wheel only',
      iconHtml: icon(ITEMS[id].icon, 44),
      value: `×${n}`,
      detail: ITEMS[id].desc,
      enabled: n > 0,
      current: false,
    };
  }

  // ------------------------------------------------------------------ per frame

  private set(key: string, v: string | number, fn: () => void) {
    if (this.lastVals.get(key) === v) return;
    this.lastVals.set(key, v);
    fn();
  }

  frame(dt: number) {
    const g = this.game;
    if (this.root.classList.contains('hidden')) return;
    if (g.state !== 'playing' && g.state !== 'paused' && g.state !== 'dead') return;
    const p = g.player;
    const w = g.weapons;

    // vitals
    const hp = Math.ceil(p.health);
    this.set('hp', hp, () => {
      this.hpNum.textContent = String(hp);
      this.hpFill.style.width = `${(p.health / p.maxHealth) * 400}px`;
      this.hpNum.classList.toggle('low', hp <= 30);
    });
    const ex = Math.floor(p.exposure);
    this.set('ex', ex, () => {
      const stage = Math.min(3, Math.floor(p.exposure / 25));
      this.exStage.textContent = `· ${STAGES[stage]}`;
      this.exPct.textContent = `${ex}%`;
      this.exFill.style.width = `${p.exposure * 4}px`;
      this.exBlock.classList.toggle('critical', stage >= 2);
    });
    this.set('st', Math.round(p.stamina), () => (this.stFill.style.width = `${p.stamina * 3.36}px`));

    // weapon
    const d = w.def;
    if (d.ammo) {
      const mag = w.mag;
      const res = w.reserve;
      this.set('mag', `${d.id}:${mag}:${res}:${w.reloading}`, () => {
        this.wMag.textContent = String(mag);
        this.wRes.textContent = `/ ${res}`;
        this.wMag.classList.toggle('low', mag <= Math.ceil(d.mag * 0.25));
        this.wBar.style.setProperty('--n', String(Math.min(d.mag, 30)));
        (this.wBar.firstElementChild as HTMLElement).style.width = `${(mag / d.mag) * 100}%`;
        this.wAmmoRow.classList.toggle('reloading', w.reloading);
      });
    }

    // quick slot highlight while using
    const using = g.tools.using?.item;
    for (const s of this.slots) s.root.classList.toggle('active', using === s.item);
    if (g.tools.using) {
      this.useBar.classList.remove('hidden');
      this.useLabel.textContent = g.tools.using.item === 'antiviral' ? 'Injecting antiviral' : g.tools.using.item === 'medkit' ? 'Applying medkit' : 'Applying bandage';
      this.useFill.style.width = `${g.tools.useProgress * 100}%`;
    } else this.useBar.classList.add('hidden');

    // noise
    this.noiseFill.style.width = `${Math.round(g.noiseLevel * 6) * 17}px`;

    // location clock
    const mins = Math.floor(g.clock);
    this.set('clock', mins, () => {
      const hh = String(Math.floor(mins / 60) % 24).padStart(2, '0');
      const mm = String(mins % 60).padStart(2, '0');
      this.locSub.textContent = `Containment zone ${g.level!.def.zone} · Day 3, ${hh}:${mm}`;
    });

    // crosshair
    const ads = w.aimingDownSights;
    const melee = !d.ammo;
    const gap = 18 + Math.tan((w.spreadDeg * Math.PI) / 180) * 540;
    this.crosshair.style.opacity = ads || melee || p.sprinting ? '0' : '0.92';
    const lines = this.crosshair.children;
    const L = 22;
    (lines[0] as SVGLineElement).setAttribute('y1', String(540 - gap - L));
    (lines[0] as SVGLineElement).setAttribute('y2', String(540 - gap));
    (lines[1] as SVGLineElement).setAttribute('y1', String(540 + gap));
    (lines[1] as SVGLineElement).setAttribute('y2', String(540 + gap + L));
    (lines[2] as SVGLineElement).setAttribute('x1', String(960 - gap - L));
    (lines[2] as SVGLineElement).setAttribute('x2', String(960 - gap));
    (lines[3] as SVGLineElement).setAttribute('x1', String(960 + gap));
    (lines[3] as SVGLineElement).setAttribute('x2', String(960 + gap + L));
    this.chDot.style.opacity = ads && !w.scoped ? '0' : p.sprinting ? '0.3' : '1';
    this.scope.classList.toggle('hidden', !w.scoped);

    // hitmarker
    this.hitT -= dt;
    const hm = this.hitmark;
    hm.style.opacity = this.hitT > 0 ? String(Math.min(1, this.hitT * 8)) : '0';
    hm.setAttribute('stroke', this.hitKind === 'kill' ? '#E2442E' : '#ffffff');
    hm.setAttribute('transform', this.hitKind === 'head' || this.hitKind === 'kill' ? 'translate(960 540) scale(1.25) translate(-960 -540)' : '');

    // damage arcs
    let arcs = '';
    for (const e of p.damageEvents) {
      const rel = wrapAngle(e.yaw - p.yaw);
      const deg = (-rel * 180) / Math.PI;
      const a = clamp(e.t / 1.6, 0, 1);
      arcs += `<g transform="rotate(${deg.toFixed(1)} 960 540)" opacity="${a.toFixed(2)}"><path d="M888.9 321.3 A230 230 0 0 1 1031.1 321.3" fill="none" stroke="#E2442E" stroke-width="16" opacity=".55" filter="url(#redblur)"/><path d="M888.9 321.3 A230 230 0 0 1 1031.1 321.3" fill="none" stroke="#E2442E" stroke-width="5" opacity=".95"/></g>`;
    }
    this.set('arcs', arcs, () => (this.arcs.innerHTML = arcs));

    // interaction prompt
    const it = g.interactions.focus;
    const pr = it?.prompt();
    if (pr && g.state === 'playing' && !g.crafting.open) {
      this.prompt.classList.remove('hidden');
      this.set('ptext', pr.verb, () => (this.promptText.textContent = pr.verb));
      this.set('pamt', pr.amount ?? '', () => (this.promptAmt.textContent = pr.amount ?? ''));
      this.set('psub', pr.disabled ?? (pr.hold ? 'Hold' : ''), () => (this.promptSub.textContent = pr.disabled ?? (pr.hold ? 'Hold' : '')));
      this.prompt.classList.toggle('disabled', !!pr.disabled);
      this.promptRing.style.strokeDashoffset = String(100 - g.interactions.holdProgress * 100);
      this.promptKey.classList.toggle('holding', g.interactions.holdProgress > 0);
    } else this.prompt.classList.add('hidden');

    // subtitles
    if (this.subT > 0) {
      this.subT -= dt;
      if (this.subT <= 0) this.nextSubtitle();
    }
    if (this.toastT > 0) {
      this.toastT -= dt;
      this.toastEl.classList.toggle('hidden', this.toastT <= 0);
    }
    // the wave card never sits on top of the wheels or the field kit
    this.banner.classList.toggle('muted', g.weaponWheel.isOpen || g.toolWheel.isOpen || g.crafting.open);
    if (this.bannerT > 0) {
      this.bannerT -= dt;
      this.banner.classList.toggle('out', this.bannerT < 0.8);
      if (this.bannerT <= 0) this.banner.classList.add('hidden');
    }

    // synthesis
    const syn = g.director.synthesis;
    this.synth.classList.toggle('hidden', !syn);
    if (syn) {
      const k = syn.t / syn.dur;
      this.synthFill.style.width = `${k * 100}%`;
      this.synthPct.textContent = `${Math.floor(k * 100)}%  ·  ${Math.ceil(syn.dur - syn.t)} s`;
    }

    this.drawCompass();
    this.updateTags(dt);

    // fps
    this.fps.classList.toggle('hidden', !g.settings.showFps);
    if (g.settings.showFps) {
      this.fpsAcc += dt;
      this.fpsN++;
      if (this.fpsAcc > 0.5) {
        this.fps.textContent = `${Math.round(this.fpsN / this.fpsAcc)} fps`;
        this.fpsAcc = 0;
        this.fpsN = 0;
      }
    }
  }

  private drawCompass() {
    const g = this.game;
    const c = this.cctx;
    const W = 640;
    c.setTransform(2, 0, 0, 2, 0, 0);
    c.clearRect(0, 0, W, 64);
    const heading = ((((-g.player.yaw * 180) / Math.PI) % 360) + 360) % 360;
    const pxPerDeg = 80 / 15;
    const xOf = (deg: number) => 320 + wrapDeg(deg - heading) * pxPerDeg;
    const names: Record<number, string> = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };

    for (let a = Math.floor((heading - 66) / 5) * 5; a <= heading + 66; a += 5) {
      const deg = ((a % 360) + 360) % 360;
      const x = xOf(deg);
      if (x < 0 || x > W) continue;
      const major = deg % 15 === 0;
      c.strokeStyle = major ? 'rgba(231,233,226,1)' : 'rgba(231,233,226,.5)';
      c.lineWidth = major ? 2 : 1.5;
      c.beginPath();
      c.moveTo(x, major ? 22 : 27);
      c.lineTo(x, major ? 36 : 34);
      c.stroke();
      if (major) {
        if (names[deg]) {
          c.font = '700 17px "Big Shoulders Display", sans-serif';
          c.fillStyle = '#E7E9E2';
          c.textAlign = 'center';
          c.fillText(names[deg], x, 18);
        } else {
          c.font = '500 12px "Barlow Semi Condensed", sans-serif';
          c.fillStyle = '#8C9A95';
          c.textAlign = 'center';
          c.fillText(String(deg).padStart(3, '0'), x, 50);
        }
      }
    }

    const p = g.player.pos;
    // threats
    for (const inf of g.infected) {
      if (!inf.alive || (inf.state !== 'chase' && inf.state !== 'attack' && inf.state !== 'charge')) continue;
      const d = inf.pos.distanceTo(p);
      if (d > 35) continue;
      const bearing = (Math.atan2(inf.pos.x - p.x, -(inf.pos.z - p.z)) * 180) / Math.PI;
      const x = xOf(((bearing % 360) + 360) % 360);
      if (x < 8 || x > W - 8) continue;
      c.fillStyle = '#E2442E';
      c.beginPath();
      c.moveTo(x, 23);
      c.lineTo(x + 7, 35);
      c.lineTo(x - 7, 35);
      c.closePath();
      c.fill();
    }
    // objective
    const t = g.objectives.targetPos();
    if (t) {
      const bearing = (Math.atan2(t.x - p.x, -(t.z - p.z)) * 180) / Math.PI;
      const rel = wrapDeg(bearing - heading);
      const x = clamp(320 + rel * pxPerDeg, 12, W - 12);
      c.fillStyle = '#F3B03B';
      c.beginPath();
      c.moveTo(x, 22);
      c.lineTo(x + 7, 29);
      c.lineTo(x, 36);
      c.lineTo(x - 7, 29);
      c.closePath();
      c.fill();
      c.font = '600 13px "Barlow Semi Condensed", sans-serif';
      c.textAlign = 'center';
      c.fillText(`${Math.round(Math.hypot(t.x - p.x, t.z - p.z))} m`, x, 54);
    }
    // heading caret
    c.fillStyle = '#E7E9E2';
    c.beginPath();
    c.moveTo(313, 1);
    c.lineTo(327, 1);
    c.lineTo(320, 11);
    c.closePath();
    c.fill();
    // fade the ends
    c.globalCompositeOperation = 'destination-in';
    const grad = c.createLinearGradient(0, 0, W, 0);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(0.2, 'rgba(0,0,0,1)');
    grad.addColorStop(0.8, 'rgba(0,0,0,1)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = grad;
    c.fillRect(0, 12, W, 52);
    c.fillStyle = '#000';
    c.fillRect(0, 0, W, 12);
    c.globalCompositeOperation = 'source-over';
  }

  private updateTags(dt: number) {
    const g = this.game;
    const cam = g.camera;
    const p = g.player.pos;
    const show = g.settings.enemyLabels && g.state === 'playing' && !g.weapons.scoped && !g.weaponWheel.isOpen && !g.toolWheel.isOpen;
    for (const [inf, t] of this.screamers) {
      if (t - dt <= 0 || !inf.alive) this.screamers.delete(inf);
      else this.screamers.set(inf, t - dt);
    }
    const cands: { inf: Infected; d: number }[] = [];
    if (show) {
      for (const inf of g.infected) {
        if (!inf.alive) continue;
        const d = inf.pos.distanceTo(p);
        if (d > 32) continue;
        const aware = inf.alerted || d < 14 || inf.lastHitTime > g.time - 4;
        if (!aware) continue;
        if (!g.level!.lineOfSight(p.x, p.z, inf.pos.x, inf.pos.z)) continue;
        cands.push({ inf, d });
      }
      cands.sort((a, b) => a.d - b.d);
    }
    const W = window.innerWidth;
    const H = window.innerHeight;
    const s = Math.min(W / 1920, H / 1080);
    // Screen rects already claimed by nearer infected. Farther labels are lifted above them
    // (with a leader line back to the head) instead of drawn on top; if that would push a
    // label too far from its owner, it's dropped.
    const placed: { l: number; r: number; t: number; b: number }[] = [];
    let used = 0;
    for (const { inf, d } of cands.slice(0, 6)) {
      this.proj.set(inf.pos.x, inf.height + 0.3, inf.pos.z).project(cam);
      if (this.proj.z > 1 || Math.abs(this.proj.x) > 1.05 || Math.abs(this.proj.y) > 1.1) continue;
      const tag = this.tags[used] ?? this.makeTag();
      used++;
      tag.used = true;
      const x = (this.proj.x * 0.5 + 0.5) * W;
      const y = (-this.proj.y * 0.5 + 0.5) * H;
      const tone = inf.boss ? 'danger' : inf.def.labelColor;
      tag.root.dataset.tone = tone;
      tag.name.textContent = inf.name;
      tag.dist.textContent = `${Math.round(d)} m`;
      tag.fill.style.width = `${(inf.hp / inf.maxHp) * 100}%`;
      tag.bar.style.width = `${tone === 'danger' ? 72 : d > 18 ? 40 : 56}px`;
      tag.bar.classList.toggle('hidden', tone === 'warning');
      tag.hint.textContent = inf.def.hint && d < 14 ? inf.def.hint : '';
      tag.rings.classList.toggle('hidden', !this.screamers.has(inf));

      const w = tag.root.offsetWidth * s;
      const h = tag.root.offsetHeight * s;
      let yb = y;
      for (let pass = 0; pass < 4; pass++) {
        const hit = placed.find((q) => x - w / 2 < q.r && x + w / 2 > q.l && yb - h < q.b && yb > q.t);
        if (!hit) break;
        yb = hit.t - 4 * s;
      }
      const lift = y - yb;
      if (lift > 150 * s) {
        tag.root.style.opacity = '0';
        continue;
      }
      placed.push({ l: x - w / 2, r: x + w / 2, t: yb - h, b: yb });
      tag.lead.style.height = `${(lift / s).toFixed(1)}px`;
      tag.root.style.transform = `translate(${x.toFixed(1)}px, ${yb.toFixed(1)}px) translate(-50%, -100%) scale(var(--s))`;
      tag.root.style.opacity = String(clamp(1.3 - d / 30, 0.35, 1));
    }
    for (let i = used; i < this.tags.length; i++) this.tags[i].root.style.opacity = '0';
  }

  private makeTag(): Tag {
    const root = el('div', 'etag');
    root.innerHTML = `<i class="lead"></i><div class="tname"><svg class="warn" width="16" height="16" viewBox="0 0 16 16"><path d="M8 1 L15 14 H1 Z" fill="currentColor"/><path d="M8 6 V10 M8 11.6 V12.6" stroke="#090d0d" stroke-width="1.6"/></svg><span class="n"></span> <span class="d"></span></div><div class="tbar"><div class="tfill"></div></div><div class="thint"></div><div class="rings hidden"><i></i><i></i><i></i></div>`;
    this.tagLayer.appendChild(root);
    const tag: Tag = {
      root,
      name: root.querySelector('.n') as HTMLElement,
      dist: root.querySelector('.d') as HTMLElement,
      bar: root.querySelector('.tbar') as HTMLElement,
      fill: root.querySelector('.tfill') as HTMLElement,
      hint: root.querySelector('.thint') as HTMLElement,
      rings: root.querySelector('.rings') as HTMLElement,
      lead: root.querySelector('.lead') as HTMLElement,
      used: false,
    };
    this.tags.push(tag);
    return tag;
  }
}

function wrapDeg(d: number) {
  d = ((d + 180) % 360 + 360) % 360 - 180;
  return d;
}

function weaponBlurb(id: WeaponId) {
  switch (id) {
    case 'axe': return 'Silent. Heavy swings stagger anything smaller than a Brute.';
    case 'pistol': return 'Reliable sidearm. Accurate enough for headshots at range.';
    case 'smg': return 'High rate of fire, shares 9 mm with the pistol. B toggles fire mode.';
    case 'rifle': return 'Red-dot optic, auto / burst / semi. Loud — it will draw a crowd.';
    case 'shotgun': return 'Devastating up close. Staggers almost anything. Reloads one shell at a time.';
    case 'dmr': return 'Variable scope, punches through one target. Slow follow-up.';
  }
}
