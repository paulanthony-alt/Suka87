import { animate, stagger } from 'motion';

/**
 * Shared spring presets built on Motion (motion.dev). Every UI transition in the game goes
 * through these so movement has one consistent feel: quick, weighted, no bounce-y overshoot
 * except where something is meant to "pop".
 */
export const SPRING = { type: 'spring', stiffness: 520, damping: 38, mass: 0.9 } as const;
export const SOFT = { type: 'spring', stiffness: 260, damping: 32 } as const;
export const POP = { type: 'spring', stiffness: 700, damping: 18 } as const;

type Targets = Element | Element[] | NodeListOf<Element> | HTMLCollection | null | undefined;

const list = (t: Targets): Element[] => (!t ? [] : t instanceof Element ? [t] : Array.from(t));

/** Rise/slide in with a fade. `from` is the starting offset in px. */
export function enter(t: Targets, opts: { x?: number; y?: number; scale?: number; delay?: number; each?: number } = {}) {
  const els = list(t);
  if (!els.length) return;
  const kf: Record<string, number[]> = { opacity: [0, 1] };
  if (opts.x) kf.x = [opts.x, 0];
  if (opts.y) kf.y = [opts.y, 0];
  if (opts.scale) kf.scale = [opts.scale, 1];
  return animate(els, kf, { ...SPRING, delay: opts.each ? stagger(opts.each, { startDelay: opts.delay ?? 0 }) : opts.delay ?? 0 });
}

/** Fade/slide out, then call `done`. */
export function exit(t: Targets, opts: { x?: number; y?: number; scale?: number; duration?: number } = {}, done?: () => void) {
  const els = list(t);
  if (!els.length) {
    done?.();
    return;
  }
  const kf: Record<string, number> = { opacity: 0 };
  if (opts.x) kf.x = opts.x;
  if (opts.y) kf.y = opts.y;
  if (opts.scale) kf.scale = opts.scale;
  const a = animate(els, kf, { duration: opts.duration ?? 0.18, ease: [0.4, 0, 1, 1] });
  if (done) void a.finished.then(done);
  return a;
}

/** A quick emphasis pulse (scale up and settle). */
export function pop(t: Targets, amount = 1.12) {
  const els = list(t);
  if (els.length) animate(els, { scale: [amount, 1] }, POP);
}

export function to(t: Targets, kf: Record<string, number | string>, opts: Record<string, unknown> = SPRING) {
  const els = list(t);
  if (els.length) return animate(els, kf, opts);
}
