/**
 * 环境：星空背景 / 星云穹顶 / 参考网格 / 质心标记
 */

import * as THREE from 'three';

/** 程序化生成星云贴图（避免任何外部资源依赖，便于打包成单文件） */
function makeNebulaTexture() {
  const w = 1024;
  const h = 512;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#04050b';
  ctx.fillRect(0, 0, w, h);

  const blobs = [
    { x: 0.18, y: 0.35, r: 0.42, c: 'rgba(38,64,140,0.50)' },
    { x: 0.72, y: 0.62, r: 0.38, c: 'rgba(96,36,120,0.42)' },
    { x: 0.48, y: 0.18, r: 0.30, c: 'rgba(18,86,110,0.34)' },
    { x: 0.90, y: 0.20, r: 0.26, c: 'rgba(120,44,70,0.30)' },
    { x: 0.34, y: 0.82, r: 0.30, c: 'rgba(28,52,104,0.32)' },
  ];
  for (const b of blobs) {
    const g = ctx.createRadialGradient(b.x * w, b.y * h, 0, b.x * w, b.y * h, b.r * w);
    g.addColorStop(0, b.c);
    g.addColorStop(1, 'rgba(4,5,11,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class Environment {
  constructor(scene) {
    this.scene = scene;
    this.scale = 1;

    // ── 星云穹顶 ─────────────────────────────────────────────
    this.dome = new THREE.Mesh(
      new THREE.SphereGeometry(1200, 48, 32),
      new THREE.MeshBasicMaterial({
        map: makeNebulaTexture(),
        side: THREE.BackSide,
        depthWrite: false,
        toneMapped: false,
      })
    );
    this.dome.renderOrder = -10;
    scene.add(this.dome);

    // ── 星场 ────────────────────────────────────────────────
    const starCount = 5200;
    const pos = new Float32Array(starCount * 3);
    const col = new Float32Array(starCount * 3);
    const siz = new Float32Array(starCount);
    const c = new THREE.Color();
    for (let i = 0; i < starCount; i++) {
      // 均匀分布在球壳上
      const u = Math.random() * 2 - 1;
      const th = Math.random() * Math.PI * 2;
      const r = 300 + Math.random() * 600;
      const s = Math.sqrt(1 - u * u);
      pos[i * 3] = r * s * Math.cos(th);
      pos[i * 3 + 1] = r * u;
      pos[i * 3 + 2] = r * s * Math.sin(th);

      const t = Math.random();
      c.setHSL(0.55 + t * 0.12, 0.25 + Math.random() * 0.35, 0.55 + Math.random() * 0.4);
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
      siz[i] = 0.6 + Math.random() * 2.4;
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    starGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    starGeo.setAttribute('aSize', new THREE.BufferAttribute(siz, 1));

    this.stars = new THREE.Points(
      starGeo,
      new THREE.ShaderMaterial({
        uniforms: { uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) } },
        vertexShader: /* glsl */ `
          attribute float aSize;
          uniform float uPixelRatio;
          varying vec3 vColor;
          void main() {
            vColor = color;
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            gl_PointSize = aSize * uPixelRatio;
            gl_Position = projectionMatrix * mv;
          }
        `,
        fragmentShader: /* glsl */ `
          varying vec3 vColor;
          void main() {
            vec2 d = gl_PointCoord - vec2(0.5);
            float a = smoothstep(0.5, 0.06, length(d));
            gl_FragColor = vec4(vColor, a);
          }
        `,
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    this.stars.frustumCulled = false;
    scene.add(this.stars);

    // ── 参考网格（置于初始轨道平面 z = 0）────────────────────
    this.gridGroup = new THREE.Group();
    const grid = new THREE.PolarGridHelper(1, 12, 6, 72, 0x2a3f66, 0x1b2942);
    grid.material.transparent = true;
    grid.material.opacity = 0.22;
    grid.material.depthWrite = false;
    grid.rotation.x = Math.PI / 2; // 从 XZ 平面转到 XY 平面
    this.gridGroup.add(grid);
    scene.add(this.gridGroup);

    // ── 质心标记 ────────────────────────────────────────────
    this.comGroup = new THREE.Group();
    const ringGeo = new THREE.RingGeometry(0.055, 0.075, 48);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x9fb4d8,
      transparent: true,
      opacity: 0.5,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.comRing = new THREE.Mesh(ringGeo, ringMat);
    this.comGroup.add(this.comRing);
    this.comDot = new THREE.Mesh(
      new THREE.SphereGeometry(0.018, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xdce8ff, transparent: true, opacity: 0.75 })
    );
    this.comGroup.add(this.comDot);
    scene.add(this.comGroup);

    // ── 环境光 ──────────────────────────────────────────────
    this.ambient = new THREE.AmbientLight(0x35406a, 0.9);
    scene.add(this.ambient);
    this.fill = new THREE.DirectionalLight(0x8fa4d0, 0.35);
    this.fill.position.set(1, 2, 3);
    scene.add(this.fill);
  }

  /** 按场景尺度同步网格 / 质心标记大小 */
  setScale(s) {
    this.scale = s;
    this.gridGroup.scale.setScalar(s);
    this.comGroup.scale.setScalar(s);
  }

  setStarsVisible(v) {
    this.stars.visible = v;
    this.dome.visible = v;
  }

  setGridVisible(v) {
    this.gridGroup.visible = v;
  }

  /** 质心标记显隐（沉浸模式用来隐藏分析性叠层） */
  setComVisible(v) {
    this.comGroup.visible = v;
  }

  setComPosition(x, y, z) {
    this.comGroup.position.set(x, y, z);
  }

  /** 让质心环始终面向相机 */
  faceCamera(camera) {
    this.comRing.quaternion.copy(camera.quaternion);
  }

  update(dt) {
    // 星空极缓慢自转，增加「活着」的感觉
    this.stars.rotation.y += dt * 0.005;
  }
}
