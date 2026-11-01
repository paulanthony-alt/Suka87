/**
 * SVG symbol sprite. Line icons follow the HUD spec: 48×48, 2.5 px square-capped strokes.
 * Weapon silhouettes are 200×80 solid fills.
 */
const S = (id: string, body: string) =>
  `<symbol id="${id}" viewBox="0 0 48 48"><g fill="none" stroke="currentColor" stroke-width="2.5" stroke-linejoin="miter" stroke-linecap="square">${body}</g></symbol>`;
const W = (id: string, body: string) => `<symbol id="${id}" viewBox="0 0 200 80"><g fill="currentColor">${body}</g></symbol>`;

const SPRITE = `
<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
${W('w-rifle', `
  <path d="M6 33 L38 29 H44 V47 H38 L10 53 Q5 53 5 49 Z"/><path d="M12 36 H30 V44 H14 Z" fill="#0A0E0E" opacity=".5"/>
  <path d="M42 31 H58 V39 H42 Z"/>
  <path d="M56 21 H114 V35 H56 Z"/><path d="M50 23 H57 V27 H50 Z"/>
  <path d="M58 17 H158 V21 H58 Z"/><path d="M62 17 V21 M68 17 V21 M74 17 V21 M100 17 V21 M106 17 V21 M112 17 V21 M118 17 V21 M124 17 V21 M130 17 V21 M136 17 V21 M142 17 V21 M148 17 V21" stroke="#0A0E0E" stroke-width="1.6"/>
  <path d="M74 6 H96 L98 9 V17 H72 V9 Z"/><path d="M93 9 H97 V15 H93 Z" fill="#E2442E"/>
  <path d="M56 35 H104 V42 L98 46 H64 L56 42 Z"/>
  <path d="M60 44 H74 L68 68 Q67 71 63 71 H55 Z"/>
  <path d="M74 45 Q76 54 86 54 H92" fill="none" stroke="currentColor" stroke-width="3"/>
  <path d="M83 45 H96 L100 62 Q102 70 99 77 L87 76 Q89 68 87 60 Z"/>
  <path d="M112 22 H160 V36 H112 Z"/><path d="M118 25 H124 V33 H118 Z M130 25 H136 V33 H130 Z M142 25 H148 V33 H142 Z" fill="#0A0E0E" opacity=".7"/>
  <path d="M152 12 H157 V17 H152 Z"/>
  <path d="M160 27 H184 V31 H160 Z"/><path d="M184 25 H197 V33 H184 Z"/><path d="M188 25 V33 M192 25 V33" stroke="#0A0E0E" stroke-width="1.4"/>`)}
${W('w-pistol', `
  <path d="M30 22 H160 L164 25 V37 H30 Z"/>
  <path d="M36 25 V34 M41 25 V34 M46 25 V34 M51 25 V34" stroke="#0A0E0E" stroke-width="1.8"/>
  <path d="M34 18 H42 V22 H34 Z M150 18 H156 V22 H150 Z"/>
  <path d="M164 28 H170 V34 H164 Z"/>
  <path d="M38 37 H154 V44 H98 L94 48 H40 Z"/>
  <path d="M40 46 H82 L74 76 Q73 78 70 78 H38 Q34 78 35 74 Z"/><path d="M44 54 H72 M43 60 H70 M42 66 H68" stroke="#0A0E0E" stroke-width="1.6" opacity=".6"/>
  <path d="M82 46 Q83 57 92 57 H102 V44" fill="none" stroke="currentColor" stroke-width="4"/>
  <path d="M88 45 H93 L96 54 H91 Z"/>`)}
${W('w-smg', `
  <path d="M10 30 H44 M10 30 V48 H26 L44 42" fill="none" stroke="currentColor" stroke-width="4.5" stroke-linejoin="round"/>
  <path d="M42 24 H138 V44 H42 Z"/><path d="M50 27 H56 V40 H50 Z" fill="#0A0E0E" opacity=".6"/>
  <path d="M58 19 H128 V24 H58 Z"/><path d="M60 13 H68 V19 H60 Z M118 13 H126 V19 H118 Z"/>
  <path d="M138 27 H172 V41 H138 Z"/><path d="M144 30 H150 V38 H144 Z M156 30 H162 V38 H156 Z" fill="#0A0E0E" opacity=".7"/>
  <path d="M172 31 H190 V37 H172 Z"/>
  <path d="M60 44 H76 L70 70 Q69 72 66 72 H56 Z"/>
  <path d="M76 45 Q78 54 88 54" fill="none" stroke="currentColor" stroke-width="3"/>
  <path d="M92 44 H106 L106 78 H94 Z"/><path d="M95 50 H103 M95 58 H103 M95 66 H103" stroke="#0A0E0E" stroke-width="1.4" opacity=".6"/>
  <path d="M120 44 H134 V56 L128 58 H120 Z"/>`)}
${W('w-shotgun', `
  <path d="M4 36 L46 26 H72 V44 H56 L12 58 Q4 60 3 54 Z"/><path d="M4 36 L10 35 L12 57 L6 58 Z" fill="#0A0E0E" opacity=".55"/>
  <path d="M46 40 L56 44 L50 62 Q49 64 46 64 H40 Z"/>
  <path d="M70 24 H112 V44 H70 Z"/><path d="M80 29 H100 V36 H80 Z" fill="#0A0E0E" opacity=".55"/>
  <path d="M72 44 Q74 54 86 54 H90 V44" fill="none" stroke="currentColor" stroke-width="3"/>
  <path d="M110 25 H197 V32 H110 Z"/><path d="M192 21 H195 V25 H192 Z"/>
  <path d="M110 34 H182 V40 H110 Z"/>
  <path d="M120 31 H160 L162 34 V44 L160 46 H120 L118 44 V34 Z"/>
  <path d="M126 35 V44 M131 35 V44 M136 35 V44 M141 35 V44 M146 35 V44 M151 35 V44" stroke="#0A0E0E" stroke-width="1.6"/>`)}
${W('w-dmr', `
  <path d="M4 32 L40 25 H64 V48 H46 L10 56 Q4 57 3 52 Z"/><path d="M22 24 H44 V27 H22 Z"/>
  <path d="M62 24 H120 V42 H62 Z"/>
  <path d="M68 11 H80 V21 H68 Z"/><path d="M78 13 H124 V20 H78 Z"/><path d="M122 9 H138 V22 H122 Z"/>
  <path d="M136 10 V21" stroke="#0A0E0E" stroke-width="1.6"/><path d="M95 7 H103 V13 H95 Z"/>
  <path d="M84 20 H90 V24 H84 Z M110 20 H116 V24 H110 Z"/>
  <path d="M66 42 H80 L74 66 Q73 68 70 68 H60 Z"/>
  <path d="M80 43 Q82 52 92 52" fill="none" stroke="currentColor" stroke-width="3"/>
  <path d="M94 42 H112 V60 H94 Z"/>
  <path d="M120 27 H170 V39 H120 Z"/><path d="M128 30 H134 V36 H128 Z M140 30 H146 V36 H140 Z M152 30 H158 V36 H152 Z" fill="#0A0E0E" opacity=".7"/>
  <path d="M170 31 H188 V35 H170 Z"/><path d="M188 28 H199 V38 H188 Z"/><path d="M192 28 V38 M195.5 28 V38" stroke="#0A0E0E" stroke-width="1.4"/>`)}
${W('w-axe', `
  <path d="M8 63 L150 40 L151 47 L10 70 Q6 71 5 67 Q5 64 8 63 Z"/>
  <path d="M12 61 L36 57 L37 64 L13 68 Z" fill="#0A0E0E" opacity=".45"/><path d="M18 60 L19 67 M24 59 L25 66 M30 58 L31 65" stroke="currentColor" stroke-width="1.4"/>
  <path d="M144 30 H170 V52 H144 Z"/>
  <path d="M144 31 L140 6 Q160 1 190 9 L170 31 Z"/><path d="M143 12 Q164 7 186 13" fill="none" stroke="#0A0E0E" stroke-width="1.6" opacity=".7"/>
  <path d="M146 51 H168 Q166 66 154 76 Q150 78 151 73 Q154 62 146 51 Z"/>`)}

${S('i-medkit', '<path d="M7 14 H41 V38 H7 Z"/><path d="M18 14 V9 H30 V14"/><path d="M24 20 V32 M18 26 H30"/>')}
${S('i-frag', '<path d="M17 18 H31 L35 24 V36 L31 42 H17 L13 36 V24 Z"/><path d="M13 30 H35 M24 18 V42"/><path d="M20 18 V12 H28 V18"/><path d="M28 12 L37 14"/><circle cx="39" cy="19" r="3"/>')}
${S('i-flare', '<path d="M20 22 H28 V43 H20 Z"/><path d="M18 22 H30"/><path d="M20 30 H28"/><path d="M24 4 L29 11 L26 15 H22 L19 11 Z"/><path d="M12 11 L16 14 M36 11 L32 14"/>')}
<symbol id="i-syringe" viewBox="0 0 48 48"><g transform="rotate(-45 24 24)"><rect x="14" y="20" width="20" height="8" fill="none" stroke="currentColor" stroke-width="2.5"/><rect x="19" y="22.5" width="10" height="3" fill="#A98BFF"/><path d="M34 24 H44 M14 24 H6 M6 17 V31" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="square"/></g></symbol>
${S('i-ammo', '<path d="M12 40 V20 L16 12 L20 20 V40 Z"/><path d="M24 40 V20 L28 12 L32 20 V40 Z"/><path d="M12 33 H20 M24 33 H32"/>')}
${S('i-bandage', '<path d="M10 30 L30 10 L38 18 L18 38 Z"/><path d="M17 23 L25 31 M21 19 L29 27"/><path d="M33 33 L40 40"/>')}
${S('i-lure', '<circle cx="24" cy="26" r="13"/><path d="M24 18 V26 L30 29"/><path d="M12 10 L16 14 M36 10 L32 14"/><path d="M16 40 L13 44 M32 40 L35 44"/>')}
${S('i-tissue', '<path d="M12 34 C10 24 16 14 24 12 C33 10 39 18 37 27 C35 36 26 40 18 38 Z"/><path d="M18 22 C22 24 24 28 30 26"/><path d="M20 31 L23 29"/>')}
${S('i-plasma', '<path d="M18 6 H30 M20 6 V18 L11 36 C9 40 12 43 16 43 H32 C36 43 39 40 37 36 L28 18 V6"/><path d="M14 31 H34"/>')}
${S('i-neural', '<path d="M14 24 C10 16 18 8 25 11 C30 6 40 12 37 20 C42 26 36 34 30 32 C27 38 18 38 16 32 C9 32 8 26 14 24 Z"/><path d="M22 16 V30 M28 18 C24 22 24 26 30 28"/>')}
${S('i-adrenal', '<path d="M24 8 C34 14 38 22 36 32 C34 40 14 40 12 32 C10 22 14 14 24 8 Z"/><path d="M24 18 V30 M18 26 H30"/>')}
${S('i-cloth', '<path d="M8 14 H40 V20 H8 Z"/><path d="M10 20 V38 L18 34 L24 38 L30 34 L38 38 V20"/>')}
${S('i-antiseptic', '<path d="M18 12 H30 V18 L34 22 V42 H14 V22 L18 18 Z"/><path d="M20 6 H28 V12"/><path d="M19 30 H29 M24 25 V35"/>')}
${S('i-chemicals', '<path d="M16 10 H32 V16 L36 20 V42 H12 V20 L16 16 Z"/><path d="M12 28 H36"/><path d="M20 34 L24 30 L28 34"/>')}
${S('i-scrap', '<path d="M8 36 L22 22 L28 28 L40 16"/><path d="M34 16 H40 V22"/><circle cx="14" cy="16" r="5"/><path d="M26 38 H40"/>')}
${S('i-reagent', '<path d="M19 6 H29 M21 6 V18 L12 38 H36 L27 18 V6"/><path d="M15 32 H33"/><circle cx="22" cy="27" r="1.5"/>')}
${S('i-vial', '<path d="M18 6 H30 V10 H18 Z"/><path d="M20 10 V38 C20 42 28 42 28 38 V10"/><path d="M20 26 H28"/>')}
${S('i-sedative', '<path d="M14 18 H34 V40 H14 Z"/><path d="M16 12 H32 V18 H16 Z"/><path d="M14 26 H34 M20 32 H28"/>')}
${S('i-antigen', '<circle cx="24" cy="24" r="9"/><path d="M24 6 V15 M24 33 V42 M6 24 H15 M33 24 H42 M11 11 L17 17 M31 31 L37 37 M37 11 L31 17 M17 31 L11 37"/>')}
${S('i-concentrate', '<path d="M18 4 H30 M20 4 V12 L14 20 V40 C14 44 34 44 34 40 V20 L28 12 V4"/><path d="M14 28 H34"/><path d="M18 34 H30"/>')}
${S('i-suppressant', '<path d="M12 22 C12 12 36 12 36 22 V30 C36 40 12 40 12 30 Z"/><path d="M12 26 H36"/><path d="M20 18 L28 34"/>')}
${S('i-catalyst', '<path d="M24 6 L40 15 V33 L24 42 L8 33 V15 Z"/><path d="M24 16 L32 21 V29 L24 34 L16 29 V21 Z"/>')}
${S('i-keycard', '<path d="M8 12 H40 V36 H8 Z"/><path d="M8 20 H40"/><path d="M14 28 H24"/><path d="M30 26 H34 V31 H30 Z"/>')}
${S('i-cure', '<path d="M18 4 H30 M20 4 V10 H28 V4 M16 10 H32 V42 H16 Z"/><path d="M16 22 H32"/><path d="M24 26 V36 M19 31 H29"/>')}
</defs></svg>`;

export function injectIcons() {
  if (document.getElementById('suka-icons')) return;
  const wrap = document.createElement('div');
  wrap.id = 'suka-icons';
  wrap.innerHTML = SPRITE;
  document.body.prepend(wrap);
}

export function icon(id: string, size = 28, extra = '') {
  return `<svg class="ico ${extra}" width="${size}" height="${size}" aria-hidden="true"><use href="#${id}"></use></svg>`;
}

export function weaponIcon(id: string, w = 180, h = 72, extra = '') {
  return `<svg class="ico ${extra}" width="${w}" height="${h}" viewBox="0 0 200 80" aria-hidden="true"><use href="#${id}"></use></svg>`;
}
