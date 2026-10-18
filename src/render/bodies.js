/**
 * 天体视觉对象：发光球体 + 辉光精灵 + 点光源
 */

import * as THREE from 'three';

let _glowTexture = null;

/** 生成径向渐变贴图，用作加色混合的辉光精灵 */
export function getGlowTexture() {
  if (_glowTexture) return _glowTexture;
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0.0, 'rgba(255,255,255,1)');
  g.addColorStop(0.12, 'rgba(255,255,255,0.85)');
  g.addColorStop(0.3, 'rgba(255,255,255,0.35)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.08)');
  g.addColorStop(1.0, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  _glowTexture = new THREE.CanvasTexture(canvas);
  _glowTexture.colorSpace = THREE.SRGBColorSpace;
  return _glowTexture;
}

/** 由质量推算视觉半径：R ∝ m^{1/3}（等密度球的直觉） */
export function radiusFromMass(mass, scale = 0.11) {
  return Math.min(2.5, Math.max(0.022, scale * Math.cbrt(Math.max(mass, 1e-6))));
}

export class BodyView {
  /**
   * @param {object} opts
   * @param {number} opts.color  十六进制颜色
   * @param {boolean} opts.ghost 是否为混沌对照的「幽灵」分身
   */
  constructor(opts) {
    const { color, ghost = false, radiusScale = 0.11 } = opts;
    this.ghost = ghost;
    this.radiusScale = radiusScale;
    this.color = new THREE.Color(color);

    this.group = new THREE.Group();

    const radius = radiusFromMass(1, radiusScale);
    this.radius = radius;

    const geo = new THREE.SphereGeometry(1, ghost ? 20 : 48, ghost ? 14 : 32);

    if (ghost) {
      this.material = new THREE.MeshBasicMaterial({
        color: this.color,
        wireframe: true,
        transparent: true,
        opacity: 0.28,
        depthWrite: false,
      });
    } else {
      this.material = new THREE.MeshStandardMaterial({
        color: this.color,
        emissive: this.color,
        emissiveIntensity: 0.7,
        roughness: 0.42,
        metalness: 0.15,
      });
    }

    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.scale.setScalar(radius);
    this.group.add(this.mesh);

    // 辉光
    this.glow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: getGlowTexture(),
        color: this.color,
        transparent: true,
        opacity: ghost ? 0.18 : 0.75,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: true,
      })
    );
    this.glow.scale.setScalar(radius * (ghost ? 3.2 : 6.0));
    this.group.add(this.glow);

    // 实体自带光源（幽灵不发光）
    if (!ghost) {
      this.light = new THREE.PointLight(this.color, 3, 0, 1);
      this.group.add(this.light);
    }
  }

  setMass(mass) {
    const r = radiusFromMass(mass, this.radiusScale);
    this.radius = r;
    this.mesh.scale.setScalar(r);
    this.glow.scale.setScalar(r * (this.ghost ? 3.2 : 6.0));
    if (this.light) this.light.intensity = 2.4 * Math.min(Math.max(mass, 0.05), 8);
  }

  setPosition(x, y, z) {
    this.group.position.set(x, y, z);
  }

  setVisible(v) {
    this.group.visible = v;
  }
}
