/**
 * 舞台：renderer / 场景 / 相机 / 轨道控制 / 泛光后处理
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

export class Stage {
  constructor(container) {
    this.container = container;

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
      alpha: false,
      // 允许「截图 PNG」直接读取画布像素
      preserveDrawingBuffer: true,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.domElement.style.display = 'block';
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x04050b);

    this.camera = new THREE.PerspectiveCamera(
      50,
      container.clientWidth / container.clientHeight,
      0.01,
      5000
    );
    this.camera.position.set(2.6, 2.0, 4.4);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.rotateSpeed = 0.85;
    this.controls.zoomSpeed = 0.9;
    this.controls.panSpeed = 0.7;
    this.controls.minDistance = 0.05;
    this.controls.maxDistance = 800;
    this.controls.target.set(0, 0, 0);

    // 后处理：泛光
    this.composer = new EffectComposer(this.renderer);
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(container.clientWidth, container.clientHeight),
      0.85,
      0.55,
      0.12
    );
    this.outputPass = new OutputPass();
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(this.outputPass);

    this.bloomEnabled = true;

    this._onResize = this.resize.bind(this);
    window.addEventListener('resize', this._onResize);
  }

  setBloom(enabled, strength, radius, threshold) {
    this.bloomEnabled = enabled;
    this.bloomPass.enabled = enabled;
    this.bloomPass.strength = strength;
    this.bloomPass.radius = radius;
    this.bloomPass.threshold = threshold;
  }

  resize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (w === 0 || h === 0) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
  }

  /** 视角预设，radius 用于按场景尺度自动设定距离 */
  setView(name = 'default', radius = 3) {
    const d = radius * 2.3 + 0.6;
    const views = {
      default: [d * 0.55, d * 0.42, d * 0.9],
      top: [0, 0.001, d],
      side: [d, 0, 0.001],
      oblique: [d * 0.8, -d * 0.6, d * 0.35],
    };
    const v = views[name] || views.default;
    this.camera.position.set(v[0], v[1], v[2]);
    this.controls.target.set(0, 0, 0);
    this.controls.update();
  }

  /** 根据当前构型包围球自动取景 */
  frameRadius(radius) {
    const dist = Math.max(radius * 2.4 + 0.4, 0.6);
    const dir = new THREE.Vector3()
      .subVectors(this.camera.position, this.controls.target)
      .normalize();
    if (dir.lengthSq() < 1e-6) dir.set(0.55, 0.42, 0.9).normalize();
    this.camera.position.copy(this.controls.target).addScaledVector(dir, dist);
    this.camera.near = Math.max(dist / 5000, 0.001);
    this.camera.far = dist * 60 + 2000;
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }

  render() {
    this.controls.update();
    if (this.bloomEnabled) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }
}
