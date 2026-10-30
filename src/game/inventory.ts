import { AMMO, ITEMS, RECIPES, type AmmoId, type ItemId, type Recipe } from '../data/items';
import { WEAPONS, type FireMode, type WeaponId } from '../data/weapons';

export interface InventorySnapshot {
  items: Partial<Record<ItemId, number>>;
  ammo: Record<AmmoId, number>;
  weapons: WeaponId[];
  mags: Partial<Record<WeaponId, number>>;
  modes: Partial<Record<WeaponId, FireMode>>;
  current: WeaponId;
}

export class Inventory {
  items: Partial<Record<ItemId, number>> = {};
  ammo: Record<AmmoId, number> = { '9mm': 0, '556': 0, '12ga': 0, '762': 0 };
  weapons = new Set<WeaponId>();
  mags: Partial<Record<WeaponId, number>> = {};
  modes: Partial<Record<WeaponId, FireMode>> = {};
  current: WeaponId = 'axe';
  private listeners: (() => void)[] = [];

  onChange(fn: () => void) {
    this.listeners.push(fn);
  }
  private changed() {
    for (const f of this.listeners) f();
  }

  count(id: ItemId) {
    return this.items[id] ?? 0;
  }
  has(id: ItemId, n = 1) {
    return this.count(id) >= n;
  }
  space(id: ItemId) {
    return ITEMS[id].max - this.count(id);
  }
  /** Returns how many were actually taken (stack caps apply). */
  add(id: ItemId, n: number) {
    const take = Math.max(0, Math.min(n, this.space(id)));
    if (take > 0) {
      this.items[id] = this.count(id) + take;
      this.changed();
    }
    return take;
  }
  remove(id: ItemId, n = 1) {
    if (!this.has(id, n)) return false;
    this.items[id] = this.count(id) - n;
    this.changed();
    return true;
  }

  addAmmo(type: AmmoId, n: number) {
    const take = Math.max(0, Math.min(n, AMMO[type].max - this.ammo[type]));
    this.ammo[type] += take;
    if (take) this.changed();
    return take;
  }

  giveWeapon(id: WeaponId) {
    const isNew = !this.weapons.has(id);
    this.weapons.add(id);
    if (isNew) {
      this.mags[id] = WEAPONS[id].mag;
      this.modes[id] = WEAPONS[id].modes[0];
    }
    this.changed();
    return isNew;
  }

  canCraft(r: Recipe) {
    return r.inputs.every(([id, n]) => this.has(id, n)) && this.space(r.output) >= r.qty;
  }

  craft(r: Recipe) {
    if (!this.canCraft(r)) return false;
    for (const [id, n] of r.inputs) this.items[id] = this.count(id) - n;
    this.items[r.output] = this.count(r.output) + r.qty;
    this.changed();
    return true;
  }

  recipesFor(output: ItemId) {
    return RECIPES.filter((r) => r.output === output);
  }

  snapshot(): InventorySnapshot {
    return {
      items: { ...this.items },
      ammo: { ...this.ammo },
      weapons: [...this.weapons],
      mags: { ...this.mags },
      modes: { ...this.modes },
      current: this.current,
    };
  }

  restore(s: InventorySnapshot) {
    this.items = { ...s.items };
    this.ammo = { ...s.ammo };
    this.weapons = new Set(s.weapons);
    this.mags = { ...s.mags };
    this.modes = { ...s.modes };
    this.current = s.current;
    this.changed();
  }
}
