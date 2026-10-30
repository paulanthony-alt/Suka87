import '@fontsource/barlow-semi-condensed/400';
import '@fontsource/barlow-semi-condensed/500';
import '@fontsource/barlow-semi-condensed/600';
import '@fontsource/big-shoulders-display/700';
import '@fontsource/big-shoulders-display/800';
import './styles/hud.css';
import { injectIcons } from './ui/icons';
import { Game } from './game/game';
import { sprites } from './sprites/library';

async function boot() {
  injectIcons();
  // Signage textures and the compass are painted with the HUD fonts, so wait for them first.
  await Promise.all([
    document.fonts.load('700 32px "Big Shoulders Display"'),
    document.fonts.load('800 32px "Big Shoulders Display"'),
    document.fonts.load('500 16px "Barlow Semi Condensed"'),
    document.fonts.load('600 16px "Barlow Semi Condensed"'),
  ]).catch(() => undefined);
  await sprites.load();
  const game = new Game(document.getElementById('view')!, document.getElementById('ui')!);
  (window as unknown as { suka: Game }).suka = game;
  document.getElementById('boot')?.classList.add('done');
  setTimeout(() => document.getElementById('boot')?.remove(), 800);
}

void boot();
