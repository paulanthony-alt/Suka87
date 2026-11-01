import { audio } from '../core/audio';
import { SOFT, enter, exit, pop, to } from './anim';

export interface WheelEntry {
  id: string;
  label: string;
  sub: string;
  iconHtml: string;
  value: string;
  detail: string;
  enabled: boolean;
  current: boolean;
}

const R_OUT = 300;
const R_IN = 136;
const GAP_DEG = 1.6;

function sector(cx: number, cy: number, r0: number, r1: number, a0: number, a1: number) {
  const p = (r: number, a: number) => `${(cx + Math.sin(a) * r).toFixed(2)} ${(cy - Math.cos(a) * r).toFixed(2)}`;
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M${p(r1, a0)} A${r1} ${r1} 0 ${large} 1 ${p(r1, a1)} L${p(r0, a1)} A${r0} ${r0} 0 ${large} 0 ${p(r0, a0)} Z`;
}

/**
 * Hold-to-open radial selector (weapons on Q, tools on T). Mouse movement steers a virtual
 * cursor; releasing the key commits the highlighted segment. Game time slows while it's open.
 */
export class RadialWheel {
  private root: HTMLElement;
  private svg: SVGSVGElement;
  private center: HTMLElement;
  private entries: WheelEntry[] = [];
  private segs: { path: SVGPathElement; node: HTMLElement }[] = [];
  private vx = 0;
  private vy = 0;
  private sel = -1;
  isOpen = false;

  constructor(parent: HTMLElement, kind: 'weapon' | 'tool') {
    this.root = document.createElement('div');
    this.root.className = `wheel wheel-${kind}`;
    this.root.innerHTML = `
      <div class="wheel-dim"></div>
      <div class="wheel-body"><div class="wheel-anim">
        <div class="wheel-title">${kind === 'weapon' ? 'Weapons' : 'Tools'}<span>${kind === 'weapon' ? 'Release Q to equip' : 'Release T to use'}</span></div>
        <svg class="wheel-svg" width="640" height="640" viewBox="0 0 640 640"></svg>
        <div class="wheel-nodes"></div>
        <div class="wheel-center"></div>
      </div></div>`;
    parent.appendChild(this.root);
    this.svg = this.root.querySelector('svg') as SVGSVGElement;
    this.center = this.root.querySelector('.wheel-center') as HTMLElement;
  }

  openWith(entries: WheelEntry[], initial: number) {
    this.entries = entries;
    this.isOpen = true;
    this.vx = this.vy = 0;
    this.sel = initial >= 0 && entries[initial]?.enabled ? initial : -1;
    this.build();
    this.root.classList.add('open');
    this.highlight();
    // spring the ring open, then fan the segments out clockwise from the top
    to(this.root.querySelector('.wheel-anim'), { scale: [0.86, 1], opacity: [0, 1], rotate: [-6, 0] } as never, SOFT);
    enter(this.root.querySelectorAll('.wheel-svg .seg'), { scale: 0.82, each: 0.022 });
    enter(this.root.querySelectorAll('.nin'), { scale: 0.6, each: 0.022, delay: 0.03 });
  }

  /** Closes the wheel and returns the chosen id (or null). */
  close(): string | null {
    if (!this.isOpen) return null;
    this.isOpen = false;
    const root = this.root;
    exit(root.querySelector('.wheel-anim'), { scale: 0.92, duration: 0.14 }, () => {
      if (!this.isOpen) root.classList.remove('open');
    });
    const e = this.entries[this.sel];
    return e && e.enabled && !e.current ? e.id : null;
  }

  pointer(dx: number, dy: number) {
    if (!this.isOpen) return;
    this.vx += dx;
    this.vy += dy;
    const len = Math.hypot(this.vx, this.vy);
    const max = 120;
    if (len > max) {
      this.vx *= max / len;
      this.vy *= max / len;
    }
    if (len < 30) return;
    const n = this.entries.length;
    const a = (Math.atan2(this.vx, -this.vy) + Math.PI * 2) % (Math.PI * 2);
    const i = Math.round(a / ((Math.PI * 2) / n)) % n;
    if (i !== this.sel) {
      this.sel = i;
      audio.ui('tick');
      this.highlight();
    }
  }

  private build() {
    const n = this.entries.length;
    const step = (Math.PI * 2) / n;
    const gap = (GAP_DEG * Math.PI) / 180;
    this.svg.innerHTML = `<circle cx="320" cy="320" r="${R_OUT + 8}" class="ring-out"/><circle cx="320" cy="320" r="${R_IN - 10}" class="ring-in"/>`;
    const nodes = this.root.querySelector('.wheel-nodes') as HTMLElement;
    nodes.innerHTML = '';
    this.segs = this.entries.map((e, i) => {
      const a0 = i * step - step / 2 + gap;
      const a1 = i * step + step / 2 - gap;
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', sector(320, 320, R_IN, R_OUT, a0, a1));
      path.setAttribute('class', `seg${e.enabled ? '' : ' off'}${e.current ? ' cur' : ''}`);
      path.style.transformOrigin = '320px 320px';
      this.svg.appendChild(path);
      const mid = (R_IN + R_OUT) / 2 + 6;
      const node = document.createElement('div');
      node.className = `node${e.enabled ? '' : ' off'}${e.current ? ' cur' : ''}`;
      node.style.left = `${320 + Math.sin(i * step) * mid}px`;
      node.style.top = `${320 - Math.cos(i * step) * mid}px`;
      node.innerHTML = `<div class="nin"><div class="nicon">${e.iconHtml}</div><div class="nval">${e.enabled ? e.value : '—'}</div></div>`;
      nodes.appendChild(node);
      return { path, node };
    });
  }

  private highlight() {
    this.segs.forEach((s, i) => {
      const on = i === this.sel;
      const was = s.node.classList.contains('sel');
      s.path.classList.toggle('sel', on);
      s.node.classList.toggle('sel', on);
      // the selected segment pushes outwards along its bisector and its icon pops
      const a = (i / this.segs.length) * Math.PI * 2;
      if (on !== was) to(s.path, { x: on ? Math.sin(a) * 9 : 0, y: on ? -Math.cos(a) * 9 : 0 });
      if (on && !was) pop(s.node.querySelector('.nin'), 1.18);
      else if (!on && was) to(s.node.querySelector('.nin'), { scale: 1 });
    });
    const e = this.entries[this.sel];
    if (!e) {
      this.center.innerHTML = `<div class="c-hint">Move the mouse to choose</div>`;
      return;
    }
    this.center.innerHTML = `
      <div class="c-name">${e.label}</div>
      <div class="c-sub">${e.sub}</div>
      ${e.enabled && e.value ? `<div class="c-val">${e.value}</div>` : ''}
      <div class="c-detail">${e.detail}</div>
      ${e.current ? '<div class="c-tag">Equipped</div>' : ''}`;
    enter(this.center.children, { y: 8, each: 0.025 });
  }
}
