/**
 * 轨道拖尾：定长环形缓冲 + 自定义着色器实现「越旧越淡」的彗尾效果
 */

import * as THREE from 'three';

const vertexShader = /* glsl */ `
  attribute float aAlpha;
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    vAlpha = aAlpha;
    vColor = color;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform float uOpacity;
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    float a = vAlpha * uOpacity;
    // 尾部同时变暗，视觉上更像燃烧的轨迹
    vec3 c = vColor * (0.25 + 0.75 * vAlpha);
    gl_FragColor = vec4(c, a);
  }
`;

export class Trail {
  constructor({ capacity = 2400, color = 0xffffff, opacity = 0.95, fadePower = 1.6 } = {}) {
    this.capacity = capacity;
    this.count = 0;
    this.fadePower = fadePower;
    this._dirty = false;

    this.positions = new Float32Array(capacity * 3);
    this.colors = new Float32Array(capacity * 3);
    this.alphas = new Float32Array(capacity);

    const c = new THREE.Color(color);
    for (let i = 0; i < capacity; i++) {
      this.colors[i * 3] = c.r;
      this.colors[i * 3 + 1] = c.g;
      this.colors[i * 3 + 2] = c.b;
    }

    this.geometry = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.positions, 3);
    this.colAttr = new THREE.BufferAttribute(this.colors, 3);
    this.alphaAttr = new THREE.BufferAttribute(this.alphas, 1);
    this.posAttr.setUsage(THREE.DynamicDrawUsage);
    this.alphaAttr.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('position', this.posAttr);
    this.geometry.setAttribute('color', this.colAttr);
    this.geometry.setAttribute('aAlpha', this.alphaAttr);
    this.geometry.setDrawRange(0, 0);
    this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    this.material = new THREE.ShaderMaterial({
      uniforms: { uOpacity: { value: opacity } },
      vertexShader,
      fragmentShader,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.line = new THREE.Line(this.geometry, this.material);
    this.line.frustumCulled = false;
  }

  setOpacity(v) {
    this.material.uniforms.uOpacity.value = v;
  }

  setColor(color) {
    const c = new THREE.Color(color);
    for (let i = 0; i < this.capacity; i++) {
      this.colors[i * 3] = c.r;
      this.colors[i * 3 + 1] = c.g;
      this.colors[i * 3 + 2] = c.b;
    }
    this.colAttr.needsUpdate = true;
  }

  push(x, y, z) {
    if (this.count < this.capacity) {
      const o = this.count * 3;
      this.positions[o] = x;
      this.positions[o + 1] = y;
      this.positions[o + 2] = z;
      this.count++;
    } else {
      // FIFO：整体左移一格，新点写入末尾
      this.positions.copyWithin(0, 3);
      const o = (this.capacity - 1) * 3;
      this.positions[o] = x;
      this.positions[o + 1] = y;
      this.positions[o + 2] = z;
    }
    this._dirty = true;
  }

  /**
   * 每帧末提交一次：重算透明度渐变并上传 GPU。
   * 一帧内会 push 多次（高速运动时最多 8 次），把刷新的开销摊到帧末。
   */
  commit() {
    if (!this._dirty) return;
    this._refreshAlphas();
    this._dirty = false;
  }

  _refreshAlphas() {
    const n = this.count;
    if (n < 2) {
      this.alphas[0] = 1;
      this.alphaAttr.needsUpdate = true;
      this.geometry.setDrawRange(0, n);
      this.posAttr.needsUpdate = true;
      return;
    }
    const denom = n - 1;
    for (let i = 0; i < n; i++) {
      const t = i / denom; // 0 = 最旧，1 = 最新
      this.alphas[i] = Math.pow(t, this.fadePower);
    }
    this.posAttr.needsUpdate = true;
    this.alphaAttr.needsUpdate = true;
    this.geometry.setDrawRange(0, n);
  }

  clear() {
    this.count = 0;
    this._dirty = false;
    this.geometry.setDrawRange(0, 0);
  }

  /**
   * 调整容量（会清空已有拖尾）。
   * 关键：保持 this.line 这个 Object3D 的身份不变，只替换内部的 geometry / material，
   * 这样调用方无需在场景里增删节点。
   */
  resize(capacity) {
    const c = new THREE.Color().setRGB(this.colors[0], this.colors[1], this.colors[2]);
    const opacity = this.material.uniforms.uOpacity.value;
    const fade = this.fadePower;

    this.geometry.dispose();
    this.material.dispose();

    this.capacity = capacity;
    this.count = 0;
    this._dirty = false;
    this.positions = new Float32Array(capacity * 3);
    this.colors = new Float32Array(capacity * 3);
    this.alphas = new Float32Array(capacity);
    for (let i = 0; i < capacity; i++) {
      this.colors[i * 3] = c.r;
      this.colors[i * 3 + 1] = c.g;
      this.colors[i * 3 + 2] = c.b;
    }

    this.geometry = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.positions, 3);
    this.colAttr = new THREE.BufferAttribute(this.colors, 3);
    this.alphaAttr = new THREE.BufferAttribute(this.alphas, 1);
    this.posAttr.setUsage(THREE.DynamicDrawUsage);
    this.alphaAttr.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('position', this.posAttr);
    this.geometry.setAttribute('color', this.colAttr);
    this.geometry.setAttribute('aAlpha', this.alphaAttr);
    this.geometry.setDrawRange(0, 0);
    this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    this.material = new THREE.ShaderMaterial({
      uniforms: { uOpacity: { value: opacity } },
      vertexShader,
      fragmentShader,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.line.geometry = this.geometry;
    this.line.material = this.material;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}
