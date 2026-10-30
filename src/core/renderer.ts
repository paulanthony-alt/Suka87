import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

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
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime, uGrain, uVignette, uDamage, uLowHealth, uExposure, uFlash, uAspect;
    varying vec2 vUv;

    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

    void main() {
      vec2 uv = vUv;
      vec2 c = uv - 0.5;
      float r = length(c * vec2(uAspect, 1.0)) / uAspect * 1.6;

      // exposure warps the edges of vision slightly
      float wobble = uExposure * uExposure * 0.006;
      uv += c * sin(uTime * 1.7 + r * 6.0) * wobble;

      float ca = 0.0015 + uDamage * 0.008 + uExposure * 0.003;
      vec3 col;
      col.r = texture2D(tDiffuse, uv + c * ca).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - c * ca).b;

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
    this.composer.addPass(new OutputPass());
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
    const pr = Math.min(window.devicePixelRatio, 1.5) * this.scale;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(this.width, this.height);
    this.composer.setPixelRatio(pr);
    this.composer.setSize(this.width, this.height);
    this.bloom.resolution.set(this.width * pr * 0.5, this.height * pr * 0.5);
    this.fx.uAspect.value = this.width / this.height;
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
