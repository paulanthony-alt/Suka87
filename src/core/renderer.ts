import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

/**
 * Final screen-space grade: vignette, film grain, chromatic aberration on damage, low-health
 * desaturation and a violet pulse that grows with Suka 87 exposure.
 */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uGrain: { value: 0.06 },
    uVignette: { value: 0.55 },
    uDamage: { value: 0 },
    uLowHealth: { value: 0 },
    uExposure: { value: 0 },
    uFlash: { value: 0 },
    uAspect: { value: 16 / 9 },
    uToneExposure: { value: 1.05 },
    uTexel: { value: new THREE.Vector2(1 / 1920, 1 / 1080) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime, uGrain, uVignette, uDamage, uLowHealth, uExposure, uFlash, uAspect, uToneExposure;
    uniform vec2 uTexel;

    // ACES filmic tone mapping + sRGB encode, folded in here so the frame needs one less
    // full-screen pass (matches three.js ACESFilmicToneMapping / OutputPass).
    vec3 sukaRRTFit(vec3 v) {
      vec3 a = v * (v + 0.0245786) - 0.000090537;
      vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
      return a / b;
    }
    vec3 sukaAces(vec3 c) {
      const mat3 inM = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
      const mat3 outM = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
      c *= uToneExposure / 0.6;
      c = outM * sukaRRTFit(inM * c);
      return clamp(c, 0.0, 1.0);
    }
    vec3 sukaSRGB(vec3 c) {
      return mix(pow(c, vec3(1.0 / 2.4)) * 1.055 - 0.055, c * 12.92, vec3(lessThanEqual(c, vec3(0.0031308))));
    }
    varying vec2 vUv;

    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    // perceptual luma of an HDR sample, for edge detection before tone mapping
    float sukaLuma(vec3 c) { return log2(1.0 + dot(c, vec3(0.299, 0.587, 0.114)) * 4.0); }
    // FXAA (3.11 console variant) folded into the grade: the scene renders without MSAA
    vec3 sukaFxaa(vec2 uv) {
      vec3 rgbM = texture2D(tDiffuse, uv).rgb;
      float lNW = sukaLuma(texture2D(tDiffuse, uv + vec2(-1.0, -1.0) * uTexel).rgb);
      float lNE = sukaLuma(texture2D(tDiffuse, uv + vec2(1.0, -1.0) * uTexel).rgb);
      float lSW = sukaLuma(texture2D(tDiffuse, uv + vec2(-1.0, 1.0) * uTexel).rgb);
      float lSE = sukaLuma(texture2D(tDiffuse, uv + vec2(1.0, 1.0) * uTexel).rgb);
      float lM = sukaLuma(rgbM);
      float lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE)));
      float lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));
      if (lMax - lMin < max(0.05, lMax * 0.125)) return rgbM;
      vec2 dir = vec2(-((lNW + lNE) - (lSW + lSE)), (lNW + lSW) - (lNE + lSE));
      float red = max((lNW + lNE + lSW + lSE) * 0.03125, 1.0 / 128.0);
      dir = clamp(dir / (min(abs(dir.x), abs(dir.y)) + red), -8.0, 8.0) * uTexel;
      vec3 a = 0.5 * (texture2D(tDiffuse, uv + dir * (1.0 / 3.0 - 0.5)).rgb + texture2D(tDiffuse, uv + dir * (2.0 / 3.0 - 0.5)).rgb);
      vec3 b = a * 0.5 + 0.25 * (texture2D(tDiffuse, uv - dir * 0.5).rgb + texture2D(tDiffuse, uv + dir * 0.5).rgb);
      float lB = sukaLuma(b);
      return (lB < lMin || lB > lMax) ? a : b;
    }

    void main() {
      vec2 uv = vUv;
      vec2 c = uv - 0.5;
      float r = length(c * vec2(uAspect, 1.0)) / uAspect * 1.6;

      // exposure warps the edges of vision slightly
      float wobble = uExposure * uExposure * 0.006;
      uv += c * sin(uTime * 1.7 + r * 6.0) * wobble;

      float ca = 0.0015 + uDamage * 0.008 + uExposure * 0.003;
      vec3 col = sukaFxaa(uv);
      // chromatic fringe grows toward the edges; the centre keeps the anti-aliased colour
      float fringe = clamp(length(c) * ca * 800.0, 0.0, 1.0);
      col.r = mix(col.r, texture2D(tDiffuse, uv + c * ca).r, fringe);
      col.b = mix(col.b, texture2D(tDiffuse, uv - c * ca).b, fringe);
      col = sukaSRGB(sukaAces(col));

      // low health: desaturate and pull to cold
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(col, vec3(l) * vec3(0.95, 0.97, 1.0), uLowHealth * 0.75);

      // damage flash at the edges
      float edge = smoothstep(0.35, 0.95, r);
      col = mix(col, vec3(0.55, 0.06, 0.03), edge * uDamage * 0.65);

      // Suka 87 exposure: violet pulse creeping in from the periphery
      float pulse = 0.6 + 0.4 * sin(uTime * (1.2 + uExposure * 2.5));
      col = mix(col, col * vec3(0.75, 0.6, 1.25) + vec3(0.05, 0.0, 0.09), edge * uExposure * pulse * 0.8);

      // vignette
      col *= 1.0 - smoothstep(0.25, 1.15, r) * uVignette;

      // grain (luminance-weighted so blacks stay black)
      float g = hash(uv * vec2(1920.0, 1080.0) + fract(uTime * 13.37)) - 0.5;
      col += g * uGrain * (0.35 + l);

      col += vec3(uFlash);
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  private composer: EffectComposer;
  private renderPass: RenderPass;
  private viewPass: RenderPass;
  private bloom: UnrealBloomPass;
  private grade: ShaderPass;
  private scale = 1;
  /** adaptive resolution multiplier set by the frame-rate governor */
  dynamicScale = 1;
  width = 1;
  height = 1;

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    this.composer = new EffectComposer(this.renderer);
    this.renderPass = new RenderPass(new THREE.Scene(), new THREE.PerspectiveCamera());
    this.composer.addPass(this.renderPass);
    // First-person weapon is drawn in its own scene over a cleared depth buffer so it never clips walls.
    this.viewPass = new RenderPass(new THREE.Scene(), new THREE.PerspectiveCamera());
    this.viewPass.clear = false;
    this.viewPass.clearDepth = true;
    this.viewPass.enabled = false;
    this.composer.addPass(this.viewPass);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.38, 0.5, 0.88);
    this.composer.addPass(this.bloom);
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);

    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  get canvas() {
    return this.renderer.domElement;
  }

  get fx() {
    return this.grade.uniforms as unknown as {
      uTime: { value: number };
      uGrain: { value: number };
      uVignette: { value: number };
      uDamage: { value: number };
      uLowHealth: { value: number };
      uExposure: { value: number };
      uFlash: { value: number };
      uAspect: { value: number };
      uTexel: { value: THREE.Vector2 };
    };
  }

  configure(opts: { renderScale: number; shadows: boolean; bloom: boolean; grain: boolean }) {
    this.scale = opts.renderScale;
    this.bloom.enabled = opts.bloom;
    this.fx.uGrain.value = opts.grain ? 0.07 : 0;
    if (this.renderer.shadowMap.enabled !== opts.shadows) {
      this.renderer.shadowMap.enabled = opts.shadows;
      this.renderer.shadowMap.needsUpdate = true;
    }
    this.resize();
  }

  resize() {
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    // cap at 1x device pixels: high-DPI rendering costs 2-4x the fill rate for little visible gain
    const pr = Math.min(window.devicePixelRatio, 1) * this.scale * this.dynamicScale;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(this.width, this.height);
    this.composer.setPixelRatio(pr);
    this.composer.setSize(this.width, this.height);
    this.bloom.resolution.set(this.width * pr * 0.5, this.height * pr * 0.5);
    this.fx.uAspect.value = this.width / this.height;
    this.fx.uTexel.value.set(1 / Math.max(1, this.width * pr), 1 / Math.max(1, this.height * pr));
  }

  /** Prefiltered studio-room environment for reflections (built once). */
  roomEnvironment() {
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const room = new RoomEnvironment();
    const tex = pmrem.fromScene(room, 0.04).texture;
    room.dispose();
    pmrem.dispose();
    return tex;
  }

  get bloomEnabled() {
    return this.bloom.enabled;
  }

  /** Precompile every material in the scene so the first frames don't hitch. */
  warmup(scene: THREE.Scene, camera: THREE.Camera) {
    this.renderer.compile(scene, camera);
  }

  render(scene: THREE.Scene, camera: THREE.Camera, time: number, view?: { scene: THREE.Scene; camera: THREE.Camera }) {
    this.renderPass.scene = scene;
    this.renderPass.camera = camera;
    this.viewPass.enabled = !!view;
    if (view) {
      this.viewPass.scene = view.scene;
      this.viewPass.camera = view.camera;
    }
    this.fx.uTime.value = time;
    this.composer.render();
  }
}
