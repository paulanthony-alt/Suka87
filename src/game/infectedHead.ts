import * as THREE from 'three';
import { BUMP, NOISE } from './shaderChunks';

/**
 * Sculpted infected head. The source humanoid has a featureless mannequin head of ~180 vertices,
 * so each infected gets this denser head instead: a skull with brow ridge, sunken eye sockets,
 * nose, cheekbones, hollow cheeks, a slack open mouth with teeth, chin and ears, plus eyeballs.
 * It is parented to the Head bone, so it follows every animation.
 */

/** Centre of the mannequin's head in its bind pose (metres), where the sculpt is placed. */
export const HEAD_CENTER = new THREE.Vector3(0, 1.69, 0.003);
const RADII = new THREE.Vector3(0.076, 0.106, 0.094);

const g2 = (x: number, y: number, cx: number, cy: number, sx: number, sy: number) => Math.exp(-((x - cx) ** 2 / (sx * sx) + (y - cy) ** 2 / (sy * sy)));
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Surface point of the sculpt for a unit direction from the head centre. */
function sculpt(d: THREE.Vector3, out: THREE.Vector3) {
  const { x, y, z } = d;
  out.set(x * RADII.x, y * RADII.y, z * RADII.z);
  // narrower jaw, fuller back of the skull, slightly flattened crown
  if (y < 0) out.x *= 1 - 0.12 * smooth(0, -0.95, y);
  if (z < 0) out.z *= 1.06;
  if (y > 0.6) out.y *= 1 - 0.05 * smooth(0.6, 1, y);
  const front = smooth(0.15, 0.6, z);
  let disp = 0;
  disp += 0.009 * g2(x, y, 0, 0.24, 0.6, 0.075) * front; // brow ridge
  disp -= 0.015 * (g2(x, y, 0.36, 0.1, 0.16, 0.1) + g2(x, y, -0.36, 0.1, 0.16, 0.1)) * front; // eye sockets
  disp += (0.009 * g2(x, y, 0, 0.0, 0.07, 0.16) + 0.017 * g2(x, y, 0, -0.22, 0.1, 0.1)) * front; // nose
  disp += 0.007 * (g2(x, y, 0.13, -0.3, 0.06, 0.05) + g2(x, y, -0.13, -0.3, 0.06, 0.05)) * front; // nostrils
  disp += 0.007 * (g2(x, y, 0.54, -0.06, 0.15, 0.1) + g2(x, y, -0.54, -0.06, 0.15, 0.1)) * front; // cheekbones
  disp -= 0.01 * (g2(x, y, 0.48, -0.42, 0.16, 0.16) + g2(x, y, -0.48, -0.42, 0.16, 0.16)) * front; // hollow cheeks
  disp += 0.005 * g2(x, y, 0, -0.5, 0.32, 0.09) * front; // lips
  disp -= 0.02 * g2(x, y, 0, -0.53, 0.25, 0.04) * front; // slack open mouth
  disp += 0.009 * g2(x, y, 0, -0.84, 0.22, 0.12) * front; // chin
  // ears on the sides
  const side = smooth(0.82, 0.97, Math.abs(x));
  disp += 0.009 * side * Math.exp(-(((y - 0.02) ** 2) / 0.035 + ((z + 0.05) ** 2) / 0.012));
  out.addScaledVector(d, disp);
  // the underside and back of the skull run down into a neck, so the head joins the body
  // (the jaw and chin at the front stay put)
  const jawKeep = smooth(0.15, 0.5, z) * (1 - smooth(-0.9, -0.99, y));
  const pull = smooth(-0.5, -0.95, y) * (1 - jawKeep);
  if (pull > 0) {
    const r = Math.hypot(x, z) || 1;
    const ny = -0.1 - 0.12 * smooth(-0.6, -1, y);
    out.x += ((x / r) * 0.044 - out.x) * pull;
    out.z += ((z / r) * 0.05 - 0.012 - out.z) * pull;
    out.y += (ny - out.y) * pull;
  }
  return out;
}

let headGeo: THREE.BufferGeometry | null = null;
function headGeometry() {
  if (headGeo) return headGeo;
  const g = new THREE.SphereGeometry(1, 72, 56);
  const pos = g.attributes.position;
  const d = new THREE.Vector3();
  const p = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    d.fromBufferAttribute(pos, i).normalize();
    sculpt(d, p);
    pos.setXYZ(i, p.x, p.y, p.z);
  }
  g.computeVertexNormals();
  headGeo = g;
  return g;
}

/** Where the eyeballs sit, inside the sockets. */
function eyeCentre(side: number) {
  const d = new THREE.Vector3(0.36 * side, 0.1, 0.93).normalize();
  return sculpt(d, new THREE.Vector3()).addScaledVector(d, -0.0105);
}

export interface HeadUniforms {
  uSkin: { value: THREE.Color };
  uHairCol: { value: THREE.Color };
  uSeed: { value: number };
  uBlood: { value: number };
  uHair: { value: number };
  uGlow: { value: number };
  uMut: { value: number };
}

function headMaterial(U: HeadUniforms) {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.6 });
  const C = HEAD_CENTER;
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, U);
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vH;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvH = position;');
    s.fragmentShader = s.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
uniform vec3 uSkin, uHairCol; uniform float uSeed, uBlood, uHair, uGlow, uMut;
varying vec3 vH;
${NOISE}
${BUMP}
float gs(vec2 p, vec2 c, vec2 s) { vec2 q = (p - c) / s; return exp(-dot(q, q)); }`,
      )
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
vec3 O = vH + vec3(${C.x.toFixed(3)}, ${C.y.toFixed(3)}, ${C.z.toFixed(3)});
vec3 P = O * 6.0 + uSeed;
vec3 d = normalize(vH / vec3(0.076, 0.106, 0.094));
float front = smoothstep(0.15, 0.6, d.z);
// grey, mottled, bruised skin with darker creases
vec3 skin = uSkin * (0.78 + 0.45 * fbm(P * 3.0));
skin = mix(skin, skin * vec3(0.55, 0.5, 0.7), smoothstep(0.55, 0.75, fbm(P * 1.7 + 3.0)));
// dark bruised rings around the eyes, flushed raw eyelids
float sockets = (gs(d.xy, vec2(0.36, 0.1), vec2(0.24, 0.17)) + gs(d.xy, vec2(-0.36, 0.1), vec2(0.24, 0.17))) * front;
skin = mix(skin, vec3(0.09, 0.045, 0.06), clamp(sockets, 0.0, 1.0) * 0.75);
// lips, the open mouth and blood down the chin
float lips = gs(d.xy, vec2(0.0, -0.5), vec2(0.3, 0.09)) * front;
float mouth = gs(d.xy, vec2(0.0, -0.53), vec2(0.22, 0.04)) * front;
skin = mix(skin, vec3(0.07, 0.03, 0.035), lips * 0.5);
skin = mix(skin, vec3(0.03, 0.0, 0.004), smoothstep(0.35, 0.8, mouth));
float drip = smoothstep(0.05, 0.0, abs(d.x - 0.08 + 0.03 * sin(d.y * 20.0 + uSeed))) * smoothstep(-0.45, -0.6, d.y) * front;
float drip2 = smoothstep(0.04, 0.0, abs(d.x + 0.12 + 0.02 * sin(d.y * 25.0))) * smoothstep(-0.5, -0.65, d.y) * front;
float splat = smoothstep(0.62, 0.75, fbm(P * 1.4 + 7.0));
float wet = clamp(drip + drip2 * 0.8 + splat + gs(d.xy, vec2(0.0, -0.6), vec2(0.3, 0.12)) * front, 0.0, 1.0) * uBlood;
wet *= smoothstep(0.25, 0.55, fbm(P * 5.0 + 11.0) + 0.2);
skin = mix(skin, vec3(0.15, 0.01, 0.014), wet * 0.9);
// matted hair: ragged hairline, clumps and bald patches
float crown = smoothstep(0.25, 0.45, d.y + 0.35 * smoothstep(0.3, -0.5, d.z) + 0.12 * (fbm(P * 4.0) - 0.5));
float hair = uHair * crown * smoothstep(0.3, 0.55, fbm(P * 5.0) + 0.15);
float strands = n3(vec3(O.x * 900.0, O.y * 260.0, O.z * 900.0)) * 0.6 + fbm(P * 14.0) * 0.4;
skin = mix(skin, uHairCol * (0.6 + 0.5 * strands), hair);
diffuseColor.rgb = skin;
float headWet = wet + smoothstep(0.35, 0.8, mouth);
float headBump = fbm(P * 9.0) * 0.5 + hair * strands * 0.35;`,
      )
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(mix(0.58, 0.85, hair), 0.22, clamp(headWet, 0.0, 1.0));')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = sukaBump(-vViewPosition, normal, headBump, 0.004);')
      .replace(
        '#include <emissivemap_fragment>',
        /* glsl */ `#include <emissivemap_fragment>
float vn = (1.0 - smoothstep(0.0, 0.012, abs(fbm(P * 2.6) - 0.5))) * smoothstep(0.45, 0.65, fbm(P * 0.9 + 5.0));
totalEmissiveRadiance += vec3(0.5, 0.35, 0.9) * vn * uMut * 0.25 * uGlow * (1.0 - hair) * (1.0 - sockets);`,
      );
  };
  return m;
}

/** Cloudy, bloodshot eyes with a violet glow that brightens as the strain mutates. */
let eyeMat: THREE.MeshStandardMaterial | null = null;
function eyeMaterial(mut: { value: number }) {
  if (eyeMat) return eyeMat;
  const m = new THREE.MeshStandardMaterial({ roughness: 0.12, color: '#c9c0a8' });
  m.onBeforeCompile = (s) => {
    s.uniforms.uMut = mut;
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vE;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvE = normalize(position);');
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform float uMut; varying vec3 vE;\n${NOISE}`)
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
float a = acos(clamp(vE.z, -1.0, 1.0));
float iris = smoothstep(0.62, 0.55, a);
float pupil = smoothstep(0.24, 0.18, a);
float veins = smoothstep(0.55, 0.62, n3(vE * 18.0)) * smoothstep(0.5, 1.2, a);
vec3 sclera = mix(vec3(0.62, 0.58, 0.45), vec3(0.45, 0.04, 0.04), veins * 0.8);
diffuseColor.rgb = mix(sclera, mix(vec3(0.35, 0.28, 0.5), vec3(0.02), pupil), iris);
float eyeGlow = iris * (1.0 - pupil);`,
      )
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(0.7, 0.55, 1.0) * eyeGlow * (0.6 + uMut * 2.5);');
  };
  eyeMat = m;
  return m;
}

const teethMat = new THREE.MeshStandardMaterial({ color: '#8f7f5c', roughness: 0.45 });
const teethGeo = new THREE.BoxGeometry(0.03, 0.007, 0.008);
const eyeGeo = new THREE.SphereGeometry(0.0118, 18, 14);

/**
 * Build a head for one infected and attach it to `headBone`. `bindInverse` is the head bone's
 * inverse bind matrix, used to place the sculpt where the mannequin head was.
 */
export function buildInfectedHead(headBone: THREE.Bone, bindInverse: THREE.Matrix4, U: HeadUniforms) {
  const group = new THREE.Group();
  const head = new THREE.Mesh(headGeometry(), headMaterial(U));
  head.castShadow = true;
  group.add(head);
  for (const side of [1, -1]) {
    const eye = new THREE.Mesh(eyeGeo, eyeMaterial(U.uMut));
    eye.position.copy(eyeCentre(side));
    // eyes stare slightly off true, which reads as vacant
    eye.rotation.set(0.05 + Math.random() * 0.1, side * 0.08 + (Math.random() - 0.5) * 0.15, 0);
    group.add(eye);
  }
  const mouthD = new THREE.Vector3(0, -0.53, 0.85).normalize();
  const mouthP = sculpt(mouthD, new THREE.Vector3()).addScaledVector(mouthD, -0.012);
  const upper = new THREE.Mesh(teethGeo, teethMat);
  upper.position.copy(mouthP).add(new THREE.Vector3(0, 0.0045, 0));
  const lower = new THREE.Mesh(teethGeo, teethMat);
  lower.position.copy(mouthP).add(new THREE.Vector3(0, -0.006, 0.001));
  lower.scale.x = 0.85;
  group.add(upper, lower);
  // place in the Head bone's frame: bone-local = inverse bind × mannequin-space position
  const m = bindInverse.clone().multiply(new THREE.Matrix4().makeTranslation(HEAD_CENTER.x, HEAD_CENTER.y, HEAD_CENTER.z));
  m.decompose(group.position, group.quaternion, group.scale);
  headBone.add(group);
  return group;
}
