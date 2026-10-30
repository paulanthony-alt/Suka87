export type ItemId =
  // infected drops
  | 'tissue' | 'plasma' | 'neural' | 'adrenal'
  // scavenged
  | 'cloth' | 'antiseptic' | 'chemicals' | 'scrap' | 'reagent' | 'vial' | 'sedative'
  // tools
  | 'bandage' | 'medkit' | 'antiviral' | 'frag' | 'flare' | 'lure'
  // cure components
  | 'antigen' | 'concentrate' | 'suppressant' | 'catalyst'
  // key items
  | 'keycard' | 'lockdownKey';

export type ItemCategory = 'drop' | 'material' | 'tool' | 'component' | 'key';

export interface ItemDef {
  id: ItemId;
  name: string;
  category: ItemCategory;
  icon: string;
  max: number;
  desc: string;
  source?: string;
}

const d = (id: ItemId, name: string, category: ItemCategory, icon: string, max: number, desc: string, source?: string): ItemDef => ({ id, name, category, icon, max, desc, source });

export const ITEMS: Record<ItemId, ItemDef> = {
  tissue: d('tissue', 'Infected tissue', 'drop', 'i-tissue', 20, 'Necrotic tissue carrying a live Suka 87 load. The base of every antigen culture.', 'Harvested from any infected'),
  plasma: d('plasma', 'Viral plasma', 'drop', 'i-plasma', 8, 'Pressurised viral fluid. Concentrated enough to culture from directly.', 'Bloaters'),
  neural: d('neural', 'Neural tissue', 'drop', 'i-neural', 6, 'Hyper-stimulated brainstem tissue. The key to suppressing the rage response.', 'Screamers'),
  adrenal: d('adrenal', 'Adrenal gland', 'drop', 'i-adrenal', 4, 'Overgrown gland flooding the host with hormones. Acts as a reaction catalyst.', 'Brutes'),

  cloth: d('cloth', 'Cloth', 'material', 'i-cloth', 10, 'Clean-ish linen and gauze.', 'Linen carts, wards'),
  antiseptic: d('antiseptic', 'Antiseptic', 'material', 'i-antiseptic', 8, 'Isopropyl alcohol and iodine.', 'Supply rooms'),
  chemicals: d('chemicals', 'Chemicals', 'material', 'i-chemicals', 8, 'Cleaning agents and solvents. Volatile when mixed.', 'Janitorial, maintenance'),
  scrap: d('scrap', 'Scrap', 'material', 'i-scrap', 10, 'Pipe offcuts, nails, wire.', 'Maintenance, storage'),
  reagent: d('reagent', 'Lab reagent', 'material', 'i-reagent', 8, 'Buffer solutions and culture media.', 'Pathology, labs'),
  vial: d('vial', 'Centrifuge vial', 'material', 'i-vial', 6, 'Sealed sample tubes rated for biohazard.', 'Pathology, labs'),
  sedative: d('sedative', 'Sedative', 'material', 'i-sedative', 6, 'Hospital-grade sedatives from the pharmacy.', 'Pharmacy'),

  bandage: d('bandage', 'Bandage', 'tool', 'i-bandage', 5, 'Restores 25 health over a few seconds.'),
  medkit: d('medkit', 'Medkit', 'tool', 'i-medkit', 3, 'Restores 70 health.'),
  antiviral: d('antiviral', 'Antiviral shot', 'tool', 'i-syringe', 3, 'Knocks Suka 87 exposure back by 35%. It will not stop it.'),
  frag: d('frag', 'Pipe grenade', 'tool', 'i-frag', 3, 'Improvised fragmentation charge. 2.5 s fuse.'),
  flare: d('flare', 'Flare', 'tool', 'i-flare', 4, 'Lights an area for 20 s. Infected are drawn to it.'),
  lure: d('lure', 'Noise lure', 'tool', 'i-lure', 4, 'A rigged alarm clock. Pulls infected away from you for 12 s.'),

  antigen: d('antigen', 'Stabilised antigen', 'component', 'i-antigen', 1, 'Inactivated Suka 87 culture. Teaches the body what to fight.'),
  concentrate: d('concentrate', 'Plasma concentrate', 'component', 'i-concentrate', 1, 'Centrifuged viral plasma. Carries the binding proteins.'),
  suppressant: d('suppressant', 'Neural suppressant', 'component', 'i-suppressant', 1, 'Stops the rage response before the immune system can work.'),
  catalyst: d('catalyst', 'Adrenal catalyst', 'component', 'i-catalyst', 1, 'Drives the synthesis reaction to completion.'),

  keycard: d('keycard', 'Security keycard', 'key', 'i-keycard', 1, 'Facilities access, level 2. Opens the stairwell doors.'),
  lockdownKey: d('lockdownKey', 'Override key', 'key', 'i-keycard', 1, 'Nurse station lockdown override.'),
};

export type Station = 'field' | 'lab';

export interface Recipe {
  id: string;
  output: ItemId;
  qty: number;
  inputs: [ItemId, number][];
  time: number;
  station: Station;
}

export const RECIPES: Recipe[] = [
  { id: 'bandage', output: 'bandage', qty: 1, inputs: [['cloth', 2]], time: 1.2, station: 'field' },
  { id: 'medkit', output: 'medkit', qty: 1, inputs: [['cloth', 1], ['antiseptic', 2]], time: 2, station: 'field' },
  { id: 'antiviral', output: 'antiviral', qty: 1, inputs: [['tissue', 2], ['antiseptic', 1]], time: 2, station: 'field' },
  { id: 'frag', output: 'frag', qty: 1, inputs: [['scrap', 2], ['chemicals', 2]], time: 2, station: 'field' },
  { id: 'flare', output: 'flare', qty: 1, inputs: [['chemicals', 1], ['scrap', 1]], time: 1.2, station: 'field' },
  { id: 'lure', output: 'lure', qty: 1, inputs: [['scrap', 2]], time: 1.2, station: 'field' },

  { id: 'antigen', output: 'antigen', qty: 1, inputs: [['tissue', 6], ['reagent', 2]], time: 4, station: 'lab' },
  { id: 'concentrate', output: 'concentrate', qty: 1, inputs: [['plasma', 3], ['vial', 1]], time: 4, station: 'lab' },
  { id: 'suppressant', output: 'suppressant', qty: 1, inputs: [['neural', 2], ['sedative', 2]], time: 4, station: 'lab' },
  { id: 'catalyst', output: 'catalyst', qty: 1, inputs: [['adrenal', 1], ['chemicals', 2]], time: 4, station: 'lab' },
];

export const CURE_COMPONENTS: ItemId[] = ['antigen', 'concentrate', 'suppressant', 'catalyst'];

export type AmmoId = '9mm' | '556' | '12ga' | '762';

export const AMMO: Record<AmmoId, { name: string; short: string; max: number }> = {
  '9mm': { name: '9 mm rounds', short: '9 mm', max: 180 },
  '556': { name: '5.56 mm rounds', short: '5.56 mm', max: 240 },
  '12ga': { name: '12 gauge shells', short: '12 ga', max: 40 },
  '762': { name: '7.62 mm rounds', short: '7.62 mm', max: 60 },
};

/** Tool wheel order. Quick slots 1–4 map to the first four. */
export const TOOL_ORDER: ItemId[] = ['antiviral', 'medkit', 'frag', 'flare', 'lure', 'bandage'];
