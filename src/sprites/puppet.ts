import * as THREE from 'three';

/**
 * 2D "puppet" animation for single-image infected art. The sprite quad is subdivided and its
 * vertices are bent around joints found in the artwork (hips, knees, shoulders, neck), so one
 * painting can walk, swing its arms, turn its head and raise its arms to attack.
 */

/** Joint positions in texture space: u across (0..1), v up from the feet (0..1). */
export interface PuppetRig {
  legX: number;
  bodyX: number;
  headX: number;
  hip: number;
  knee: number;
  shoulder: number;
  neck: number;
  /** half-width of the torso in u; anything wider is treated as an arm */
  torso: number;
  aspect: number;
}

/** Estimate joints from the alpha channel. Robust to most standing, roughly front-facing poses. */
export function detectRig(img: HTMLImageElement): PuppetRig {
  const W = 64;
  const H = Math.max(32, Math.round((W * img.height) / img.width));
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, W, H);
  const data = ctx.getImageData(0, 0, W, H).data;
  const solid = (x: number, y: number) => data[(y * W + x) * 4 + 3] > 120;
  const rowOf = (v: number) => Math.min(H - 1, Math.max(0, Math.round((1 - v) * H)));

  const centroid = (v0: number, v1: number) => {
    let sum = 0;
    let n = 0;
    for (let y = rowOf(v1); y <= rowOf(v0); y++) for (let x = 0; x < W; x++) if (solid(x, y)) { sum += x; n++; }
    return n ? (sum / n + 0.5) / W : 0.5;
  };
  const width = (y: number) => {
    let n = 0;
    for (let x = 0; x < W; x++) if (solid(x, y)) n++;
    return n;
  };

  // neck = narrowest row in the upper band
  let neck = 0.85;
  let best = Infinity;
  for (let v = 0.74; v <= 0.93; v += 1 / H) {
    const w = width(rowOf(v));
    if (w > 0 && w < best) {
      best = w;
      neck = v;
    }
  }
  const legX = centroid(0.05, 0.35);
  const bodyX = centroid(0.5, neck - 0.04);
  const headX = centroid(neck, 1);

  // torso edge: walk outwards from the body centre at chest height until a gap
  const chestRow = rowOf((neck + 0.5) / 2);
  const cx = Math.round(bodyX * W);
  let l = cx;
  let r = cx;
  while (l > 0 && (solid(l - 1, chestRow) || solid(l - 2, chestRow))) l--;
  while (r < W - 1 && (solid(r + 1, chestRow) || solid(r + 2, chestRow))) r++;
  const full = (r - l) / W / 2;
  // when arms touch the torso there's no gap; assume the outer ~28% on each side are arms
  const torso = Math.max(0.08, Math.min(full * 0.72, 0.3));

  return { legX, bodyX, headX, hip: 0.48, knee: 0.25, shoulder: neck - 0.07, neck, torso, aspect: img.width / img.height };
}

export interface PuppetUniforms {
  [k: string]: { value: number };
  uPhase: { value: number };
  uWalk: { value: number };
  uArms: { value: number };
  uAttack: { value: number };
  uScream: { value: number };
  uHead: { value: number };
  uBreath: { value: number };
  uLegX: { value: number };
  uBodyX: { value: number };
  uHeadX: { value: number };
  uHip: { value: number };
  uKnee: { value: number };
  uShoulder: { value: number };
  uNeck: { value: number };
  uTorso: { value: number };
  uAspect: { value: number };
}

export function puppetUniforms(): PuppetUniforms {
  const u = (value: number) => ({ value });
  return {
    uPhase: u(0), uWalk: u(0), uArms: u(0), uAttack: u(0), uScream: u(0), uHead: u(0), uBreath: u(0),
    uLegX: u(0.5), uBodyX: u(0.5), uHeadX: u(0.5), uHip: u(0.48), uKnee: u(0.25), uShoulder: u(0.78), uNeck: u(0.85), uTorso: u(0.15), uAspect: u(0.5),
  };
}

export function applyRig(u: PuppetUniforms, rig: PuppetRig | null) {
  const r = rig ?? { legX: 0.5, bodyX: 0.5, headX: 0.5, hip: 0.48, knee: 0.25, shoulder: 0.78, neck: 0.85, torso: 0.15, aspect: 0.5 };
  u.uLegX.value = r.legX;
  u.uBodyX.value = r.bodyX;
  u.uHeadX.value = r.headX;
  u.uHip.value = r.hip;
  u.uKnee.value = r.knee;
  u.uShoulder.value = r.shoulder;
  u.uNeck.value = r.neck;
  u.uTorso.value = r.torso;
  u.uAspect.value = r.aspect;
}

const DEFORM = /* glsl */ `
  // ---- puppet deformation (plane local space: x -0.5..0.5, y 0..1 from the feet)
  {
    float u = transformed.x + 0.5;
    float v = transformed.y;
    vec2 q = vec2(transformed.x * uAspect, v);         // isotropic space for rotations
    vec2 o = q;

    // legs: alternate lift and splay around each hip
    float side = u < uLegX ? -1.0 : 1.0;
    float legW = 1.0 - smoothstep(uHip - 0.12, uHip + 0.02, v);
    float ph = uPhase + (side > 0.0 ? 3.14159 : 0.0);
    float lift = max(0.0, sin(ph));
    vec2 hip = vec2((uLegX - 0.5 + side * 0.04) * uAspect, uHip);
    float a = side * sin(ph) * 0.09 * uWalk;
    vec2 d = q - hip;
    vec2 rot = vec2(d.x * cos(a) - d.y * sin(a), d.x * sin(a) + d.y * cos(a)) + hip;
    q = mix(q, rot, legW);
    q.y += lift * 0.06 * uWalk * (1.0 - smoothstep(0.0, uHip, v)) * legW;
    // knees bend in a little on the lifted leg
    q.x -= side * lift * 0.025 * uWalk * smoothstep(0.0, uKnee, v) * (1.0 - smoothstep(uKnee, uHip, v)) * uAspect;

    // arms: swing / raise around the shoulders
    float dx = u - uBodyX;
    float aside = dx < 0.0 ? -1.0 : 1.0;
    float armW = smoothstep(uTorso, uTorso + 0.07, abs(dx))
               * smoothstep(uHip - 0.28, uHip - 0.1, v)
               * (1.0 - smoothstep(uShoulder + 0.02, uShoulder + 0.08, v));
    vec2 sh = vec2((uBodyX - 0.5 + aside * uTorso) * uAspect, uShoulder);
    float aa = aside * (uAttack * 1.15 + uScream * 0.28) - sin(uPhase) * 0.16 * uArms;
    d = q - sh;
    rot = vec2(d.x * cos(aa) - d.y * sin(aa), d.x * sin(aa) + d.y * cos(aa)) + sh;
    q = mix(q, rot, armW);

    // torso: sway and breathe above the hips
    float up = smoothstep(uHip - 0.05, 1.0, v);
    q.x += sin(uPhase) * 0.018 * uWalk * up;
    q.x += (q.x - (uBodyX - 0.5) * uAspect) * uBreath * 0.012 * up * (1.0 - armW);

    // head: tilt around the neck, thrown back when screaming
    float headW = smoothstep(uNeck - 0.03, uNeck + 0.02, v);
    vec2 nk = vec2((uHeadX - 0.5) * uAspect, uNeck);
    float ha = uHead + uScream * 0.12 * sin(uPhase * 9.0);
    d = q - nk;
    rot = vec2(d.x * cos(ha) - d.y * sin(ha), d.x * sin(ha) + d.y * cos(ha)) + nk;
    q = mix(q, rot, headW);
    q.y += uScream * 0.02 * headW;

    transformed.x = q.x / uAspect;
    transformed.y = q.y;
  }
`;

const DECL = /* glsl */ `
uniform float uPhase, uWalk, uArms, uAttack, uScream, uHead, uBreath;
uniform float uLegX, uBodyX, uHeadX, uHip, uKnee, uShoulder, uNeck, uTorso, uAspect;
`;

/** Patch a built-in material (standard or depth) to run the deformation. */
export function enablePuppet(mat: THREE.Material, u: PuppetUniforms) {
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = DECL + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n' + DEFORM);
  };
  mat.customProgramCacheKey = () => 'suka-puppet';
}
