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
  <path d="M52 24 L16 28 L8 36 L10 52 L18 54 L52 44 Z"/><path d="M50 18 H124 V30 H110 V42 H50 Z"/>
  <path d="M122 22 H166 V38 H122 Z"/><path d="M166 27 H190 V32 H166 Z"/><path d="M190 24 H198 V35 H190 Z"/>
  <path d="M72 8 H94 V18 H72 Z"/><path d="M160 16 H164 V22 H160 Z"/><path d="M86 42 H104 L112 72 H92 Z"/>
  <path d="M52 42 H70 L62 68 H48 Z"/><path d="M124 24 V37 M144 22 V38" stroke="#0A0E0E" stroke-width="1.5" fill="none"/>`)}
${W('w-pistol', `
  <path d="M58 22 H150 V40 H58 Z"/><path d="M150 26 H160 V36 H150 Z"/><path d="M62 40 H112 V48 H62 Z"/>
  <path d="M64 46 H92 L84 76 H58 Z"/><path d="M92 46 H104 C104 56 98 58 92 56 Z" fill="none" stroke="currentColor" stroke-width="4"/>
  <path d="M64 16 H70 V22 H64 Z M140 16 H146 V22 H140 Z"/><path d="M74 28 V36 M80 28 V36 M86 28 V36" stroke="#0A0E0E" stroke-width="2"/>`)}
${W('w-smg', `
  <path d="M40 26 H140 V44 H40 Z"/><path d="M140 30 H178 V38 H140 Z"/><path d="M178 28 H190 V40 H178 Z"/>
  <path d="M10 30 H40 V36 H10 Z"/><path d="M6 26 H14 V48 H6 Z"/><path d="M60 44 H78 L72 70 H56 Z"/>
  <path d="M96 44 H110 L114 76 H100 Z"/><path d="M118 44 H136 V56 H118 Z"/><path d="M60 20 H74 V26 H60 Z"/>`)}
${W('w-shotgun', `
  <path d="M6 32 L44 26 H74 V44 H50 L12 52 Z"/><path d="M74 24 H110 V44 H74 Z"/><path d="M110 26 H196 V33 H110 Z"/>
  <path d="M110 36 H186 V42 H110 Z"/><path d="M124 34 H160 V46 H124 Z"/><path d="M80 44 H94 L90 64 H76 Z"/>
  <path d="M190 22 H194 V26 H190 Z"/>`)}
${W('w-dmr', `
  <path d="M4 34 L40 26 H64 V46 H42 L10 54 Z"/><path d="M62 24 H128 V44 H62 Z"/><path d="M128 28 H184 V38 H128 Z"/>
  <path d="M184 30 H198 V36 H184 Z"/><path d="M70 10 H124 V20 H70 Z"/><path d="M64 8 H72 V22 H64 Z M122 6 H132 V22 H122 Z"/>
  <path d="M84 20 H90 V24 H84 Z M104 20 H110 V24 H104 Z"/><path d="M76 44 H90 L86 66 H72 Z"/><path d="M98 44 H116 V60 H98 Z"/>`)}
${W('w-axe', `
  <path d="M20 44 L176 32 L177 38 L21 50 Z"/><path d="M14 42 H26 V52 H14 Z"/>
  <path d="M150 18 H166 V52 H150 Z"/><path d="M166 14 C186 18 194 30 194 36 C194 42 186 54 166 58 Z"/>
  <path d="M150 28 L128 34 L150 40 Z"/>`)}

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
