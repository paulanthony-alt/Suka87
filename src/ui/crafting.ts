import type { Game } from '../game/game';
import { CURE_COMPONENTS, ITEMS, RECIPES, TOOL_ORDER, type ItemId, type Recipe, type Station } from '../data/items';
import { icon } from './icons';
import { audio } from '../core/audio';

const DROPS: ItemId[] = ['tissue', 'plasma', 'neural', 'adrenal'];
const SUPPLIES: ItemId[] = ['cloth', 'antiseptic', 'chemicals', 'scrap', 'reagent', 'vial', 'sedative'];

/**
 * Field kit / lab station crafting screen. Field recipes work anywhere; cure components need a lab
 * station. The bottom strip tracks the four components the synthesiser needs.
 */
export class CraftingPanel {
  private root: HTMLElement;
  open = false;
  station: Station = 'field';
  private selected: Recipe = RECIPES[0];
  private crafting: { r: Recipe; t: number } | null = null;
  private raf = 0;
  private holdSpace = false;
  private holdMouse = false;

  constructor(private game: Game, parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'craft hidden';
    parent.appendChild(this.root);
    this.root.addEventListener('mousedown', (e) => {
      const t = e.target as HTMLElement;
      const row = t.closest('[data-recipe]') as HTMLElement | null;
      if (row) {
        const r = RECIPES.find((x) => x.id === row.dataset.recipe);
        if (r) {
          this.selected = r;
          audio.ui('tick');
          this.render();
        }
      }
      if (t.closest('.craft-btn')) this.holdMouse = true;
      if (t.closest('.craft-close')) this.game.closeCrafting();
    });
    window.addEventListener('mouseup', () => (this.holdMouse = false));
    window.addEventListener('keydown', (e) => {
      if (!this.open) return;
      if (e.code === 'Tab' || e.code === 'Escape') {
        e.preventDefault();
        if (!e.repeat) this.game.closeCrafting();
      }
      if (e.code === 'Space') {
        e.preventDefault();
        this.holdSpace = true;
      }
      if (e.code === 'KeyW' || e.code === 'ArrowUp' || e.code === 'KeyS' || e.code === 'ArrowDown') {
        const list = this.visibleRecipes();
        const i = list.indexOf(this.selected);
        const ni = (i + (e.code === 'KeyW' || e.code === 'ArrowUp' ? -1 : 1) + list.length) % list.length;
        this.selected = list[ni];
        audio.ui('tick');
        this.render();
      }
    });
    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space') this.holdSpace = false;
    });
  }

  private visibleRecipes() {
    return RECIPES;
  }

  show(station: Station) {
    this.station = station;
    this.open = true;
    this.root.classList.remove('hidden');
    requestAnimationFrame(() => this.root.classList.add('in'));
    audio.ui('open');
    if (station === 'lab' && this.selected.station !== 'lab') {
      this.selected = RECIPES.find((r) => r.station === 'lab' && !this.game.inventory.has(r.output)) ?? RECIPES.find((r) => r.station === 'lab')!;
    }
    this.render();
    let last = performance.now();
    const tick = (now: number) => {
      if (!this.open) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      this.tick(dt);
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  hide() {
    if (!this.open) return;
    this.open = false;
    this.crafting = null;
    this.holdMouse = this.holdSpace = false;
    cancelAnimationFrame(this.raf);
    this.root.classList.remove('in');
    this.root.classList.add('hidden');
    audio.ui('close');
  }

  refresh() {
    if (this.open) this.render();
  }

  private canUse(r: Recipe) {
    return r.station === 'field' || this.station === 'lab';
  }

  private tick(dt: number) {
    const r = this.selected;
    const inv = this.game.inventory;
    const holding = this.holdMouse || this.holdSpace;
    if (holding && this.canUse(r) && inv.canCraft(r)) {
      if (!this.crafting || this.crafting.r !== r) this.crafting = { r, t: 0 };
      this.crafting.t += dt;
      if (this.crafting.t >= r.time) {
        inv.craft(r);
        this.game.stats.crafted++;
        audio.ui('craft');
        this.game.hud.pickup(ITEMS[r.output].icon, ITEMS[r.output].name, r.qty, r.station === 'lab');
        this.crafting = null;
        this.holdMouse = false;
        this.holdSpace = false;
        if (r.station === 'lab' && this.game.objectives.componentsReady()) this.game.hint('allcomponents', 'That\'s all four. Bring them to the synthesiser.');
        this.render();
      }
    } else this.crafting = null;
    const fill = this.root.querySelector('.craft-btn .fill') as HTMLElement | null;
    if (fill) fill.style.width = `${this.crafting ? (this.crafting.t / r.time) * 100 : 0}%`;
  }

  private render() {
    const inv = this.game.inventory;
    const mat = (id: ItemId) => {
      const n = inv.count(id);
      return `<div class="mat ${n ? '' : 'none'}">${icon(ITEMS[id].icon, 26)}<span class="mname">${ITEMS[id].name}</span><span class="mcount">${n}<i>/${ITEMS[id].max}</i></span></div>`;
    };
    const row = (r: Recipe) => {
      const can = this.canUse(r) && inv.canCraft(r);
      const locked = !this.canUse(r);
      return `<div class="rrow ${r === this.selected ? 'sel' : ''} ${can ? 'can' : ''} ${locked ? 'locked' : ''}" data-recipe="${r.id}">
        ${icon(ITEMS[r.output].icon, 30)}<span class="rname">${ITEMS[r.output].name}</span>
        <span class="rhave">${locked ? 'Lab' : inv.count(r.output) ? `×${inv.count(r.output)}` : ''}</span></div>`;
    };
    const s = this.selected;
    const usable = this.canUse(s);
    const can = usable && inv.canCraft(s);
    const full = inv.space(s.output) < s.qty;
    const reqs = s.inputs
      .map(([id, n]) => {
        const have = inv.count(id);
        return `<div class="req ${have >= n ? 'ok' : 'miss'}">${icon(ITEMS[id].icon, 28)}<span class="qname">${ITEMS[id].name}</span><span class="qsrc">${ITEMS[id].source ?? ''}</span><span class="qn">${have}<i>/${n}</i></span></div>`;
      })
      .join('');
    const status = !usable ? 'Requires a lab station' : full ? 'You can\'t carry more' : can ? `Hold <b>Space</b> or the button · ${s.time.toFixed(1)} s` : 'Missing ingredients';

    const comp = CURE_COMPONENTS.map((c) => {
      const r = RECIPES.find((x) => x.output === c)!;
      const done = inv.has(c);
      const ready = !done && r.inputs.every(([id, n]) => inv.has(id, n));
      const parts = r.inputs.map(([id, n]) => `<span class="${inv.has(id, n) ? 'ok' : ''}">${ITEMS[id].name} ${Math.min(inv.count(id), n)}/${n}</span>`).join('');
      return `<div class="comp ${done ? 'done' : ready ? 'ready' : ''}" data-recipe="${r.id}">${icon(ITEMS[c].icon, 34)}<div><div class="cname">${ITEMS[c].name}</div><div class="cparts">${done ? '<span class="ok">Prepared</span>' : parts}</div></div></div>`;
    }).join('');

    const tools = TOOL_ORDER.map((t) => `<div class="tool ${inv.count(t) ? '' : 'none'}">${icon(ITEMS[t].icon, 26)}<span>×${inv.count(t)}</span></div>`).join('');

    this.root.innerHTML = `
      <div class="craft-inner">
        <header>
          <div>
            <div class="eyebrow">${this.station === 'lab' ? 'Lab station' : 'Field kit'}</div>
            <h1>${this.station === 'lab' ? 'Culture &amp; synthesis' : 'Crafting'}</h1>
          </div>
          <div class="craft-tools">${tools}</div>
          <div class="craft-close"><span>Tab</span> Close</div>
        </header>
        <section class="cols">
          <div class="col mats">
            <h2>Infected samples</h2>${DROPS.map(mat).join('')}
            <h2>Supplies</h2>${SUPPLIES.map(mat).join('')}
          </div>
          <div class="col recipes">
            <h2>Field recipes</h2>${RECIPES.filter((r) => r.station === 'field').map(row).join('')}
            <h2>Cure components ${this.station === 'lab' ? '' : '<em>· lab station</em>'}</h2>${RECIPES.filter((r) => r.station === 'lab').map(row).join('')}
          </div>
          <div class="col detail">
            <div class="dhead">${icon(ITEMS[s.output].icon, 64)}<div><div class="dname">${ITEMS[s.output].name}</div><div class="ddesc">${ITEMS[s.output].desc}</div></div></div>
            <h2>Requires</h2>${reqs}
            <div class="craft-btn ${can ? '' : 'off'}"><div class="fill"></div><span>Craft${s.qty > 1 ? ` ×${s.qty}` : ''}</span></div>
            <div class="dstatus">${status}</div>
          </div>
        </section>
        <section class="cure-strip">
          <div class="cs-title">Suka 87 cure<span>${CURE_COMPONENTS.filter((c) => inv.has(c)).length}/4 components · synthesise in the BSL-3 virology lab</span></div>
          <div class="cs-row">${comp}</div>
        </section>
      </div>`;
  }
}
