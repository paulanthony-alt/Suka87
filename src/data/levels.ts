import { MapBuilder, type BuiltMap } from '../world/mapbuilder';
import type { InfectedKind } from './infected';
import type { ItemId } from './items';
import type { WeaponId } from './weapons';

export type Action =
  | { say: string; who?: string; delay?: number }
  | { horde: number; over: number; kinds?: InfectedKind[]; delay?: number }
  | { power: boolean }
  | { flag: string }
  | { synthesis: number };

export interface ObjectiveDef {
  id: string;
  title: string;
  detail: string;
  /** where the compass marker points */
  target?: { kind: 'terminal' | 'key' | 'weapon' | 'exit' | 'synth' | 'boss' | 'station'; id?: string };
  /** event that completes it: 'weapon:<id>', 'interact:<id>', 'pickup:<item>', 'kill:boss', 'exit', 'components', 'synth' */
  complete: string;
  onStart?: Action[];
  onComplete?: Action[];
}

export interface LevelDef {
  id: string;
  wave: number;
  title: string;
  area: string;
  zone: number;
  /** in-game clock at level start, minutes past midnight on day 3 */
  clock: number;
  briefing: string;
  map: BuiltMap;
  powered: boolean;
  /** weights for 'z' placements and ambient spawns */
  mix: [InfectedKind, number][];
  /** flag that opens 'L' doors and the exit */
  exitFlag?: string;
  exitLabel: string;
  exitLockedText: string;
  objectives: ObjectiveDef[];
  onEnter?: Record<string, Action[]>;
}

const VOSS = 'Voss';

// ------------------------------------------------------------------------------------------------
// WAVE 1 — Sub-Level B2: Morgue & plant. Lights are out; only emergency lamps and the flashlight.
function level1(): LevelDef {
  const m = new MapBuilder(46, 26);
  m.room('Morgue', 1, 1, 8, 7, 'tile', 'emergency', 5)
    .put('m', [1, 1], [2, 1], [3, 1], [6, 1], [7, 1], [8, 1])
    .put('g', [2, 3], [2, 5], [7, 3], [7, 5])
    .put('P', [4, 6])
    .put('2', [8, 7])
    .put('z', [7, 7])
    .door(9, 4);
  m.room('Service corridor', 10, 1, 2, 15, 'concrete', 'emergency', 6);
  m.room('Security post', 13, 1, 9, 5, 'ward', 'emergency', 6)
    .door(12, 3)
    .put('t', [15, 1], [19, 1])
    .put('c', [21, 1], [13, 5])
    .put('1', [20, 4])
    .put('2', [14, 4])
    .weapon(17, 2, 'pistol');
  m.room('Central supply', 13, 7, 9, 6, 'concrete', 'emergency', 6)
    .door(12, 9)
    .put('s', [17, 7], [18, 7], [19, 7])
    .put('k', [14, 8], [15, 8], [21, 11], [21, 12])
    .put('3', [16, 10], [20, 8])
    .put('2', [13, 12])
    .put('z', [18, 10]);
  m.room('Plant corridor', 10, 14, 31, 2, 'concrete', 'emergency', 7)
    .put('z', [24, 15], [31, 14]);
  m.room('Plant room', 23, 1, 12, 12, 'concrete', 'normal', 4)
    .door(28, 13)
    .terminal(28, 6, 'generator', 'Start the backup generator', 4, 'generator')
    .put('p', [24, 2], [24, 4], [33, 2], [33, 4])
    .put('o', [31, 11], [32, 11], [24, 11])
    .put('k', [33, 12])
    .put('3', [25, 8])
    .put('1', [33, 7])
    .put('z', [26, 9], [31, 7])
    .put('S', [34, 12]);
  m.room('Medical records', 1, 10, 8, 12, 'ward', 'flicker', 5)
    .door(9, 15)
    .put('c', [1, 11], [1, 13], [1, 17])
    .put('t', [4, 13], [6, 13], [4, 17], [6, 17])
    .put('2', [8, 20])
    .put('3', [3, 20])
    .put('z', [5, 15])
    .put('S', [1, 21]);
  m.room('Laundry', 13, 17, 13, 7, 'tile', 'normal', 5)
    .door(18, 16)
    .put('q', [21, 17], [23, 17], [25, 17], [13, 20], [13, 22])
    .put('k', [24, 22])
    .put('3', [16, 22], [22, 20])
    .put('z', [17, 20], [23, 21])
    .put('S', [25, 23]);
  m.room('Loading dock', 27, 17, 17, 7, 'concrete', 'normal', 5)
    .door(26, 20)
    .door(33, 16)
    .put('o', [28, 18], [29, 18])
    .put('k', [42, 18], [42, 19], [41, 23])
    .put('1', [38, 20])
    .put('2', [30, 22])
    .put('z', [35, 21], [40, 19])
    .put('S', [43, 23]);
  m.room('Elevator lobby', 36, 1, 9, 12, 'ward', 'normal', 4)
    .door(40, 13)
    .put('E', [40, 1])
    .put('r', [37, 6], [37, 8])
    .put('v', [44, 5])
    .put('2', [43, 11])
    .put('z', [38, 9]);

  return {
    id: 'b2', wave: 1, title: 'Sub-Level B2', area: 'Morgue & Plant', zone: 1, clock: 72,
    briefing: 'Day 3 of the Suka 87 outbreak. St. Brendan\'s went dark at midnight. You came down to the morgue for supplies and the lights died behind you. Dr. Elena Voss is alive in the research wing — and she says the cure can still be made.',
    map: m.build(),
    powered: false,
    mix: [['shambler', 7], ['runner', 2]],
    exitFlag: 'power',
    exitLabel: 'Take the service elevator',
    exitLockedText: 'No power',
    objectives: [
      {
        id: 'arm', title: 'Find a firearm', detail: 'The security post is across the service corridor.',
        target: { kind: 'weapon', id: 'pistol' }, complete: 'weapon:pistol',
        onStart: [
          { say: 'If you can hear this, you\'re in the morgue. Don\'t shout. They hunt by sound.', who: VOSS, delay: 1.5 },
          { say: 'Security keeps a sidearm across the corridor. Take it.', who: VOSS, delay: 5 },
        ],
      },
      {
        id: 'power', title: 'Restore power', detail: 'Start the backup generator in the plant room.',
        target: { kind: 'terminal', id: 'generator' }, complete: 'interact:generator',
        onStart: [{ say: 'The elevator\'s dead without power. Generator\'s in the plant room, east of you.', who: VOSS }],
        onComplete: [
          { power: true },
          { flag: 'power' },
          { say: 'Lights are back. And that noise just rang the dinner bell. Move!', who: VOSS, delay: 0.6 },
          { horde: 7, over: 22, kinds: ['shambler', 'runner'], delay: 2 },
        ],
      },
      {
        id: 'exit', title: 'Reach the service elevator', detail: 'North-east lobby. Take it up to B1.',
        target: { kind: 'exit' }, complete: 'exit',
      },
    ],
    onEnter: {
      'Plant room': [{ say: 'Generator panel should be in the middle of the room. It\'ll be loud.', who: VOSS }],
    },
  };
}

// ------------------------------------------------------------------------------------------------
// WAVE 2 — Sub-Level B1: Boiler, linen processing, workshop. Bloaters appear.
function level2(): LevelDef {
  const m = new MapBuilder(46, 26);
  m.room('Service elevator', 1, 9, 6, 7, 'ward', 'flicker', 4)
    .put('P', [3, 12])
    .put('2', [6, 15])
    .door(7, 12);
  m.room('Utility corridor', 8, 2, 2, 22, 'concrete', 'normal', 6)
    .put('S', [8, 23]);
  m.room('Boiler room', 11, 2, 14, 9, 'concrete', 'normal', 5)
    .door(10, 6)
    .door(25, 10)
    .put('p', [13, 4], [17, 4], [21, 4])
    .put('o', [23, 9], [24, 9], [11, 10])
    .put('3', [12, 9])
    .put('1', [24, 6])
    .put('B', [18, 8])
    .put('z', [22, 6])
    .put('S', [24, 2]);
  m.room('Linen processing', 11, 12, 14, 11, 'tile', 'normal', 5)
    .door(10, 17)
    .door(18, 11)
    .put('q', [12, 12], [14, 12], [21, 12], [23, 12])
    .put('k', [24, 18], [24, 19])
    .put('3', [13, 20], [22, 22])
    .put('2', [12, 22])
    .put('z', [15, 16], [19, 19], [22, 15])
    .put('R', [20, 21])
    .put('S', [24, 22]);
  m.room('Maintenance office', 26, 2, 8, 7, 'ward', 'flicker', 4)
    .door(25, 5)
    .door(29, 9)
    .put('t', [28, 2], [32, 2])
    .put('c', [33, 8], [26, 8])
    .put('1', [33, 4])
    .put('B', [31, 6])
    .key(30, 2, 'keycard', 1, 'Facilities keycard')
    .weapon(28, 7, 'shotgun');
  m.room('East service corridor', 26, 10, 18, 2, 'concrete', 'normal', 6)
    .locked(39, 9)
    .put('z', [35, 11]);
  m.room('Workshop', 26, 13, 9, 10, 'concrete', 'normal', 5)
    .door(30, 12)
    .door(35, 18)
    .put('w', [27, 13], [28, 13])
    .put('s', [34, 14], [34, 15])
    .put('3', [27, 18], [31, 22], [33, 16])
    .put('z', [29, 17])
    .put('R', [32, 20])
    .put('S', [26, 22])
    .weapon(33, 22, 'smg');
  m.room('Electrical', 36, 13, 8, 10, 'concrete', 'flicker', 5)
    .door(39, 12)
    .put('o', [37, 14], [38, 14])
    .put('k', [43, 13], [43, 14])
    .put('1', [41, 21])
    .put('2', [37, 21])
    .put('z', [40, 16])
    .put('B', [42, 19])
    .put('S', [43, 22]);
  m.room('Stairwell A', 36, 2, 8, 7, 'ward', 'emergency', 4)
    .put('E', [40, 2])
    .put('z', [38, 5], [42, 6]);

  return {
    id: 'b1', wave: 2, title: 'Sub-Level B1', area: 'Maintenance & Linen', zone: 2, clock: 96,
    briefing: 'The elevator gave out one floor up. B1 is the hospital\'s engine room — boilers, laundry, workshops. Something in the infected is changing: Voss has reports of swollen carriers that rupture into a viral mist.',
    map: m.build(),
    powered: true,
    mix: [['shambler', 5], ['runner', 3], ['bloater', 0.7]],
    exitFlag: 'keycard',
    exitLabel: 'Take Stairwell A up',
    exitLockedText: 'Requires facilities keycard',
    objectives: [
      {
        id: 'card', title: 'Get the facilities keycard', detail: 'Maintenance office, past the boiler room.',
        target: { kind: 'key', id: 'keycard' }, complete: 'pickup:keycard',
        onStart: [
          { say: 'Elevator\'s jammed. Stairwell A is on your floor, east side, but security locked it.', who: VOSS, delay: 1.5 },
          { say: 'Facilities keycard. Maintenance office, past the boilers.', who: VOSS, delay: 6 },
        ],
        onComplete: [
          { flag: 'keycard' },
          { say: 'Card\'s live. The stairwell door alarm will go when you badge it — be ready.', who: VOSS, delay: 0.5 },
          { horde: 8, over: 25, kinds: ['shambler', 'runner', 'runner'], delay: 3 },
        ],
      },
      {
        id: 'exit', title: 'Unlock Stairwell A', detail: 'East service corridor, then up to the ground floor.',
        target: { kind: 'exit' }, complete: 'exit',
      },
    ],
    onEnter: {
      'Boiler room': [{ say: 'See the swollen one? Don\'t pop it up close. Plasma from those is exactly what I need, though.', who: VOSS }],
      Workshop: [{ say: 'Workshop. Scrap and solvent — enough to rig a pipe grenade. Check your field kit.', who: VOSS }],
    },
  };
}

// ------------------------------------------------------------------------------------------------
// WAVE 3 — Ground floor: Emergency Department. Screamers appear.
function level3(): LevelDef {
  const m = new MapBuilder(46, 28);
  m.room('Stairwell A', 1, 1, 5, 5, 'ward', 'emergency', 4)
    .put('P', [3, 3])
    .door(6, 3);
  m.room('Staff corridor', 7, 1, 2, 20, 'ward', 'normal', 6);
  m.room('Triage', 10, 1, 14, 6, 'ward', 'normal', 5)
    .door(9, 3)
    .put('b', [11, 1], [14, 1], [17, 1], [20, 1], [23, 1])
    .put('c', [23, 6])
    .put('2', [12, 5], [21, 4])
    .put('z', [14, 3], [19, 2], [22, 5]);
  m.room('Staff lockers', 1, 8, 5, 12, 'ward', 'flicker', 5)
    .door(6, 14)
    .put('c', [1, 9], [1, 11], [1, 13], [5, 9])
    .put('2', [4, 18])
    .put('3', [1, 18])
    .put('z', [3, 15])
    .put('S', [1, 19]);
  m.room('ER waiting room', 10, 8, 20, 10, 'ward', 'normal', 4)
    .door(9, 12)
    .door(16, 7)
    .locked(30, 10)
    .put('r', [13, 10], [14, 10], [15, 10], [13, 13], [14, 13], [15, 13], [19, 10], [20, 10], [21, 10], [19, 13], [20, 13], [21, 13])
    .put('v', [29, 8], [29, 9])
    .put('t', [24, 15], [25, 15], [26, 15])
    .put('3', [11, 16])
    .put('z', [12, 11], [17, 12], [22, 15], [27, 12], [18, 16])
    .put('R', [23, 9], [11, 15])
    .put('C', [26, 10])
    .put('S', [10, 17], [29, 17]);
  m.room('Nurses\' station', 25, 1, 9, 6, 'ward', 'normal', 4)
    .door(28, 7)
    .terminal(29, 1, 'lockdown', 'Override the ER lockdown', 5, 'console')
    .put('t', [26, 2], [27, 2], [31, 2], [32, 2])
    .put('c', [33, 1])
    .put('2', [26, 6])
    .put('z', [30, 4]);
  m.room('Radiology', 35, 1, 9, 6, 'ward', 'flicker', 4)
    .door(34, 4)
    .put('l', [38, 3], [39, 3])
    .put('c', [43, 1])
    .put('4', [36, 1], [43, 6])
    .put('3', [41, 6])
    .put('C', [41, 3])
    .put('z', [37, 5]);
  m.room('ER security', 11, 19, 8, 6, 'ward', 'normal', 4)
    .door(14, 18)
    .put('t', [12, 20], [13, 20])
    .put('c', [18, 24], [11, 24])
    .put('1', [16, 24], [12, 22])
    .put('z', [15, 22])
    .weapon(17, 20, 'rifle');
  m.room('Ambulance bay', 20, 19, 16, 7, 'concrete', 'normal', 5)
    .door(24, 18)
    .put('k', [34, 19], [35, 19], [35, 20], [21, 25])
    .put('o', [28, 25], [29, 25])
    .put('3', [33, 23], [22, 20])
    .put('1', [30, 21])
    .put('z', [26, 22], [32, 24])
    .put('R', [29, 20])
    .put('B', [27, 23])
    .put('S', [35, 25]);
  m.room('East wing approach', 31, 9, 13, 3, 'ward', 'normal', 4)
    .put('E', [43, 10])
    .put('2', [36, 11])
    .put('z', [38, 10], [41, 9]);

  return {
    id: 'er', wave: 3, title: 'Ground Floor', area: 'Emergency Department', zone: 3, clock: 131,
    briefing: 'The Emergency Department is where Suka 87 came through the doors three days ago. It\'s under a hard lockdown. Voss warns of a new strain: carriers whose cries pull every infected in earshot.',
    map: m.build(),
    powered: true,
    mix: [['shambler', 4], ['runner', 4], ['bloater', 0.8], ['screamer', 0.7]],
    exitFlag: 'lockdown',
    exitLabel: 'Enter the East Wing',
    exitLockedText: 'Lockdown shutters are down',
    objectives: [
      {
        id: 'lockdown', title: 'Override the ER lockdown', detail: 'The nurses\' station console controls the shutters.',
        target: { kind: 'terminal', id: 'lockdown' }, complete: 'interact:lockdown',
        onStart: [
          { say: 'You\'re in the ER. The shutters to the East Wing are on lockdown.', who: VOSS, delay: 1.5 },
          { say: 'Nurses\' station console can override it. North side of the waiting room.', who: VOSS, delay: 6 },
        ],
        onComplete: [
          { flag: 'lockdown' },
          { say: 'Shutters are cycling. That klaxon will bring the whole floor down on you.', who: VOSS, delay: 0.5 },
          { horde: 12, over: 30, kinds: ['shambler', 'runner', 'runner', 'screamer'], delay: 2 },
        ],
      },
      {
        id: 'exit', title: 'Get to the East Wing', detail: 'Through the shutters, east of the waiting room.',
        target: { kind: 'exit' }, complete: 'exit',
      },
    ],
    onEnter: {
      'ER security': [{ say: 'ER security kept a rifle. If it\'s still there, take it.', who: VOSS }],
      Radiology: [{ say: 'Radiology. Grab any reagents or vials you see. I\'ll need them for the antigen.', who: VOSS }],
    },
  };
}

// ------------------------------------------------------------------------------------------------
// WAVE 4 — East Wing: Pharmacy, pathology, ICU. Brutes appear; Patient Zero is in isolation.
function level4(): LevelDef {
  const m = new MapBuilder(46, 28);
  m.room('East Wing entrance', 1, 11, 5, 4, 'ward', 'flicker', 4)
    .put('P', [2, 12])
    .put('2', [5, 14]);
  m.room('East Wing corridor', 6, 12, 36, 2, 'ward', 'normal', 5)
    .put('E', [41, 12])
    .put('z', [16, 12], [27, 13], [35, 12]);
  m.room('Pharmacy', 8, 2, 12, 9, 'ward', 'normal', 4)
    .door(13, 11)
    .put('s', [10, 4], [11, 4], [12, 4], [14, 4], [15, 4], [16, 4], [10, 7], [11, 7], [12, 7], [14, 7], [15, 7], [16, 7])
    .put('t', [18, 9], [19, 9])
    .put('2', [9, 9], [17, 2])
    .put('z', [13, 6], [9, 3])
    .put('R', [17, 8])
    .put('S', [19, 2])
    .key(11, 2, 'sedative', 2, 'Sedatives')
    .key(13, 9, 'sedative', 1, 'Sedatives');
  m.room('Narcotics vault', 21, 2, 5, 5, 'ward', 'flicker', 4)
    .door(20, 4)
    .put('s', [25, 2])
    .put('1', [25, 6])
    .weapon(24, 4, 'dmr');
  m.room('Pathology', 27, 2, 10, 9, 'lab', 'normal', 4)
    .door(31, 11)
    .put('x', [29, 2])
    .put('l', [28, 6], [29, 6], [33, 6], [34, 6])
    .put('f', [36, 2])
    .put('4', [27, 10], [34, 9], [32, 2])
    .put('z', [31, 8])
    .put('C', [35, 4]);
  m.room('Staff room', 38, 2, 6, 9, 'ward', 'flicker', 4)
    .door(40, 11)
    .put('v', [43, 2])
    .put('t', [40, 5], [41, 5])
    .put('r', [38, 8])
    .put('2', [43, 9])
    .put('3', [38, 2])
    .put('z', [41, 7]);
  m.room('Intensive care', 8, 15, 22, 10, 'ward', 'normal', 4)
    .door(12, 14)
    .door(24, 14)
    .door(30, 20)
    .put('b', [9, 16], [13, 16], [17, 16], [21, 16], [9, 23], [13, 23], [17, 23], [21, 23])
    .put('c', [29, 15])
    .put('2', [27, 24], [11, 20])
    .put('3', [19, 20])
    .put('z', [12, 19], [20, 21], [25, 18])
    .put('R', [16, 20], [26, 22])
    .put('B', [22, 19])
    .put('S', [8, 24], [29, 24]);
  m.room('ICU isolation', 31, 15, 10, 10, 'lab', 'flicker', 4)
    .put('b', [39, 16])
    .put('l', [32, 24], [33, 24])
    .put('2', [40, 24])
    .put('1', [31, 15])
    .put('4', [36, 24])
    .put('0', [37, 20]);

  return {
    id: 'east', wave: 4, title: 'East Wing', area: 'Pharmacy & ICU', zone: 4, clock: 158,
    briefing: 'The East Wing holds what Voss needs: sedatives for the neural suppressant, and the man the outbreak started with. Patient Zero has been in ICU isolation for three days. He is no longer a patient.',
    map: m.build(),
    powered: true,
    mix: [['shambler', 3], ['runner', 4], ['bloater', 1], ['screamer', 0.8], ['brute', 0.35]],
    exitFlag: 'patientZero',
    exitLabel: 'Cross the skybridge',
    exitLockedText: 'Skybridge sealed — Voss won\'t open it yet',
    objectives: [
      {
        id: 'pharmacy', title: 'Loot the pharmacy', detail: 'Sedatives for the neural suppressant.',
        target: { kind: 'key', id: 'sedative' }, complete: 'pickup:sedative',
        onStart: [
          { say: 'Pharmacy is the first door on your left. I need sedatives — two at least.', who: VOSS, delay: 1.5 },
        ],
      },
      {
        id: 'zero', title: 'Find Patient Zero', detail: 'ICU isolation, through intensive care.',
        target: { kind: 'boss' }, complete: 'kill:boss',
        onStart: [
          { say: 'Patient Zero is in isolation. His adrenal glands are three times normal size. That\'s our catalyst.', who: VOSS, delay: 1 },
          { say: 'Pathology has a lab station if you want to start preparing components.', who: VOSS, delay: 7 },
        ],
        onComplete: [
          { flag: 'patientZero' },
          { say: 'He\'s down. Take the gland and get to the skybridge — I\'m opening it now.', who: VOSS, delay: 1 },
          { horde: 9, over: 25, kinds: ['runner', 'runner', 'shambler', 'brute'], delay: 4 },
        ],
      },
      {
        id: 'exit', title: 'Cross the skybridge', detail: 'East end of the corridor, to the research wing.',
        target: { kind: 'exit' }, complete: 'exit',
      },
    ],
    onEnter: {
      Pathology: [{ say: 'That\'s a lab station. You can culture cure components there.', who: VOSS }],
      'ICU isolation': [{ say: 'Careful. He\'s bigger than the others. Go for the head.', who: VOSS }],
    },
  };
}

// ------------------------------------------------------------------------------------------------
// WAVE 5 — Research wing: virology BSL-3. Synthesise the cure and hold out.
function level5(): LevelDef {
  const m = new MapBuilder(46, 28);
  m.room('Skybridge', 1, 12, 6, 3, 'lab', 'flicker', 3)
    .put('P', [2, 13])
    .door(7, 13);
  m.room('Research atrium', 8, 8, 14, 12, 'lab', 'normal', 4)
    .door(14, 7)
    .door(14, 20)
    .door(22, 13)
    .put('r', [10, 10], [11, 10], [10, 17], [11, 17])
    .put('t', [17, 10], [18, 10])
    .put('2', [21, 8])
    .put('3', [8, 19])
    .put('z', [12, 13], [17, 15], [20, 11])
    .put('R', [15, 18], [19, 17])
    .put('C', [18, 13]);
  m.room('Cell culture lab', 8, 1, 14, 6, 'lab', 'normal', 4)
    .put('x', [10, 1])
    .put('l', [12, 4], [13, 4], [17, 4], [18, 4])
    .put('f', [21, 1])
    .put('4', [8, 6], [15, 1], [20, 6])
    .put('z', [15, 3])
    .put('B', [19, 5]);
  m.room('Cold storage', 8, 21, 14, 6, 'lab', 'flicker', 4)
    .put('s', [9, 26], [10, 26], [11, 26], [17, 26], [18, 26])
    .put('k', [21, 21], [21, 22])
    .put('x', [8, 23])
    .put('4', [13, 26], [20, 25])
    .put('2', [15, 26])
    .put('U', [15, 23])
    .put('B', [11, 22]);
  m.room('BSL-3 corridor', 23, 12, 7, 3, 'lab', 'normal', 3)
    .terminal(28, 12, 'airlock', 'Cycle the BSL-3 airlock', 3, 'airlock')
    .locked(30, 13);
  m.room('Voss\' office', 23, 1, 7, 10, 'lab', 'flicker', 4)
    .door(26, 11)
    .put('t', [24, 2], [25, 2])
    .put('c', [29, 1], [29, 3])
    .put('2', [23, 9])
    .put('1', [28, 9])
    .put('3', [24, 6])
    .put('z', [27, 6]);
  m.room('Animal research', 23, 16, 7, 10, 'lab', 'emergency', 4)
    .door(26, 15)
    .put('k', [23, 18], [23, 20], [23, 22], [29, 18], [29, 20])
    .put('4', [29, 25])
    .put('1', [24, 25])
    .put('R', [26, 21], [27, 24])
    .put('C', [25, 23]);
  m.room('Virology lab BSL-3', 31, 4, 14, 20, 'lab', 'normal', 4)
    .put('y', [39, 13])
    .put('x', [32, 4], [44, 10])
    .put('l', [34, 8], [35, 8], [34, 18], [35, 18], [42, 18], [43, 18])
    .put('f', [37, 4], [41, 4])
    .put('4', [44, 5], [31, 23])
    .put('2', [44, 23], [36, 13])
    .put('1', [38, 23], [33, 13])
    .put('S', [44, 4], [44, 22], [32, 23]);

  return {
    id: 'lab', wave: 5, title: 'Research Wing', area: 'Virology BSL-3', zone: 5, clock: 189,
    briefing: 'The research wing. Voss is sealed inside the BSL-3 virology lab with the only synthesiser in the city. Bring her everything. Once the synthesis starts, it cannot be stopped — and the infected will come for the noise.',
    map: m.build(),
    powered: true,
    mix: [['shambler', 3], ['runner', 4], ['bloater', 1.2], ['screamer', 1], ['brute', 0.5]],
    exitFlag: 'airlock',
    exitLabel: '',
    exitLockedText: '',
    objectives: [
      {
        id: 'airlock', title: 'Reach the virology lab', detail: 'Cycle the BSL-3 airlock at the end of the corridor.',
        target: { kind: 'terminal', id: 'airlock' }, complete: 'interact:airlock',
        onStart: [
          { say: 'You made it. I\'m behind the glass in BSL-3. Cycle the airlock and come in.', who: VOSS, delay: 1.5 },
        ],
        onComplete: [{ flag: 'airlock' }, { say: 'Airlock open. Welcome to the end of the world.', who: VOSS, delay: 0.5 }],
      },
      {
        id: 'components', title: 'Prepare the cure components', detail: 'Culture all four at a lab station.',
        target: { kind: 'station' }, complete: 'components',
        onStart: [{ say: 'Four components: antigen, plasma concentrate, neural suppressant, adrenal catalyst. Use the lab stations.', who: VOSS, delay: 1 }],
      },
      {
        id: 'synth', title: 'Synthesise the Suka 87 cure', detail: 'Load the synthesiser and hold the lab.',
        target: { kind: 'synth' }, complete: 'synth',
        onStart: [{ say: 'Everything\'s ready. Load the synthesiser. Ninety seconds. Keep them off it.', who: VOSS, delay: 0.5 }],
      },
    ],
    onEnter: {
      'Cold storage': [{ say: 'Cold storage. There\'s a big one in there. Brutes carry adrenal glands too.', who: VOSS }],
    },
  };
}

export const LEVELS: LevelDef[] = [level1(), level2(), level3(), level4(), level5()];

export const STARTING_LOADOUT = {
  weapons: ['axe'] as WeaponId[],
  ammo: { '9mm': 0, '556': 0, '12ga': 0, '762': 0 },
  items: { bandage: 1, cloth: 1 } as Partial<Record<ItemId, number>>,
};
